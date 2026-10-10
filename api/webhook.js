const system = require('./system');

const CONFIG = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  CHAT_ID: process.env.CHAT_ID || '1315912406',
  TELEGRAM_BASE_URL: 'https://api.telegram.org/bot',
  REDIS_URL: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  REDIS_TOKEN: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
};

const TTL_5_HOURS = 18000;
const OFFLINE_THRESHOLD_MS = 20 * 60 * 1000;

function getCurrentTimeWIB() {
  return new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function extractCleanUsername(rawName, fullText) {
  if (!fullText) fullText = '';
  const cleanText = fullText.replace(/\*\*/g, '');

  const bodyUserMatch = cleanText.match(/Username:\s*\|\|([^|]+)\|\|/i);
  if (bodyUserMatch) return bodyUserMatch[1].trim();

  const plainUserMatch = cleanText.match(/Username:\s*([^\r\n]+)/i);
  if (plainUserMatch) return plainUserMatch[1].replace(/\|\|/g, '').trim();

  if (rawName) return rawName.replace(/\|\|/g, '').replace(/\*\*/g, '').trim();

  return 'Roblox Script';
}

async function redisCmd(command, ...args) {
  if (!CONFIG.REDIS_URL || !CONFIG.REDIS_TOKEN) return null;
  try {
    const formattedArgs = args.map(arg => encodeURIComponent(String(arg))).join('/');
    const res = await fetch(`${CONFIG.REDIS_URL}/${command}/${formattedArgs}`, {
      headers: { Authorization: `Bearer ${CONFIG.REDIS_TOKEN}` }
    });
    const data = await res.json();
    return data.result;
  } catch (e) {
    console.error('[Redis Error]:', e);
    return null;
  }
}

async function checkOfflineAccounts(currentActiveUser) {
  let users = await redisCmd('smembers', 'stats:users');
  if (!Array.isArray(users)) users = users ? [users] : [];

  const now = Date.now();

  for (const user of users) {
    if (user === currentActiveUser) continue;

    const prefix = `stats:${user}`;
    const lastSeen = await redisCmd('get', `${prefix}:lastSeen`);
    const isAlerted = await redisCmd('get', `${prefix}:offlineAlerted`);

    if (lastSeen) {
      const timeDiff = now - parseInt(lastSeen, 10);
      if (timeDiff > OFFLINE_THRESHOLD_MS && !isAlerted) {
        const offlineMinutes = Math.floor(timeDiff / (1000 * 60));
        const alertMsg = `🚨 *[ALERT AKUN OFFLINE]*\n\n` +
          `👤 Akun: *${user}*\n` +
          `⚠️ Status: Tidak ada laporan masuk selama *${offlineMinutes} menit*!\n` +
          `Mohon periksa emulator atau koneksi device Anda.`;

        await sendTelegramMessage(CONFIG.CHAT_ID, alertMsg);
        await redisCmd('set', `${prefix}:offlineAlerted`, 'true');
        await redisCmd('expire', `${prefix}:offlineAlerted`, 3600);
      }
    }
  }
}

async function scanAndAccumulate(user, text) {
  if (!text) return;

  const prefix = `stats:${user}`;
  const now = Date.now();

  await redisCmd('set', `${prefix}:lastSeen`, now);
  await redisCmd('expire', `${prefix}:lastSeen`, TTL_5_HOURS);
  await redisCmd('del', `${prefix}:offlineAlerted`);

  await redisCmd('incrby', `${prefix}:totalLaporan`, 1);
  await redisCmd('expire', `${prefix}:totalLaporan`, TTL_5_HOURS);
  await redisCmd('sadd', 'stats:users', user);

  const startTime = await redisCmd('get', `${prefix}:startTime`);
  if (!startTime) {
    await redisCmd('set', `${prefix}:startTime`, now);
    await redisCmd('expire', `${prefix}:startTime`, TTL_5_HOURS);
  } else {
    await redisCmd('expire', `${prefix}:startTime`, TTL_5_HOURS);
  }

  const cleanText = text.replace(/\*\*/g, '');
  const isUnitDrop = /Cash\/s|Plot Avg|Grade:|Tier:|New Unit!/i.test(cleanText) && /(?:Name|Unit):/i.test(cleanText);

  if (isUnitDrop) {
    const nameMatch = cleanText.match(/(?:Name|Unit):\s*([^\r\n]+)/i);
    if (nameMatch) {
      const rawUnitName = nameMatch[1].replace(/\|\|/g, '').trim();

      if (rawUnitName && !['roblox script', 'stats', 'webhook'].includes(rawUnitName.toLowerCase())) {
        const rarityMatch = cleanText.match(/Rarity:\s*([^\r\n]+)/i);
        const mutationMatch = cleanText.match(/Mutation:\s*([^\r\n]+)/i);
        
        // Deteksi rasio kelangkaan (contoh: 1/1.6qi, 1/500qd)
        const chanceMatch = cleanText.match(/1\/\d+(\.\d+)?[a-zA-Z]+/i);
        const chanceText = chanceMatch ? ` [${chanceMatch[0]}]` : '';

        let unitInfo = rawUnitName;
        if (rarityMatch) unitInfo += ` [${rarityMatch[1].replace(/\|\|/g, '').trim()}]`;
        if (mutationMatch) unitInfo += ` (${mutationMatch[1].replace(/\|\|/g, '').trim()})`;
        
        unitInfo += chanceText;

        await redisCmd('incrby', `${prefix}:unitMasukTas`, 1);
        await redisCmd('expire', `${prefix}:unitMasukTas`, TTL_5_HOURS);

        await redisCmd('rpush', `${prefix}:unitsReceived`, unitInfo);
        await redisCmd('expire', `${prefix}:unitsReceived`, TTL_5_HOURS);
      }
    }
  } else {
    if (/tower completed|floor reached/i.test(cleanText)) {
      await redisCmd('incrby', `${prefix}:towerSelesai`, 1);
      await redisCmd('expire', `${prefix}:towerSelesai`, TTL_5_HOURS);
    }
  }

  const gemsMatch = cleanText.match(/Gems:\s*x?([\d,]+)/i);
  if (gemsMatch) {
    const gemsVal = parseInt(gemsMatch[1].replace(/,/g, ''), 10);
    if (!isNaN(gemsVal)) {
      await redisCmd('incrby', `${prefix}:totalGems`, gemsVal);
      await redisCmd('expire', `${prefix}:totalGems`, TTL_5_HOURS);
    }
  }

  const traitMatch = cleanText.match(/Trait Reroll:\s*x?([\d,]+)/i);
  if (traitMatch) {
    const traitVal = parseInt(traitMatch[1].replace(/,/g, ''), 10);
    if (!isNaN(traitVal)) {
      await redisCmd('incrby', `${prefix}:totalTraitReroll`, traitVal);
      await redisCmd('expire', `${prefix}:totalTraitReroll`, TTL_5_HOURS);
    }
  }

  const lines = cleanText.split('\n');
  for (const line of lines) {
    const itemMatch = line.match(/([A-Za-z0-9'\s]+):\s*x([\d,]+)/);
    if (itemMatch) {
      const itemName = itemMatch[1].trim();
      const qty = parseInt(itemMatch[2].replace(/,/g, ''), 10);
      const ignoredKeys = ['Gems', 'Trait Reroll', 'Level', 'Floor Reached', 'Name', 'Rarity', 'Tier', 'Grade', 'Cash/s'];
      if (!ignoredKeys.includes(itemName) && !isNaN(qty)) {
        await redisCmd('hincrby', `${prefix}:potions`, itemName, qty);
        await redisCmd('expire', `${prefix}:potions`, TTL_5_HOURS);
      }
    }
  }

  await checkOfflineAccounts(user);
}

function checkRareAlert(text) {
  if (!text) return false;
  const lower = text.toLowerCase();

  const hasHigherUnitPrefix = /1\/\d+(\.\d+)?(qi|sx|sp|oc|no|dc)/i.test(lower);
  if (hasHigherUnitPrefix) return true;

  const qdMatch = lower.match(/1\/(\d+(\.\d+)?)qd/i);
  if (qdMatch) {
    const qdVal = parseFloat(qdMatch[1]);
    if (!isNaN(qdVal) && qdVal >= 500) return true;
  }

  return false;
}

function parseDiscordEmbed(embed) {
  const parts = [];
  if (embed.title) parts.push(`*${embed.title}*`);
  if (embed.description) parts.push(embed.description);

  if (Array.isArray(embed.fields) && embed.fields.length > 0) {
    const fieldsText = embed.fields
      .map(field => `*${field.name}:*\n${field.value}`)
      .join('\n\n');
    parts.push(fieldsText);
  }
  return parts.join('\n\n');
}

async function sendTelegramMessage(chatId, text) {
  const url = `${CONFIG.TELEGRAM_BASE_URL}${CONFIG.BOT_TOKEN}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      })
    });
  } catch (err) {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        disable_web_page_preview: true
      })
    });
  }
}

module.exports = async (req, res) => {
  // 1. CEK STATUS DARI MEMORI LOKAL (0% Redis Usage saat status OFF)
  if (!system.getStatus()) {
    return res.status(200).json({ 
      status: 'offline', 
      message: 'System Analytics is TOTALLY OFF (Zero DB usage)' 
    });
  }

  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'online', message: 'Webhook Gateway Active' });
  }

  try {
    let payload = req.body;

    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = { content: payload };
      }
    }

    let fullTextToScan = '';
    let messageBody = '';

    if (Array.isArray(payload?.embeds) && payload.embeds.length > 0) {
      const embed = payload.embeds[0];
      messageBody = parseDiscordEmbed(embed);

      fullTextToScan += `${embed.title || ''}\n${embed.description || ''}\n`;
      if (Array.isArray(embed.fields)) {
        embed.fields.forEach(f => {
          fullTextToScan += `${f.name}: ${f.value}\n`;
        });
      }
    } else {
      messageBody = payload?.content || payload?.message || JSON.stringify(payload);
      fullTextToScan = messageBody;
    }

    const cleanUsername = extractCleanUsername(payload?.username, fullTextToScan);
    const timeWIB = getCurrentTimeWIB();
    const eventType = payload?.event_type || 'normal';

    await scanAndAccumulate(cleanUsername, fullTextToScan);

    let formattedMessage = '';
    const isRare = checkRareAlert(fullTextToScan);
    const alertPrefix = isRare ? `🚨 *[HIGH-VALUE DROP DETECTED]* 🚨\n` : '';

    if (eventType === 'error') {
      formattedMessage = `*[ERROR LOG]*\nUsername: *${cleanUsername}*\nWaktu: ${timeWIB}\n────────────────\n${payload?.error_message || 'Error pada script.'}`;
    } else if (eventType === 'disconnect') {
      formattedMessage = `*[DISCONNECT ALERT]*\nUsername: *${cleanUsername}*\nWaktu: ${timeWIB}\n────────────────\nScript terputus dari server!`;
    } else {
      formattedMessage = `${alertPrefix}Username: *${cleanUsername}*\nWaktu: ${timeWIB}\n────────────────\n${messageBody}`;
    }

    await sendTelegramMessage(CONFIG.CHAT_ID, formattedMessage);

    return res.status(200).json({ success: true, status: 'scanned_and_saved' });

  } catch (error) {
    console.error('[Webhook Processing Error]:', error.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
