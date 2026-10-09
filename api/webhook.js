const CONFIG = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  CHAT_ID: '1315912406',
  TELEGRAM_BASE_URL: 'https://api.telegram.org/bot',
  REDIS_URL: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  REDIS_TOKEN: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
};

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

// Helper Interaksi Upstash Redis REST API
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

// Atur TTL 30 Menit (1800 Detik)
const TTL_30_MIN = 1800;

async function scanAndAccumulate(text) {
  if (!text) return;

  // Akumulasi Total Laporan
  await redisCmd('incrby', 'stats:totalLaporan', 1);
  await redisCmd('expire', 'stats:totalLaporan', TTL_30_MIN);

  // Scan Unit Baru
  if (text.includes('New Unit!')) {
    await redisCmd('incrby', 'stats:unitMasukTas', 1);
    await redisCmd('expire', 'stats:unitMasukTas', TTL_30_MIN);

    const nameMatch = text.match(/Name:\s*([^\r\n]+)/i);
    const mutationMatch = text.match(/Mutation:\s*([^\r\n]+)/i);
    const rarityMatch = text.match(/Rarity:\s*([^\r\n]+)/i);

    if (nameMatch) {
      let unitInfo = nameMatch[1].trim();
      if (mutationMatch) unitInfo += ` (${mutationMatch[1].trim()})`;
      if (rarityMatch) unitInfo += ` [${rarityMatch[1].trim()}]`;
      await redisCmd('rpush', 'stats:unitsReceived', unitInfo);
      await redisCmd('expire', 'stats:unitsReceived', TTL_30_MIN);
    }
  }

  // Scan Tower Completed
  if (text.includes('Tower Completed!')) {
    await redisCmd('incrby', 'stats:towerSelesai', 1);
    await redisCmd('expire', 'stats:towerSelesai', TTL_30_MIN);
  }

  // Scan Gems
  const gemsMatch = text.match(/Gems:\s*x?(\d+)/i);
  if (gemsMatch) {
    await redisCmd('incrby', 'stats:totalGems', parseInt(gemsMatch[1], 10));
    await redisCmd('expire', 'stats:totalGems', TTL_30_MIN);
  }

  // Scan Trait Reroll
  const traitMatch = text.match(/Trait Reroll:\s*x?(\d+)/i);
  if (traitMatch) {
    await redisCmd('incrby', 'stats:totalTraitReroll', parseInt(traitMatch[1], 10));
    await redisCmd('expire', 'stats:totalTraitReroll', TTL_30_MIN);
  }

  // Scan Potions / Items
  const lines = text.split('\n');
  for (const line of lines) {
    const itemMatch = line.match(/([A-Za-z0-9'\s]+):\s*x(\d+)/);
    if (itemMatch) {
      const itemName = itemMatch[1].trim();
      const qty = parseInt(itemMatch[2], 10);
      if (!['Gems', 'Trait Reroll', 'Level', 'Floor Reached'].includes(itemName)) {
        await redisCmd('hincrby', 'stats:potions', itemName, qty);
        await redisCmd('expire', 'stats:potions', TTL_30_MIN);
      }
    }
  }
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

    // 1. Respon Perintah dari Telegram (/stats)
    if (payload && payload.message) {
      const chatId = payload.message.chat.id;
      const userText = (payload.message.text || '').toLowerCase();

      if (userText === '/start') {
        await sendTelegramMessage(chatId, `Bot Online\n\nID Telegram Anda: \`${chatId}\``);
        return res.status(200).json({ success: true });
      }

      if (userText === '/stats') {
        const totalLaporan = (await redisCmd('get', 'stats:totalLaporan')) || 0;
        const unitMasukTas = (await redisCmd('get', 'stats:unitMasukTas')) || 0;
        const towerSelesai = (await redisCmd('get', 'stats:towerSelesai')) || 0;
        const totalGems = (await redisCmd('get', 'stats:totalGems')) || 0;
        const totalTraitReroll = (await redisCmd('get', 'stats:totalTraitReroll')) || 0;
        const unitsReceived = (await redisCmd('lrange', 'stats:unitsReceived', 0, -1)) || [];
        const potionsRaw = (await redisCmd('hgetall', 'stats:potions')) || [];

        // Formatting Item
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
            .map(name => `  • ${name}: x${potionsObj[name]}`)
            .join('\n');
        }

        let unitList = 'Belum ada';
        if (Array.isArray(unitsReceived) && unitsReceived.length > 0) {
          unitList = unitsReceived
            .map(u => `  • ${u}`)
            .join('\n');
        }

        const reportText = `*Hasil Akumulasi Scanning Bot (Sesi 30 Menit)*\n` +
          `Waktu Cetak: ${getCurrentTimeWIB()}\n────────────────\n` +
          `• Total Laporan Diproses: *${totalLaporan}*\n` +
          `• Unit Masuk Tas: *${unitMasukTas}*\n` +
          `• Tower Selesai: *${towerSelesai}*\n\n` +
          `*Daftar Unit Diterima:*\n${unitList}\n\n` +
          `*Total Drops:*\n` +
          `  • Total Gems: *x${totalGems}*\n` +
          `  • Total Trait Reroll: *x${totalTraitReroll}*\n\n` +
          `*Item / Potion Diterima:*\n${itemList}`;

        await sendTelegramMessage(chatId, reportText);
        return res.status(200).json({ success: true });
      }

      await sendTelegramMessage(chatId, `Pesan diterima: "${payload.message.text}"`);
      return res.status(200).json({ success: true });
    }

    // 2. Pemindaian DAN Pengiriman Pesan dari Roblox
    const senderName = payload?.username || 'Roblox Script';
    const timeWIB = getCurrentTimeWIB();
    const eventType = payload?.event_type || 'normal';

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

    await scanAndAccumulate(fullTextToScan);

    let formattedMessage = '';
    if (eventType === 'error') {
      formattedMessage = `*[ERROR LOG]*\nUsername: *${senderName}*\nWaktu: ${timeWIB}\n────────────────\n${payload?.error_message || 'Error pada script.'}`;
    } else if (eventType === 'disconnect') {
      formattedMessage = `*[DISCONNECT ALERT]*\nUsername: *${senderName}*\nWaktu: ${timeWIB}\n────────────────\nScript terputus dari server!`;
    } else {
      formattedMessage = `Username: *${senderName}*\nWaktu: ${timeWIB}\n────────────────\n${messageBody}`;
    }

    await sendTelegramMessage(CONFIG.CHAT_ID, formattedMessage);

    return res.status(200).json({ success: true, status: 'scanned_and_saved' });

  } catch (error) {
    console.error('[Webhook Error]:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
};
