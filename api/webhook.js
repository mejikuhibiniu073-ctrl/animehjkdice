const axios = require('axios');

const CONFIG = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  CHAT_ID: '1315912406',
  TELEGRAM_BASE_URL: 'https://api.telegram.org/bot'
};

const stats = {
  totalLaporan: 0,
  unitMasukTas: 0,
  towerSelesai: 0,
  totalGems: 0,
  totalTraitReroll: 0,
  unitsReceived: [],
  potions: {}
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

function scanIncomingText(text) {
  if (text.includes('New Unit!')) {
    stats.unitMasukTas += 1;
    const nameMatch = text.match(/Name:\s*([^\r\n]+)/i);
    const mutationMatch = text.match(/Mutation:\s*([^\r\n]+)/i);
    const rarityMatch = text.match(/Rarity:\s*([^\r\n]+)/i);

    if (nameMatch) {
      let unitInfo = nameMatch[1].trim();
      if (mutationMatch) unitInfo += ` (${mutationMatch[1].trim()})`;
      if (rarityMatch) unitInfo += ` [${rarityMatch[1].trim()}]`;
      stats.unitsReceived.push(unitInfo);
    }
  }

  if (text.includes('Tower Completed!')) {
    stats.towerSelesai += 1;
  }

  const gemsMatch = text.match(/Gems:\s*x?(\d+)/i);
  if (gemsMatch) {
    stats.totalGems += parseInt(gemsMatch[1]);
  }

  const traitMatch = text.match(/Trait Reroll:\s*x?(\d+)/i);
  if (traitMatch) {
    stats.totalTraitReroll += parseInt(traitMatch[1]);
  }

  const itemMatches = text.matchAll(/([A-Za-z0-9'\s]+):\s*x(\d+)/g);
  for (const match of itemMatches) {
    const itemName = match[1].trim();
    const qty = parseInt(match[2]);

    if (!['Gems', 'Trait Reroll', 'Level', 'Floor Reached'].includes(itemName)) {
      stats.potions[itemName] = (stats.potions[itemName] || 0) + qty;
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

async function sendTelegramMessage(chatId, text, parseMode = 'Markdown') {
  const url = `${CONFIG.TELEGRAM_BASE_URL}${CONFIG.BOT_TOKEN}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: chatId,
      text: text,
      parse_mode: parseMode,
      disable_web_page_preview: true
    });
  } catch (error) {
    if (parseMode === 'Markdown') {
      await axios.post(url, {
        chat_id: chatId,
        text: text,
        disable_web_page_preview: true
      });
    } else {
      throw error;
    }
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

    // 1. Handling Command Telegram /stats
    if (payload?.message) {
      const chatId = payload.message.chat.id;
      const userText = (payload.message.text || '').toLowerCase();

      if (userText === '/start') {
        await sendTelegramMessage(chatId, `Bot Online\n\nID Telegram Anda: \`${chatId}\``);
        return res.status(200).json({ success: true });
      }

      if (userText === '/stats') {
        let itemList = 'Belum ada';
        if (Object.keys(stats.potions).length > 0) {
          itemList = Object.entries(stats.potions)
            .map(([name, qty]) => `  • ${name}: x${qty}`)
            .join('\n');
        }

        let unitList = 'Belum ada';
        if (stats.unitsReceived.length > 0) {
          unitList = stats.unitsReceived
            .map(u => `  • ${u}`)
            .join('\n');
        }

        const reportText = `*Hasil Akumulasi Scanning Bot*\n` +
          `Waktu Cetak: ${getCurrentTimeWIB()}\n────────────────\n` +
          `• Total Laporan Diproses: *${stats.totalLaporan}*\n` +
          `• Unit Masuk Tas: *${stats.unitMasukTas}*\n` +
          `• Tower Selesai: *${stats.towerSelesai}*\n\n` +
          `*Daftar Unit Diterima:*\n${unitList}\n\n` +
          `*Total Drops:*\n` +
          `  • Total Gems: *x${stats.totalGems}*\n` +
          `  • Total Trait Reroll: *x${stats.totalTraitReroll}*\n\n` +
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

    stats.totalLaporan += 1;

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

    // Jalankan Pemindaian Teks
    scanIncomingText(fullTextToScan);

    // Format dan Kirim Pesan Langsung ke Telegram
    let formattedMessage = '';
    if (eventType === 'error') {
      formattedMessage = `*[ERROR LOG]*\nUsername: *${senderName}*\nWaktu: ${timeWIB}\n────────────────\n${payload?.error_message || 'Error pada script.'}`;
    } else if (eventType === 'disconnect') {
      formattedMessage = `*[DISCONNECT ALERT]*\nUsername: *${senderName}*\nWaktu: ${timeWIB}\n────────────────\nScript terputus dari server!`;
    } else {
      formattedMessage = `Username: *${senderName}*\nWaktu: ${timeWIB}\n────────────────\n${messageBody}`;
    }

    await sendTelegramMessage(CONFIG.CHAT_ID, formattedMessage);

    return res.status(200).json({ success: true, status: 'scanned_and_delivered' });

  } catch (error) {
    console.error('[Webhook Error]:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
};
