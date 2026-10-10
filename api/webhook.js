const CONFIG = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  CHAT_ID: '1315912406',
  TELEGRAM_BASE_URL: 'https://api.telegram.org/bot',
  REDIS_URL: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  REDIS_TOKEN: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
};

const TTL_30_MIN = 1800;

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
  const bodyUserMatch = fullText.match(/Username:\s*\|\|([^|]+)\|\|/i);
  if (bodyUserMatch) {
    return bodyUserMatch[1].trim();
  }

  const plainUserMatch = fullText.match(/Username:\s*([^\r\n]+)/i);
  if (plainUserMatch) {
    return plainUserMatch[1].replace(/\|\|/g, '').trim();
  }

  if (rawName) {
    return rawName.replace(/\|\|/g, '').trim();
  }

  return 'Roblox Script';
}

async function redisCmd(command, ...args) {
  if (!CONFIG.REDIS_URL || !CONFIG.REDIS_TOKEN) return null;
  try {
    const res = await fetch(`${CONFIG.REDIS_URL}/${command}/${args.map(encodeURIComponent).join('/')}`, {
      headers: { Authorization: `Bearer ${CONFIG.REDIS_TOKEN}` }
    });
    const data = await res.json();
    return data.result;
  } catch (e) {
    console.error('Redis error:', e);
    return null;
  }
}

