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
  } catch (e) {}
}

function sanitizeString(str) {
  if (!str) return '';
  return str
    .replace(/[\*_~`#]/g, '')
    .replace(/Completed!/gi, '')
    .replace(/Name:/gi, '')
    .replace(/Floor Reached/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractNumber(text, pattern) {
  const match = text.match(pattern);
  if (!match) return 0;
  const numStr = match[1].replace(/[,.]/g, '');
  const parsed = parseInt(numStr, 10);
  return isNaN(parsed) ? 0 : parsed;
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const statusRes = await redisCmd('get', 'system:analytics_status');
    return res.status(200).json({
      success: true,
      service: 'Webhook Gateway Active',
      status: statusRes !== 'disabled' ? 'ONLINE' : 'OFFLINE (Analytics Disabled)',
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

      await redisCmd('incr', 'global:total_commands');
      await redisCmd('incrby', 'global:total_bytes', byteLength);

      const content = body.content || '';
      const embeds = body.embeds || [];
      
      let fullText = content + '\n';
      embeds.forEach(e => {
        if (e.title) fullText += e.title + '\n';
        if (e.description) fullText += e.description + '\n';
        if (e.author && e.author.name) fullText += e.author.name + '\n';
        if (e.fields && Array.isArray(e.fields)) {
          e.fields.forEach(f => { fullText += `${f.name \vert{}\vert{} ''}:${f.value || ''}\n`; });
        }
      });

      // Ekstrak Username secara cerdas
      let username = 'Player';
      if (body.username) {
        username = sanitizeString(body.username);
      } else if (embeds.length > 0 && embeds[0].author && embeds[0].author.name) {
        username = sanitizeString(embeds[0].author.name);
      } else {
        const uMatch = fullText.match(/(?:User|Player|Account|Nama)\s*[:=]?\s*([a-zA-Z0-9_]+)/i);
        if (uMatch) username = uMatch[1];
      }

      if (!username || username === 'UnknownUser') username = 'Player';

      const prefix = `stats:${username}`;
      const now = Date.now();

      // REGISTRASI USER WAJIB KELUAR DI DASHBOARD
      await redisCmd('sadd', 'stats:users', username);
      await redisCmd('set', `${prefix}:lastSeen`, now);

      const existStart = await redisCmd('get', `${prefix}:startTime`);
      if (!existStart) {
        await redisCmd('set', `${prefix}:startTime`, now);
        const globalStart = await redisCmd('get', 'global:system_start_time');
        if (!globalStart) await redisCmd('set', 'global:system_start_time', now);
      }

      await redisCmd('incr', `${prefix}:totalLaporan`);

      // 1. Parse Gems (Multi-pattern support)
      const gemsCount = extractNumber(fullText, /(?:Gems|Gem)\s*[:+=]?\s*x?\s*([\d,.]+)/i);
      if (gemsCount > 0) await redisCmd('incrby', `${prefix}:totalGems`, gemsCount);

      // 2. Parse Trait Reroll
      const traitCount = extractNumber(fullText, /(?:Trait|Reroll|Trait Reroll)\s*[:+=]?\s*x?\s*([\d,.]+)/i);
      if (traitCount > 0) await redisCmd('incrby', `${prefix}:totalTraitReroll`, traitCount);

      // 3. Parse Unit Diterima
      const unitMatches = [...fullText.matchAll(/(?:Got Unit|Received Unit|Dapat Unit|Unit)\s*[:=]?\s*([^\n\r,]+)/gi)];
      for (const uMatch of unitMatches) {
        const cleanUnit = sanitizeString(uMatch[1]);
        if (cleanUnit && cleanUnit.length > 1) {
          await redisCmd('rpush', `${prefix}:unitsReceived`, cleanUnit);
          await sendTelegramAlert(`🎲 <b>LAPORAN UNIT DITERIMA!</b>\n\n👤 Akun: <b>${username}</b>\n🎁 Unit: <b>${cleanUnit}</b>`);
        }
      }

      // 4. Parse Tower / Floor
      const towerMatches = [...fullText.matchAll(/(?:Tower|Floor|Lantai)\s*[:=]?\s*([^\n\r,]+)/gi)];
      for (const tMatch of towerMatches) {
        const cleanTower = sanitizeString(tMatch[1]);
        if (cleanTower && cleanTower.length > 1) {
          await redisCmd('rpush', `${prefix}:towerList`, cleanTower);
          await redisCmd('incr', `${prefix}:towerSelesai`);
          await sendTelegramAlert(`🏆 <b>TOWER / FLOOR SELESAI!</b>\n\n👤 Akun: <b>${username}</b>\n🏰 Tower: <b>${cleanTower}</b>`);
        }
      }

      // 5. Parse Item & Potions
      const potionMatches = [...fullText.matchAll(/(?:Potion|Item|Boost)\s*([a-zA-Z0-9\s]+?)\s*x\s*([\d,.]+)/gi)];
      for (const pMatch of potionMatches) {
        const pName = sanitizeString(pMatch[1]);
        const pQty = parseInt(pMatch[2].replace(/[,.]/g, ''), 10);
        if (pName && !isNaN(pQty) && pQty > 0) {
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
