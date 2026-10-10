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
  } catch (e) {
    console.error('Telegram Error:', e);
  }
}

function cleanStr(str) {
  if (!str) return '';
  return String(str).replace(/[\*_~`#]/g, '').trim();
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
    try {
      const statusRes = await redisCmd('get', 'system:analytics_status');
      if (statusRes === 'disabled') {
        return res.status(200).json({ success: true, message: 'Analytics System IS OFF' });
      }

      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch(e) {}
      }
      body = body || {};

      const payloadStr = JSON.stringify(body);
      const byteLength = Buffer.byteLength(payloadStr, 'utf8');

      await redisCmd('incr', 'global:total_commands');
      await redisCmd('incrby', 'global:total_bytes', byteLength);

      let textChunks = [];
      if (body.content) textChunks.push(body.content);

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

      const fullText = textChunks.join('\n');

      // 1. Ekstrak Username (Format: Username: NamaAkun)
      let username = 'Player';
      const userMatch = fullText.match(/Username\s*:\s*([^\r\n]+)/i);
      if (userMatch) {
        username = cleanStr(userMatch[1]);
      } else if (body.username && body.username !== 'Webhook') {
        username = cleanStr(body.username);
      }

      if (!username) username = 'Player';

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

      // 2. Ekstrak Tower (Format Pesan Telegram: /tower NamaAkun | NamaTower | Floor)
      if (/Tower Completed!/i.test(fullText) || /Tower/i.test(fullText)) {
        const towerNameMatch = fullText.match(/Name\s*:\s*([^\r\n]+)/i);
        const floorMatch = fullText.match(/Floor Reached\s*:\s*([^\r\n]+)/i);

        if (towerNameMatch) {
          const tName = cleanStr(towerNameMatch[1]);
          const fNumber = floorMatch ? cleanStr(floorMatch[1]) : '1';
          const towerDisplayName = `${tName} (Floor ${fNumber})`;

          await redisCmd('rpush', `${prefix}:towerList`, towerDisplayName);
          await redisCmd('incr', `${prefix}:towerSelesai`);

          // Format notifikasi Telegram dengan perintah "/" dan pemisah "|"
          await sendTelegramAlert(
            `/tower 🏆\n\n` +
            `<b>${username}</b> | <b>${tName}</b> | <b>Floor ${fNumber}</b>`
          );
        }
      }

      // 3. Ekstrak Unit (Format Pesan Telegram: /unit NamaAkun | NamaUnit)
      if (/New Unit!/i.test(fullText) || /HIGH-VALUE DROP/i.test(fullText)) {
        const unitNameMatch = fullText.match(/Name\s*:\s*([^\r\n]+)/i);
        const rarityMatch = fullText.match(/Rarity\s*:\s*([^\r\n]+)/i);

        if (unitNameMatch) {
          const uName = cleanStr(unitNameMatch[1]);
          const rarity = rarityMatch ? cleanStr(rarityMatch[1]) : '';
          const unitDisplayName = rarity ? `${uName} [${rarity}]` : uName;

          await redisCmd('rpush', `${prefix}:unitsReceived`, unitDisplayName);

          // Format notifikasi Telegram dengan perintah "/" dan pemisah "|"
          await sendTelegramAlert(
            `/unit 🚨\n\n` +
            `<b>${username}</b> | <b>${unitDisplayName}</b>`
          );
        }
      }

      // 4. Ekstrak Item & Drops Game Anime Dice Roblox (Gems, Trait Reroll, Buff Potions/Shadow Drops)
      const dropMatches = [...fullText.matchAll(/([a-zA-Z0-9\s]+)\s*:\s*x([\d,.]+)/gi)];

      for (const match of dropMatches) {
        const itemName = cleanStr(match[1]);
        const qty = parseInt(match[2].replace(/[,.]/g, ''), 10);

        if (itemName && !isNaN(qty) && qty > 0) {
          if (/^Gems$/i.test(itemName)) {
            await redisCmd('incrby', `${prefix}:totalGems`, qty);
          } else if (/^Trait Reroll$/i.test(itemName)) {
            await redisCmd('incrby', `${prefix}:totalTraitReroll`, qty);
          } else {
            // Menyimpan item/potion bawaan Anime Dice (seperti Shadow Income I, Shadow Luck III, Speed, dll.)
            await redisCmd('hincrby', `${prefix}:potions`, itemName, qty);
          }
        }
      }

      return res.status(200).json({ success: true, user: username });
    } catch (err) {
      console.error('Webhook Error:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
