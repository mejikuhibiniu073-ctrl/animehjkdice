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
    console.error('Redis Exec Error:', e);
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
  } catch (e) {
    console.error('Telegram Error:', e);
  }
}

function cleanText(str) {
  if (!str) return '';
  return String(str)
    .replace(/[\*_~`#]/g, '')
    .replace(/Completed!/gi, '')
    .replace(/Name:/gi, '')
    .replace(/Floor Reached/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = async (req, res) => {
  // Pengecekan via Browser (GET)
  if (req.method === 'GET') {
    const statusRes = await redisCmd('get', 'system:analytics_status');
    return res.status(200).json({
      success: true,
      service: 'Webhook Gateway Active',
      status: statusRes !== 'disabled' ? 'ONLINE' : 'OFFLINE (Analytics Disabled)',
      redisConnected: !!CONFIG.REDIS_URL,
      timestamp: new Date().toISOString()
    });
  }

  if (req.method === 'POST') {
    try {
      const statusRes = await redisCmd('get', 'system:analytics_status');
      if (statusRes === 'disabled') {
        return res.status(200).json({ success: true, message: 'Analytics System IS OFF' });
      }

      // Pastikan body ter-parse dengan baik
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch(e) {}
      }
      body = body || {};

      const payloadStr = JSON.stringify(body);
      const byteLength = Buffer.byteLength(payloadStr, 'utf8');

      // Tracker Global Upstash Persisten
      await redisCmd('incr', 'global:total_commands');
      await redisCmd('incrby', 'global:total_bytes', byteLength);

      // Ekstraksi Teks Lengkap dari Seluruh Bagian Payload Discord
      let textChunks = [];
      if (body.content) textChunks.push(body.content);
      if (body.username) textChunks.push(body.username);

      if (Array.isArray(body.embeds)) {
        body.embeds.forEach(e => {
          if (e.title) textChunks.push(e.title);
          if (e.description) textChunks.push(e.description);
          if (e.author && e.author.name) textChunks.push(e.author.name);
          if (e.footer && e.footer.text) textChunks.push(e.footer.text);
          if (Array.isArray(e.fields)) {
            e.fields.forEach(f => {
              if (f.name) textChunks.push(f.name);
              if (f.value) textChunks.push(f.value);
            });
          }
        });
      }

      const rawFullText = textChunks.join('\n');
      const cleanFullText = cleanText(rawFullText);

      // Tentukan Nama Akun / User
      let username = 'Player';
      if (body.username && body.username !== 'Webhook') {
        username = cleanText(body.username);
      } else if (body.embeds && body.embeds[0] && body.embeds[0].author && body.embeds[0].author.name) {
        username = cleanText(body.embeds[0].author.name);
      } else {
        const uMatch = rawFullText.match(/(?:User|Player|Account|Nama)\s*[:=]?\s*([a-zA-Z0-9_]+)/i);
        if (uMatch) username = uMatch[1];
      }

      if (!username || username === 'UnknownUser') username = 'Player';

      const prefix = `stats:${username}`;
      const now = Date.now();

      // Pendaftaran Akun ke Index Stats Users
      await redisCmd('sadd', 'stats:users', username);
      await redisCmd('set', `${prefix}:lastSeen`, now);

      const existStart = await redisCmd('get', `${prefix}:startTime`);
      if (!existStart) {
        await redisCmd('set', `${prefix}:startTime`, now);
        const globalStart = await redisCmd('get', 'global:system_start_time');
        if (!globalStart) await redisCmd('set', 'global:system_start_time', now);
      }

      await redisCmd('incr', `${prefix}:totalLaporan`);

      // 1. Ekstraksi Gems
      const gemsMatch = rawFullText.match(/(?:Gems|Gem)\s*[:+=]?\s*x?\s*([\d,.]+)/i);
      if (gemsMatch) {
        const val = parseInt(gemsMatch[1].replace(/[,.]/g, ''), 10);
        if (!isNaN(val) && val > 0) await redisCmd('incrby', `${prefix}:totalGems`, val);
      }

      // 2. Ekstraksi Trait Reroll
      const traitMatch = rawFullText.match(/(?:Trait|Reroll|Trait Reroll)\s*[:+=]?\s*x?\s*([\d,.]+)/i);
      if (traitMatch) {
        const val = parseInt(traitMatch[1].replace(/[,.]/g, ''), 10);
        if (!isNaN(val) && val > 0) await redisCmd('incrby', `${prefix}:totalTraitReroll`, val);
      }

      // 3. Ekstraksi Unit Diterima & Telegram Notif
      const unitMatches = [...rawFullText.matchAll(/(?:Got Unit|Received Unit|Dapat Unit|Unit)\s*[:=]?\s*([^\n\r,]+)/gi)];
      for (const m of unitMatches) {
        const item = cleanText(m[1]);
        if (item) {
          await redisCmd('rpush', `${prefix}:unitsReceived`, item);
          await sendTelegramAlert(`🎲 <b>LAPORAN UNIT DITERIMA!</b>\n\n👤 Akun: <b>${username}</b>\n🎁 Unit: <b>${item}</b>`);
        }
      }

      // 4. Ekstraksi Tower / Floor Selesai
      const towerMatches = [...rawFullText.matchAll(/(?:Tower|Floor|Lantai)\s*[:=]?\s*([^\n\r,]+)/gi)];
      for (const m of towerMatches) {
        const item = cleanText(m[1]);
        if (item) {
          await redisCmd('rpush', `${prefix}:towerList`, item);
          await redisCmd('incr', `${prefix}:towerSelesai`);
          await sendTelegramAlert(`🏆 <b>TOWER / FLOOR SELESAI!</b>\n\n👤 Akun: <b>${username}</b>\n🏰 Tower: <b>${item}</b>`);
        }
      }

      // 5. Ekstraksi Potion / Item
      const potionMatches = [...rawFullText.matchAll(/(?:Potion|Item|Boost)\s*([a-zA-Z0-9\s]+?)\s*x\s*([\d,.]+)/gi)];
      for (const m of potionMatches) {
        const pName = cleanText(m[1]);
        const pQty = parseInt(m[2].replace(/[,.]/g, ''), 10);
        if (pName && !isNaN(pQty) && pQty > 0) {
          await redisCmd('hincrby', `${prefix}:potions`, pName, pQty);
        }
      }

      return res.status(200).json({ success: true, processedUser: username });
    } catch (err) {
      console.error('Webhook Error:', err);
      return res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
