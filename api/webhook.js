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
  return String(str)
    .replace(/[\*_~`#\|]/g, '')
    .trim();
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

const COMMANDS_MENU_TEXT = 
  `\n\nCOMMANDS AVAILABLE:\n` +
  `- /p : Menampilkan menu daftar perintah ini\n` +
  `- /info : Menampilkan status sistem real-time\n` +
  `- /stats : Melihat ringkasan statistik akun\n` +
  `- /tower : Histori penyelesaian tower\n` +
  `- /unit : Histori unit rare`;

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
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch(e) {}
      }
      body = body || {};

      const signalTime = getFormattedTime();

      // -------------------------------------------------------------
      // 1. PENANGANAN PESAN LANGSUNG DARI TELEGRAM BOT (Bila diketik /p atau /info di Telegram)
      // -------------------------------------------------------------
      if (body.message && body.message.chat) {
        const teleChatId = body.message.chat.id;
        const teleText = body.message.text || '';

        if (/^\/p\b/i.test(teleText) || /^\/info\b/i.test(teleText) || /^\/start\b/i.test(teleText)) {
          const sysStatus = await redisCmd('get', 'system:analytics_status');
          const isOnline = sysStatus !== 'disabled';

          await sendTelegramAlert(
            `BOT MONITORING ACTIVE\n\n` +
            `Status System: ${isOnline ? 'ONLINE' : 'OFFLINE'}\n` +
            `Waktu Sinyal: ${signalTime}` +
            COMMANDS_MENU_TEXT,
            teleChatId
          );
          return res.status(200).json({ success: true, message: 'Telegram command handled' });
        }
      }

      // -------------------------------------------------------------
      // 2. PENANGANAN WEBHOOK DARI GAME / DISCORD
      // -------------------------------------------------------------
      const statusRes = await redisCmd('get', 'system:analytics_status');
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
          if (e.footer && e.footer.text) textChunks.push(e.footer.text);
          if (Array.isArray(e.fields)) {
            e.fields.forEach(f => {
              if (f.name) textChunks.push(f.name);
              if (f.value) textChunks.push(f.value);
            });
          }
        });
      }

      const rawText = textChunks.join('\n');
      const isCmdP = /\/p\b/i.test(rawText);

      // Ekstrak Username
      let username = 'Player';
      const userMatch = rawText.match(/Username\s*:\s*([^\r\n]+)/i);
      if (userMatch) {
        username = cleanStr(userMatch[1]);
      } else if (body.username && body.username !== 'Webhook') {
        username = cleanStr(body.username);
      }

      if (!username || username === 'Webhook') username = 'Player';

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

      const isTowerReport = /Floor Reached\s*:\s*\d+/i.test(rawText) || /Tower/i.test(rawText);
      const isUnitReport = /Rarity\s*:/i.test(rawText) || /Cash\/s/i.test(rawText) || /Mutation\s*:/i.test(rawText);

      // Ekstrak Drops & Items
      const dropMatches = [...rawText.matchAll(/([a-zA-Z0-9'\s]+)\s*:\s*x([\d,.]+)/gi)];
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

      // Laporan TOWER
      if (isTowerReport) {
        const nameMatch = rawText.match(/Name\s*:\s*([^\r\n]+)/i);
        const floorMatch = rawText.match(/Floor Reached\s*:\s*([\d]+)/i);

        if (nameMatch) {
          const tName = cleanStr(nameMatch[1]);
          const fNumber = floorMatch ? floorMatch[1] : '1';
          const towerDisplayName = `${tName} (Floor ${fNumber})`;

          await redisCmd('rpush', `${prefix}:towerList`, towerDisplayName);
          await redisCmd('incr', `${prefix}:towerSelesai`);

          const dropsFormatted = dropsListText.length > 0 
            ? `\n\nDrops Obtained:\n` + dropsListText.join('\n')
            : '';

          const commandsFooter = isCmdP ? COMMANDS_MENU_TEXT : '';

          await sendTelegramAlert(
            `🏆 <b>TOWER COMPLETED</b>\n\n` +
            `Akun: ${username}\n` +
            `Waktu: ${signalTime}\n` +
            `Tower: ${tName}\n` +
            `Floor: ${fNumber}` +
            dropsFormatted +
            commandsFooter
          );
        }
      }

      // Laporan UNIT
      if (isUnitReport) {
        const nameMatch = rawText.match(/Name\s*:\s*([^\r\n]+)/i);
        const rarityMatch = rawText.match(/Rarity\s*:\s*([^\r\n]+)/i);
        const mutationMatch = rawText.match(/Mutation\s*:\s*([^\r\n]+)/i);

        if (nameMatch) {
          const uName = cleanStr(nameMatch[1]);
          const rarity = rarityMatch ? cleanStr(rarityMatch[1]) : '';
          const mutation = mutationMatch ? cleanStr(mutationMatch[1]) : '';

          let extraInfo = [];
          if (rarity) extraInfo.push(rarity);
          if (mutation && mutation !== 'None') extraInfo.push(mutation);

          const unitDisplayName = extraInfo.length > 0 ? `${uName} [${extraInfo.join(' - ')}]` : uName;

          await redisCmd('rpush', `${prefix}:unitsReceived`, unitDisplayName);

          const commandsFooter = isCmdP ? COMMANDS_MENU_TEXT : '';

          await sendTelegramAlert(
            `🚨 <b>UNIT RARE DETECTED</b>\n\n` +
            `Akun: ${username}\n` +
            `Waktu: ${signalTime}\n` +
            `Unit: ${unitDisplayName}` +
            commandsFooter
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
