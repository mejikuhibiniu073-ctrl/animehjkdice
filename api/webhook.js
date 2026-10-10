const CONFIG = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  CHAT_ID: '1315912406',
  TELEGRAM_BASE_URL: 'https://api.telegram.org/bot',
  REDIS_URL: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  REDIS_TOKEN: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
};

const TTL_5_HOURS = 18000;

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
    const formattedArgs = args.map(arg => encodeURIComponent(String(arg))).join('/');
    const res = await fetch(`${CONFIG.REDIS_URL}/${command}/${formattedArgs}`, {
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
  await redisCmd('expire', `${prefix}:totalLaporan`, TTL_5_HOURS);
  await redisCmd('sadd', 'stats:users', user);

  const startTime = await redisCmd('get', `${prefix}:startTime`);
  if (!startTime) {
    await redisCmd('set', `${prefix}:startTime`, now);
    await redisCmd('expire', `${prefix}:startTime`, TTL_5_HOURS);
  } else {
    await redisCmd('expire', `${prefix}:startTime`, TTL_5_HOURS);
  }

  const isUnitMessage = /new unit|unit received|got unit|received unit|unit:/i.test(text);
  if (isUnitMessage) {
    await redisCmd('incrby', `${prefix}:unitMasukTas`, 1);
    await redisCmd('expire', `${prefix}:unitMasukTas`, TTL_5_HOURS);

    const nameMatch = text.match(/(?:Name|Unit):\s*([^\r\n]+)/i);
    const mutationMatch = text.match(/Mutation:\s*([^\r\n]+)/i);
    const rarityMatch = text.match(/Rarity:\s*([^\r\n]+)/i);

    if (nameMatch) {
      let unitInfo = nameMatch[1].replace(/\|\|/g, '').trim();
      if (mutationMatch) unitInfo += ` (${mutationMatch[1].replace(/\|\|/g, '').trim()})`;
      if (rarityMatch) unitInfo += ` [${rarityMatch[1].replace(/\|\|/g, '').trim()}]`;

      await redisCmd('rpush', `${prefix}:unitsReceived`, unitInfo);
      await redisCmd('expire', `${prefix}:unitsReceived`, TTL_5_HOURS);
    }
  }

  if (/tower completed/i.test(text)) {
    await redisCmd('incrby', `${prefix}:towerSelesai`, 1);
    await redisCmd('expire', `${prefix}:towerSelesai`, TTL_5_HOURS);
  }

  const gemsMatch = text.match(/Gems:\s*x?([\d,]+)/i);
  if (gemsMatch) {
    const gemsVal = parseInt(gemsMatch[1].replace(/,/g, ''), 10);
    if (!isNaN(gemsVal)) {
      await redisCmd('incrby', `${prefix}:totalGems`, gemsVal);
      await redisCmd('expire', `${prefix}:totalGems`, TTL_5_HOURS);
    }
  }

  const traitMatch = text.match(/Trait Reroll:\s*x?([\d,]+)/i);
  if (traitMatch) {
    const traitVal = parseInt(traitMatch[1].replace(/,/g, ''), 10);
    if (!isNaN(traitVal)) {
      await redisCmd('incrby', `${prefix}:totalTraitReroll`, traitVal);
      await redisCmd('expire', `${prefix}:totalTraitReroll`, TTL_5_HOURS);
    }
  }

  const lines = text.split('\n');
  for (const line of lines) {
    const itemMatch = line.match(/([A-Za-z0-9'\s]+):\s*x([\d,]+)/);
    if (itemMatch) {
      const itemName = itemMatch[1].trim();
      const qty = parseInt(itemMatch[2].replace(/,/g, ''), 10);
      if (!['Gems', 'Trait Reroll', 'Level', 'Floor Reached'].includes(itemName) && !isNaN(qty)) {
        await redisCmd('hincrby', `${prefix}:potions`, itemName, qty);
        await redisCmd('expire', `${prefix}:potions`, TTL_5_HOURS);
      }
    }
  }
}

function checkRareAlert(text) {
  if (!text) return false;
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

function generateSmartInsights(gemsPerHour, traitPerHour, totalLaporan, unitCount) {
  const insights = [];
  if (gemsPerHour > 300) {
    insights.push('🔥 Performa farming Gems sangat tinggi.');
  } else if (gemsPerHour < 100) {
    insights.push('⚠️ Performa Gems tergolong rendah.');
  } else {
    insights.push('✅ Kecepatan farming Gems stabil.');
  }

  if (traitPerHour > 100) {
    insights.push('⚡ Trait Reroll terkumpul sangat cepat.');
  }

  if (unitCount > 0) {
    insights.push(`🎉 Berhasil mendapatkan ${unitCount} unit baru.`);
  }

  return insights.join('\n    • ');
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

      if (userText === '/vel') {
        const welcomeText = `Selamat datang di Roblox Webhook Monitoring Bot!\n\n` +
          `Berikut adalah daftar perintah yang tersedia:\n` +
          `• /stats - Menampilkan akumulasi statistik dan estimasi rate per jam\n` +
          `• /reset - Mengosongkan seluruh data penyimpanan database`;

        await sendTelegramMessage(chatId, welcomeText);
        return res.status(200).json({ success: true });
      }

      if (userText === '/reset') {
        await redisCmd('set', 'system:pending_reset', 'true');
        await redisCmd('expire', 'system:pending_reset', 300);

        const alertText = `⚠️ *PERINGATAN KONFIRMASI RESET*\n\n` +
          `Apakah Anda yakin ingin menghapus seluruh data statistik dan mengosongkan penyimpanan database?\n\n` +
          `• Ketik /confirm untuk melanjutkan penghapusan.\n` +
          `• Ketik /false untuk membatalkan.`;

        await sendTelegramMessage(chatId, alertText);
        return res.status(200).json({ success: true });
      }

      if (userText === '/confirm') {
        const isPending = await redisCmd('get', 'system:pending_reset');

        if (isPending) {
          await redisCmd('flushall');
          await sendTelegramMessage(chatId, `dibatalkan\nSeluruh data akumulasi dan penyimpanan database telah dihapus total.`);
        } else {
          await sendTelegramMessage(chatId, `❌ *Sesi Konfirmasi Kadaluarsa*\nSilakan ketik /reset terlebih dahulu.`);
        }
        return res.status(200).json({ success: true });
      }

      if (userText === '/false') {
        await redisCmd('del', 'system:pending_reset');
        await sendTelegramMessage(chatId, `✅ *Dibatalkan*\nProses penghapusan database telah dibatalkan.`);
        return res.status(200).json({ success: true });
      }

      if (userText === '/stats') {
        let users = await redisCmd('smembers', 'stats:users');
        if (!Array.isArray(users)) {
          users = users ? [users] : [];
        }

        if (users.length === 0) {
          await sendTelegramMessage(chatId, `*Hasil Akumulasi Scanning Bot (Sesi 5 Jam)*\nBelum ada data statistik yang masuk.`);
          return res.status(200).json({ success: true });
        }

        let reportText = `*Hasil Akumulasi Scanning Bot (Sesi 5 Jam)*\nWaktu Cetak: ${getCurrentTimeWIB()}\n────────────────\n`;

        for (const user of users) {
          const prefix = `stats:${user}`;
          const totalLaporan = parseInt((await redisCmd('get', `${prefix}:totalLaporan`)) || 0, 10);
          const unitMasukTas = parseInt((await redisCmd('get', `${prefix}:unitMasukTas`)) || 0, 10);
          const towerSelesai = parseInt((await redisCmd('get', `${prefix}:towerSelesai`)) || 0, 10);
          const totalGems = parseInt((await redisCmd('get', `${prefix}:totalGems`)) || 0, 10);
          const totalTraitReroll = parseInt((await redisCmd('get', `${prefix}:totalTraitReroll`)) || 0, 10);
          const startTime = parseInt((await redisCmd('get', `${prefix}:startTime`)) || Date.now(), 10);

          let unitsReceived = await redisCmd('lrange', `${prefix}:unitsReceived`, 0, -1);
          if (!Array.isArray(unitsReceived)) {
            unitsReceived = unitsReceived ? [unitsReceived] : [];
          }

          const potionsRaw = (await redisCmd('hgetall', `${prefix}:potions`)) || [];

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
          if (unitsReceived.length > 0) {
            unitList = unitsReceived
              .map(u => `    • ${u}`)
              .join('\n');
          }

          const smartInsights = generateSmartInsights(gemsPerHour, traitPerHour, totalLaporan, unitsReceived.length);

          reportText += `👤 *Akun: ${user}*\n` +
            `  • Total Laporan Diproses: *${totalLaporan}*\n` +
            `  • Unit Masuk Tas: *${unitMasukTas}*\n` +
            `  • Tower Selesai: *${towerSelesai}*\n` +
            `  • Total Gems: *x${totalGems}*\n` +
            `  • Total Trait Reroll: *x${totalTraitReroll}*\n` +
            `  📈 *Estimasi Rate / Jam:*\n` +
            `    • ~${gemsPerHour} Gems/Jam\n` +
            `    • ~${traitPerHour} Trait/Jam\n` +
            `  💡 *Smart Insights:*\n` +
            `    • ${smartInsights}\n` +
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
                               
