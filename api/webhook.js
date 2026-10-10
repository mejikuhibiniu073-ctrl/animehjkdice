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
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit',
    day: '2-digit', month: 'short', year: 'numeric'
  });
}

function extractCleanUsername(rawName, fullText = '') {
  const clean = fullText.replace(/\*\*/g, '');
  const match = clean.match(/Username:\s*\|\|([^|]+)\|\|/i) || clean.match(/Username:\s*([^\r\n]+)/i);
  if (match) return match[1].replace(/\|\|/g, '').trim();
  return rawName ? rawName.replace(/\|\||\*\*/g, '').trim() : 'Roblox Script';
}

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

async function checkOfflineAccounts(currentActiveUser) {
  let users = await redisCmd('smembers', 'stats:users') || [];
  if (!Array.isArray(users)) users = [users];
  const now = Date.now();

  await Promise.all(users.map(async (user) => {
    if (user === currentActiveUser) return;
    const prefix = `stats:${user}`;
    const [lastSeen, isAlerted] = await Promise.all([
      redisCmd('get', `${prefix}:lastSeen`),
      redisCmd('get', `${prefix}:offlineAlerted`)
    ]);

    if (lastSeen && (now - parseInt(lastSeen, 10)) > OFFLINE_THRESHOLD_MS && !isAlerted) {
      const min = Math.floor((now - parseInt(lastSeen, 10)) / 60000);
      const msg = `🚨 *[ALERT AKUN OFFLINE]*\n\n👤 Akun: *${user}*\n⚠️ Status: Tidak ada laporan masuk selama *${min} menit*!`;
      await sendTelegramMessage(CONFIG.CHAT_ID, msg);
      await redisCmd('set', `${prefix}:offlineAlerted`, 'true');
      await redisCmd('expire', `${prefix}:offlineAlerted`, 3600);
    }
  }));
}