async function scanAndAccumulate(user, text) {
  if (!text) return;

  const prefix = `stats:${user}`;
  const now = Date.now();

  await redisCmd('incrby', `${prefix}:totalLaporan`, 1);
  await redisCmd('expire', `${prefix}:totalLaporan`, TTL_30_MIN);
  await redisCmd('sadd', 'stats:users', user);

  // Catat waktu laporan pertama jika belum ada
  const startTime = await redisCmd('get', `${prefix}:startTime`);
  if (!startTime) {
    await redisCmd('set', `${prefix}:startTime`, now);
    await redisCmd('expire', `${prefix}:startTime`, TTL_30_MIN);
  } else {
    await redisCmd('expire', `${prefix}:startTime`, TTL_30_MIN);
  }

  if (text.includes('New Unit!')) {
    await redisCmd('incrby', `${prefix}:unitMasukTas`, 1);
    await redisCmd('expire', `${prefix}:unitMasukTas`, TTL_30_MIN);

    const nameMatch = text.match(/Name:\s*([^\r\n]+)/i);
    const mutationMatch = text.match(/Mutation:\s*([^\r\n]+)/i);
    const rarityMatch = text.match(/Rarity:\s*([^\r\n]+)/i);

    if (nameMatch) {
      let unitInfo = nameMatch[1].trim();
      if (mutationMatch) unitInfo += ` (${mutationMatch[1].trim()})`;
      if (rarityMatch) unitInfo += ` [${rarityMatch[1].trim()}]`;
      await redisCmd('rpush', `${prefix}:unitsReceived`, unitInfo);
      await redisCmd('expire', `${prefix}:unitsReceived`, TTL_30_MIN);
    }
  }

  if (text.includes('Tower Completed!')) {
    await redisCmd('incrby', `${prefix}:towerSelesai`, 1);
    await redisCmd('expire', `${prefix}:towerSelesai`, TTL_30_MIN);
  }

  const gemsMatch = text.match(/Gems:\s*x?(\d+)/i);
  if (gemsMatch) {
    await redisCmd('incrby', `${prefix}:totalGems`, parseInt(gemsMatch[1], 10));
    await redisCmd('expire', `${prefix}:totalGems`, TTL_30_MIN);
  }

  const traitMatch = text.match(/Trait Reroll:\s*x?(\d+)/i);
  if (traitMatch) {
    await redisCmd('incrby', `${prefix}:totalTraitReroll`, parseInt(traitMatch[1], 10));
    await redisCmd('expire', `${prefix}:totalTraitReroll`, TTL_30_MIN);
  }

  const lines = text.split('\n');
  for (const line of lines) {
    const itemMatch = line.match(/([A-Za-z0-9'\s]+):\s*x(\d+)/);
    if (itemMatch) {
      const itemName = itemMatch[1].trim();
      const qty = parseInt(itemMatch[2], 10);
      if (!['Gems', 'Trait Reroll', 'Level', 'Floor Reached'].includes(itemName)) {
        await redisCmd('hincrby', `${prefix}:potions`, itemName, qty);
        await redisCmd('expire', `${prefix}:potions`, TTL_30_MIN);
      }
    }
  }
}

function checkRareAlert(text) {
  const lower = text.toLowerCase();
  return lower.includes('secret') || lower.includes('monarch') || lower.includes('mythic');
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

    if (payload && payload.message) {
      const chatId = payload.message.chat.id;
      const userText = (payload.message.text || '').trim();

      if (userText === '/start') {
        await sendTelegramMessage(chatId, `Bot Online\n\nID Telegram Anda: \`${chatId}\``);
        return res.status(200).json({ success: true });
      }

      if (userText === '/reset') {
        await redisCmd('flushdb');
        await sendTelegramMessage(chatId, `*Statistik Berhasil Dihapus!*\nSeluruh data akumulasi telah di-reset ke awal.`);
        return res.status(200).json({ success: true });
      }

      if (userText === '/stats') {
        const users = (await redisCmd('smembers', 'stats:users')) || [];

        if (!Array.isArray(users) || users.length === 0) {
          await sendTelegramMessage(chatId, `*Hasil Akumulasi Scanning Bot (Sesi 30 Menit)*\nBelum ada data statistik yang masuk.`);
          return res.status(200).json({ success: true });
        }

        let reportText = `*Hasil Akumulasi Scanning Bot (Sesi 30 Menit)*\nWaktu Cetak: ${getCurrentTimeWIB()}\n────────────────\n`;

        for (const user of users) {
          const prefix = `stats:${user}`;
          const totalLaporan = parseInt((await redisCmd('get', `${prefix}:totalLaporan`)) || 0, 10);
          const unitMasukTas = parseInt((await redisCmd('get', `${prefix}:unitMasukTas`)) || 0, 10);
          const towerSelesai = parseInt((await redisCmd('get', `${prefix}:towerSelesai`)) || 0, 10);
          const totalGems = parseInt((await redisCmd('get', `${prefix}:totalGems`)) || 0, 10);
          const totalTraitReroll = parseInt((await redisCmd('get', `${prefix}:totalTraitReroll`)) || 0, 10);
          const startTime = parseInt((await redisCmd('get', `${prefix}:startTime`)) || Date.now(), 10);
          const unitsReceived = (await redisCmd('lrange', `${prefix}:unitsReceived`, 0, -1)) || [];
          const potionsRaw = (await redisCmd('hgetall', `${prefix}:potions`)) || [];

          // Hitung Durasi dan Rate
          const durationHours = Math.max((Date.now() - startTime) / (1000 * 60 * 60), 0.01);
          const gemsPerHour = Math.round(totalGems / durationHours);
          const traitPerHour = Math.round(totalTraitReroll / durationHours);

          const potionsObj = {};
          if (Array.isArray(potionsRaw)) {
            for (let i = 0; i < potionsRaw.length; i += 2) {
              potionsObj[potionsRaw[i]] = potionsRaw[i + 1];
            }
          } else if (typeof potionsRaw === 'object' && potionsRaw !== null) {
            Object.assign(potionsObj, potionsRaw);
          }

          let itemList = 'Belum ada';
          const sortedItems = Object.keys(potionsObj).sort((a, b) => a.localeCompare(b));
          if (sortedItems.length > 0) {
            itemList = sortedItems
              .map(name => `    • ${name}: x${potionsObj[name]}`)
              .join('\n');
          }

          let unitList = 'Belum ada';
          if (Array.isArray(unitsReceived) && unitsReceived.length > 0) {
            unitList = unitsReceived
              .map(u => `    • ${u}`)
              .join('\n');
          }

          reportText += `👤 *Akun: ${user}*\n` +
            `  • Total Laporan Diproses: *${totalLaporan}*\n` +
            `  • Unit Masuk Tas: *${unitMasukTas}*\n` +
            `  • Tower Selesai: *${towerSelesai}*\n` +
            `  • Total Gems: *x${totalGems}*\n` +
            `  • Total Trait Reroll: *x${totalTraitReroll}*\n` +
            `  📈 *Estimasi Rate / Jam:*\n` +
            `    • ~${gemsPerHour} Gems/Jam\n` +
            `    • ~${traitPerHour} Trait/Jam\n` +
            `  *Daftar Unit Diterima:*\n${unitList}\n` +
            `  *Item / Potion Diterima:*\n${itemList}\n────────────────\n`;
        }

        await sendTelegramMessage(chatId, reportText);
        return res.status(200).json({ success: true });
      }

      await sendTelegramMessage(chatId, `Pesan diterima: "${payload.message.text}"`);
      return res.status(200).json({ success: true });
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
    console.error('[Webhook Error]:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
};
