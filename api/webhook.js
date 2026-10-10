const CONFIG = {
  REDIS_URL: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  REDIS_TOKEN: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID
};

async function redisCmd(command, ...args) {
  if (!CONFIG.REDIS_URL || !CONFIG.REDIS_TOKEN) return null;
  try {
    const formattedArgs = args.map(arg => encodeURIComponent(String(arg))).join('/');
    const res = await fetch(`${CONFIG.REDIS_URL}/${command}/${formattedArgs}`, {
      headers: { Authorization: `Bearer ${CONFIG.REDIS_TOKEN}` }
    });
    return (await res.json()).result;
  } catch (e) {
    return null;
  }
}

// KIRIM NOTIFIKASI TELEGRAM DENGAN BOT TOKEN & CHAT ID
async function sendTelegramAlert(message) {
  if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML'
      })
    });
  } catch (e) {
    console.error('Telegram Alert Error:', e);
  }
}

function cleanUsername(raw) {
  if (!raw) return 'UnknownUser';
  let cleaned = raw.replace(/<[^>]*>/g, '').replace(/[\*_~`]/g, '').trim();
  const match = cleaned.match(/([a-zA-Z0-9_]{3,20})/);
  return match ? match[1] : cleaned;
}

// PEMBERSIH FORMAT DISCORD & TEKS BUG
function cleanText(str) {
  if (!str) return '';
  return str
    .replace(/[\*_~`]/g, '')
    .replace(/Completed!/gi, '')
    .replace(/Name:/gi, '')
    .replace(/Floor Reached/gi, '')
    .replace(/\[.*?\]\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const statusRes = await redisCmd('get', 'system:analytics_status');
    const isAnalyticsOn = statusRes !== 'disabled';
    return res.status(200).json({
      success: true,
      service: 'Webhook Gateway Active',
      status: isAnalyticsOn ? 'ONLINE' : 'OFFLINE (Analytics Disabled)',
      timestamp: new Date().toISOString()
    });
  }

  if (req.method === 'POST') {
    const statusRes = await redisCmd('get', 'system:analytics_status');
    if (statusRes === 'disabled') {
      return res.status(200).json({ success: true, message: 'Analytics System IS OFF' });
    }

    try {
      const body = req.body || {};
      const payloadStr = JSON.stringify(body);
      const byteLength = Buffer.byteLength(payloadStr, 'utf8');

      // Update Tracker Global Persisten
      await redisCmd('incr', 'global:total_commands');
      await redisCmd('incrby', 'global:total_bytes', byteLength);

      // Kumpulkan Teks Laporan
      const content = body.content || '';
      const embeds = body.embeds || [];
      
      let rawText = content + ' ';
      embeds.forEach(e => {
        rawText += `${e.title \vert{}\vert{} ''}${e.description || ''} `;
        if (e.fields && Array.isArray(e.fields)) {
          e.fields.forEach(f => { rawText += `${f.name \vert{}\vert{} ''}${f.value || ''} `; });
        }
      });

      // Ekstrak Nama Akun
      let username = 'Player';
      if (body.username) {
        username = cleanUsername(body.username);
      } else if (embeds.length > 0 && embeds[0].author && embeds[0].author.name) {
        username = cleanUsername(embeds[0].author.name);
      } else {
        const userMatch = rawText.match(/(?:User|Player|Account|Nama)\s*[:=]?\s*([a-zA-Z0-9_]+)/i);
        if (userMatch) username = userMatch[1];
      }

      const prefix = `stats:${username}`;
      const now = Date.now();

      await redisCmd('sadd', 'stats:users', username);
      await redisCmd('set', `${prefix}:lastSeen`, now);

      const existStart = await redisCmd('get', `${prefix}:startTime`);
      if (!existStart) {
        await redisCmd('set', `${prefix}:startTime`, now);
        const globalStart = await redisCmd('get', 'global:system_start_time');
        if (!globalStart) await redisCmd('set', 'global:system_start_time', now);
      }

      await redisCmd('incr', `${prefix}:totalLaporan`);

      // 1. Parse Gems
      const gemsMatch = rawText.match(/(?:Gems|Gem)\s*[:+=]?\s*x?([\d,.]+)/i);
      if (gemsMatch) {
        const amount = parseInt(gemsMatch[1].replace(/[,.]/g, ''), 10);
        if (!isNaN(amount)) await redisCmd('incrby', `${prefix}:totalGems`, amount);
      }

      // 2. Parse Trait Rerolls
      const traitMatch = rawText.match(/(?:Trait|Reroll|Trait Reroll)\s*[:+=]?\s*x?([\d,.]+)/i);
      if (traitMatch) {
        const amount = parseInt(traitMatch[1].replace(/[,.]/g, ''), 10);
        if (!isNaN(amount)) await redisCmd('incrby', `${prefix}:totalTraitReroll`, amount);
      }

      // 3. Parse Unit Diterima & Send Telegram Alert
      const unitMatch = rawText.match(/(?:Got Unit|Received Unit|Dapat Unit|Unit)\s*[:=]?\s*([^\n\r,]+)/i);
      if (unitMatch) {
        const unitName = cleanText(unitMatch[1]);
        if (unitName) {
          await redisCmd('rpush', `${prefix}:unitsReceived`, unitName);
          await sendTelegramAlert(
            `🎲 <b>LAPORAN UNIT DITERIMA!</b>\n\n` +
            `👤 Akun: <b>${username}</b>\n` +
            `🎁 Unit: <b>${unitName}</b>`
          );
        }
      }

      // 4. Parse Tower / Floor (Murni Nama Tower)
      const towerMatch = rawText.match(/(?:Tower|Floor|Lantai)\s*[:=]?\s*([^\n\r,\*]+)/i);
      if (towerMatch) {
        const towerName = cleanText(towerMatch[1]);
        if (towerName) {
          await redisCmd('rpush', `${prefix}:towerList`, towerName);
          await redisCmd('incr', `${prefix}:towerSelesai`);

          await sendTelegramAlert(
            `🏆 <b>TOWER / FLOOR SELESAI!</b>\n\n` +
            `👤 Akun: <b>${username}</b>\n` +
            `🏰 Tower: <b>${towerName}</b>`
          );
        }
      }

      // 5. Parse Item & Potions
      const potionMatches = rawText.matchAll(/(?:Potion|Item|Boost)\s*([a-zA-Z0-9\s]+)\s*x?([\d]+)/gi);
      for (const match of potionMatches) {
        const pName = cleanText(match[1]);
        const pQty = parseInt(match[2], 10);
        if (pName && !isNaN(pQty)) {
          await redisCmd('hincrby', `${prefix}:potions`, pName, pQty);
        }
      }

      return res.status(200).json({ success: true, user: username });
    } catch (err) {
      console.error('Webhook processing error:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