async function scanAndAccumulate(user, text, rawLen) {
  if (!text) return;
  const prefix = `stats:${user}`;
  const now = Date.now();

  // Inisialisasi Uptime & Metrik Global (Dipertahankan saat reset)
  const globalUptime = await redisCmd('get', 'global:system_start_time');
  if (!globalUptime) await redisCmd('set', 'global:system_start_time', now);

  await Promise.all([
    redisCmd('set', `${prefix}:lastSeen`, now),
    redisCmd('expire', `${prefix}:lastSeen`, TTL_5_HOURS),
    redisCmd('del', `${prefix}:offlineAlerted`),
    redisCmd('incrby', `${prefix}:totalLaporan`, 1),
    redisCmd('expire', `${prefix}:totalLaporan`, TTL_5_HOURS),
    redisCmd('sadd', 'stats:users', user),
    redisCmd('incrby', 'global:total_commands', 1),
    redisCmd('incrby', 'global:total_bytes', (rawLen || text.length) + 120)
  ]);

  const startTime = await redisCmd('get', `${prefix}:startTime`);
  if (!startTime) await redisCmd('set', `${prefix}:startTime`, now);
  await redisCmd('expire', `${prefix}:startTime`, TTL_5_HOURS);

  const cleanText = text.replace(/\*\*/g, '');

  // 1. Scan Unit Drop
  if (/Cash\/s|Plot Avg|Grade:|Tier:|New Unit!/i.test(cleanText) && /(?:Name|Unit):/i.test(cleanText)) {
    const nameMatch = cleanText.match(/(?:Name|Unit):\s*([^\r\n]+)/i);
    if (nameMatch) {
      const rawUnit = nameMatch[1].replace(/\|\|/g, '').trim();
      if (rawUnit && !['roblox script', 'stats', 'webhook'].includes(rawUnit.toLowerCase())) {
        const rarity = cleanText.match(/Rarity:\s*([^\r\n]+)/i);
        const mutation = cleanText.match(/Mutation:\s*([^\r\n]+)/i);
        const chance = cleanText.match(/1\/\d+(\.\d+)?[a-zA-Z]+/i);

        let unitInfo = rawUnit;
        if (rarity) unitInfo += ` [${rarity[1].replace(/\|\|/g, '').trim()}]`;
        if (mutation) unitInfo += ` (${mutation[1].replace(/\|\|/g, '').trim()})`;
        if (chance) unitInfo += ` [${chance[0]}]`;

        await Promise.all([
          redisCmd('incrby', `${prefix}:unitMasukTas`, 1),
          redisCmd('expire', `${prefix}:unitMasukTas`, TTL_5_HOURS),
          redisCmd('rpush', `${prefix}:unitsReceived`, unitInfo),
          redisCmd('expire', `${prefix}:unitsReceived`, TTL_5_HOURS)
        ]);
      }
    }
  }

  // 2. Scan Tower / Floor
  const towerName = cleanText.match(/(?:Tower|Floor|Mode|Dungeon|Map):\s*([^\r\n]+)/i);
  const floor = cleanText.match(/(?:Floor|Lantai|Stage|Reached):\s*([\d]+)/i) || cleanText.match(/(?:Completed|Finished)\s*(?:Floor|Lantai)?\s*([\d]+)?/i);
  if (towerName || floor || /tower completed|floor reached/i.test(cleanText)) {
    const tName = towerName ? towerName[1].replace(/\|\|/g, '').trim() : 'Tower Mode';
    const fVal = floor && floor[1] ? floor[1].trim() : 'Selesai';
    const towerEntry = `${tName} (Lantai: ${fVal})`;

    await Promise.all([
      redisCmd('incrby', `${prefix}:towerSelesai`, 1),
      redisCmd('expire', `${prefix}:towerSelesai`, TTL_5_HOURS),
      redisCmd('rpush', `${prefix}:towerList`, towerEntry),
      redisCmd('expire', `${prefix}:towerList`, TTL_5_HOURS)
    ]);
  }

  // 3. Scan Gems & Trait
  const gems = cleanText.match(/Gems:\s*x?([\d,]+)/i);
  if (gems) {
    const val = parseInt(gems[1].replace(/,/g, ''), 10);
    if (!isNaN(val)) await redisCmd('incrby', `${prefix}:totalGems`, val);
  }

  const trait = cleanText.match(/Trait Reroll:\s*x?([\d,]+)/i);
  if (trait) {
    const val = parseInt(trait[1].replace(/,/g, ''), 10);
    if (!isNaN(val)) await redisCmd('incrby', `${prefix}:totalTraitReroll`, val);
  }

  // 4. Scan Items & Potions
  const ignored = ['Gems', 'Trait Reroll', 'Level', 'Floor Reached', 'Name', 'Rarity', 'Tier', 'Grade', 'Cash/s'];
  cleanText.split('\n').forEach(async (line) => {
    const m = line.match(/([A-Za-z0-9'\s]+):\s*x([\d,]+)/);
    if (m && !ignored.includes(m[1].trim())) {
      const qty = parseInt(m[2].replace(/,/g, ''), 10);
      if (!isNaN(qty)) await redisCmd('hincrby', `${prefix}:potions`, m[1].trim(), qty);
    }
  });

  await checkOfflineAccounts(user);
}

function checkRareAlert(text = '') {
  const lower = text.toLowerCase();
  if (/1\/\d+(\.\d+)?(qi|sx|sp|oc|no|dc)/i.test(lower)) return true;
  const qd = lower.match(/1\/(\d+(\.\d+)?)qd/i);
  return qd && parseFloat(qd[1]) >= 500;
}

async function sendTelegramMessage(chatId, text) {
  const url = `${CONFIG.TELEGRAM_BASE_URL}${CONFIG.BOT_TOKEN}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true });
  try {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  } catch (e) {}
}

module.exports = async (req, res) => {
  if (!system.getStatus()) {
    return res.status(200).json({ status: 'offline', message: 'System Analytics is TOTALLY OFF (Zero DB usage)' });
  }
  if (req.method !== 'POST') return res.status(200).json({ status: 'online', message: 'Webhook Gateway Active' });

  try {
    let payload = req.body;
    const rawLen = JSON.stringify(payload).length;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch { payload = { content: payload }; }
    }

    let fullText = '', messageBody = '';
    if (Array.isArray(payload?.embeds) && payload.embeds.length > 0) {
      const embed = payload.embeds[0];
      messageBody = [embed.title && `*${embed.title}*`, embed.description, embed.fields?.map(f => `*${f.name}:*\n${f.value}`).join('\n\n')].filter(Boolean).join('\n\n');
      fullText = `${embed.title || ''}\n${embed.description || ''}\n` + (embed.fields?.map(f => `${f.name}: ${f.value}`).join('\n') || '');
    } else {
      messageBody = payload?.content || payload?.message || JSON.stringify(payload);
      fullText = messageBody;
    }

    const cleanUser = extractCleanUsername(payload?.username, fullText);
    const timeWIB = getCurrentTimeWIB();
    const isRare = checkRareAlert(fullText);

    await scanAndAccumulate(cleanUser, fullText, rawLen);

    let formattedMsg = isRare ? `🚨 *[HIGH-VALUE DROP DETECTED]* 🚨\n` : '';
    formattedMsg += `Username: *${cleanUser}*\nWaktu: ${timeWIB}\n────────────────\n${messageBody}`;

    await sendTelegramMessage(CONFIG.CHAT_ID, formattedMsg);
    return res.status(200).json({ success: true, status: 'scanned_and_saved' });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
