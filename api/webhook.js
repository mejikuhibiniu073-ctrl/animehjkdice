const CONFIG = {
  REDIS_URL: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  REDIS_TOKEN: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '8867286519:AAFCsH9InhDdTAolaDDn-dU4-zvAOPdLGSQ',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '1315912406'
};

async function redisCmd(command, ...args) {
  if (!CONFIG.REDIS_URL || !CONFIG.REDIS_TOKEN) return { result: null, latencyMs: 0 };
  const start = Date.now();
  try {
    const formattedArgs = args.map(arg => encodeURIComponent(String(arg))).join('/');
    const res = await fetch(`${CONFIG.REDIS_URL}/${command}/${formattedArgs}`, {
      headers: { Authorization: `Bearer ${CONFIG.REDIS_TOKEN}` }
    });
    const latencyMs = Date.now() - start;
    const data = await res.json();
    return { result: data.result, latencyMs };
  } catch (e) {
    return { result: null, latencyMs: Date.now() - start };
  }
}

async function sendTelegramAlert(message, customChatId = null) {
  const chatId = customChatId || CONFIG.TELEGRAM_CHAT_ID;
  if (!CONFIG.TELEGRAM_BOT_TOKEN || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
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
  return String(str).replace(/[\*_~`#\|]/g, '').trim();
}

function getFormattedTime() {
  const now = new Date();
  const options = {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };
  const formatter = new Intl.DateTimeFormat('id-ID', options);
  return formatter.format(now).replace(/\./g, ':') + ' WIB';
}

module.exports = async (req, res) => {
  const requestStartTime = Date.now();

  if (req.method === 'GET') {
    const { result: statusRes } = await redisCmd('get', 'system:analytics_status');
    return res.status(200).json({
      success: true,
      service: 'Webhook Gateway Active',
      status: statusRes !== 'disabled' ? 'ONLINE' : 'OFFLINE (Analytics Disabled)',
      timestamp: new Date().toISOString()
    });
  }

  if (req.method === 'POST') {
    try {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch(e) {}
      }
      body = body || {};

      const signalTime = getFormattedTime();

      // 1. RESPON UNTUK PERINTAH TELEGRAM BOT /p (DIKETIK LANGSUNG DI TELEGRAM)
      if (body.message && body.message.chat) {
        const teleChatId = body.message.chat.id;
        const teleText = body.message.text || '';

        if (/^\/p\b/i.test(teleText) || /^\/start\b/i.test(teleText)) {
          const { result: sysStatus, latencyMs: dbPing } = await redisCmd('get', 'system:analytics_status');
          const isOnline = sysStatus !== 'disabled';
          const totalWebhookLatency = Date.now() - requestStartTime;

          await sendTelegramAlert(
            `BOT MONITORING ACTIVE\n\n` +
            `Status System: ${isOnline ? 'ONLINE' : 'OFFLINE'}\n` +
            `DB Ping: ${dbPing} ms\n` +
            `Webhook Latency: ${totalWebhookLatency} ms\n` +
            `Waktu Sinyal: ${signalTime}`,
            teleChatId
          );
          return res.status(200).json({ success: true, message: 'Command /p handled' });
        }
      }

      // 2. PEMPROSESAN WEBHOOK MASUK DARI DISCORD / GAME
      const { result: statusRes } = await redisCmd('get', 'system:analytics_status');
      if (statusRes === 'disabled') {
        return res.status(200).json({ success: true, message: 'Analytics System IS OFF' });
      }

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
          if (e.fields && Array.isArray(e.fields)) {
            e.fields.forEach(f => {
              if (f.name) textChunks.push(f.name);
              if (f.value) textChunks.push(f.value);
            });
          }
        });
      }

      const fullRawText = textChunks.join('\n');

      // PRESISI USERNAME (MEMISAHKAN DARI NAMA TOWER)
      let username = '';
      const userMatch = fullRawText.match(/Username\s*:\s*([^\r\n]+)/i);
      if (userMatch) {
        username = cleanStr(userMatch[1]);
      } else if (body.username && body.username !== 'Webhook') {
        username = cleanStr(body.username);
      } else if (body.embeds && body.embeds[0] && body.embeds[0].author && body.embeds[0].author.name) {
        username = cleanStr(body.embeds[0].author.name);
      }

      if (!username) username = 'Player';

      const prefix = `stats:${username}`;
      const now = Date.now();

      await redisCmd('sadd', 'stats:users', username);
      await redisCmd('set', `${prefix}:lastSeen`, now);

      const { result: existStart } = await redisCmd('get', `${prefix}:startTime`);
      if (!existStart) {
        await redisCmd('set', `${prefix}:startTime`, now);
        const { result: globalStart } = await redisCmd('get', 'global:system_start_time');
        if (!globalStart) await redisCmd('set', 'global:system_start_time', now);
      }

      await redisCmd('incr', `${prefix}:totalLaporan`);

      const isTowerReport = /Tower Completed!/i.test(fullRawText) || /Floor Reached\s*:/i.test(fullRawText);
      const isUnitReport = /Rarity\s*:/i.test(fullRawText) || /Mutation\s*:/i.test(fullRawText) || /New Unit!/i.test(fullRawText);

      // EKSTRAKSI DROPS & ITEMS (SUPPORT JINWOO'S DAGGERS & BUFFS)
      const dropMatches = [...fullRawText.matchAll(/([a-zA-Z0-9'\s]+)\s*:\s*x([\d,.]+)/gi)];
      let dropsListText = [];

      for (const match of dropMatches) {
        const itemName = cleanStr(match[1]);
        const qty = parseInt(match[2].replace(/[,.]/g, ''), 10);

        if (itemName && !isNaN(qty) && qty > 0) {
          if (/^Gems$/i.test(itemName)) {
            await redisCmd('incrby', `${prefix}:totalGems`, qty);
            dropsListText.push(`- Gems: x${qty.toLocaleString('id-ID')}`);
          } else if (/^Trait Reroll$/i.test(itemName)) {
            await redisCmd('incrby', `${prefix}:totalTraitReroll`, qty);
            dropsListText.push(`- Trait Reroll: x${qty.toLocaleString('id-ID')}`);
          } else {
            await redisCmd('hincrby', `${prefix}:potions`, itemName, qty);
            dropsListText.push(`- ${itemName}: x${qty}`);
          }
        }
      }

      // LAPORAN TOWER COMPLETED
      if (isTowerReport) {
        const nameMatch = fullRawText.match(/Name\s*:\s*([^\r\n]+)/i);
        const floorMatch = fullRawText.match(/Floor Reached\s*:\s*([\d]+)/i);

        let realTowerName = nameMatch ? cleanStr(nameMatch[1]) : 'Shadow Tower';
        let realFloor = floorMatch ? floorMatch[1] : '1';

        // Koreksi otomatis jika nama tower keliru terbaca sebagai username
        if (realTowerName.toLowerCase() === username.toLowerCase()) {
          realTowerName = 'Shadow Tower';
        }

        const towerDisplayName = `${realTowerName} (Floor${realFloor})`;

        await redisCmd('rpush', `${prefix}:towerList`, towerDisplayName);
        await redisCmd('incr', `${prefix}:towerSelesai`);

        const dropsFormatted = dropsListText.length > 0 
          ? `\n\nDrops Obtained:\n` + dropsListText.join('\n')
          : '';

        await sendTelegramAlert(
          `🏆 <b>TOWER COMPLETED</b>\n\n` +
          `Akun: ${username}\n` +
          `Waktu: ${signalTime}\n` +
          `Tower: ${realTowerName}\n` +
          `Floor: ${realFloor}` +
          dropsFormatted
        );
      }

      // LAPORAN UNIT RARE DETECTED
      if (isUnitReport) {
        const nameMatch = fullRawText.match(/Name\s*:\s*([^\r\n]+)/i);
        const rarityMatch = fullRawText.match(/Rarity\s*:\s*([^\r\n]+)/i);
        const mutationMatch = fullRawText.match(/Mutation\s*:\s*([^\r\n]+)/i);

        if (nameMatch) {
          const uName = cleanStr(nameMatch[1]);
          const rarity = rarityMatch ? cleanStr(rarityMatch[1]) : '';
          const mutation = mutationMatch ? cleanStr(mutationMatch[1]) : '';

          let extraInfo = [];
          if (rarity) extraInfo.push(rarity);
          if (mutation && mutation !== 'None') extraInfo.push(mutation);

          const unitDisplayName = extraInfo.length > 0 ? `${uName} [${extraInfo.join(' - ')}]` : uName;

          await redisCmd('rpush', `${prefix}:unitsReceived`, unitDisplayName);

          await sendTelegramAlert(
            `🚨 <b>UNIT RARE DETECTED</b>\n\n` +
            `Akun: ${username}\n` +
            `Waktu: ${signalTime}\n` +
            `Unit: ${unitDisplayName}`
          );
        }
      }

      return res.status(200).json({ success: true, user: username, timestamp: signalTime });
    } catch (err) {
      console.error('Webhook Error:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
