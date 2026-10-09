const axios = require('axios');

const CONFIG = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  CHAT_ID: '1315912406',
  TELEGRAM_BASE_URL: 'https://api.telegram.org/bot'
};

// Penampung Statistik Lengkap
const stats = {
  totalLaporan: 0,
  unitMasukTas: 0,
  towerSelesai: 0,
  rareHighestCount: 0,
  highestRareName: 'Belum Ada',
  totalGems: 0,
  totalTraitReroll: 0,
  potions: {} // Mengakumulasi jenis potion
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

// Fungsi Parsing & Ekstraksi Data Statistik dari Payload Embed
function processPayloadStats(embed) {
  const fullText = JSON.stringify(embed);

  // 1. Cek Unit Masuk Tas / New Unit
  if (embed.title && (embed.title.includes('New Unit') || embed.title.includes('Unit Received'))) {
    stats.unitMasukTas += 1;
  }

  // 2. Cek Tower Selesai
  if (embed.title && embed.title.includes('Tower Completed')) {
    stats.towerSelesai += 1;
  }

  // 3. Cek Rare Tinggi (Secret / Mythic / Monarch)
  if (fullText.includes('Secret') || fullText.includes('Monarch') || fullText.includes('Mythic')) {
    stats.rareHighestCount += 1;
    if (fullText.includes('Secret')) stats.highestRareName = 'Secret';
    else if (fullText.includes('Monarch')) stats.highestRareName = 'Monarch';
    else stats.highestRareName = 'Mythic';
  }

  // 4. Ekstraksi Drops (Gems, Trait Reroll, Potions) dari Fields
  if (Array.isArray(embed.fields)) {
    embed.fields.forEach(field => {
      const val = field.value || '';
      
      // Ambil Jumlah Gems
      const gemsMatch = val.match(/Gems:\s*x?(\d+)/i);
      if (gemsMatch) stats.totalGems += parseInt(gemsMatch[1]);

      // Ambil Jumlah Trait Reroll
      const traitMatch = val.match(/Trait Reroll:\s*x?(\d+)/i);
      if (traitMatch) stats.totalTraitReroll += parseInt(traitMatch[1]);

      // Ambil Potion / Speed / Income / Luck
      const potionMatches = val.matchAll(/([A-Za-z\s]+(?:Speed|Income|Luck|Potion)[A-Za-z\s]*):\s*x?(\d+)/gi);
      for (const match of potionMatches) {
        const item = match[1].trim();
        const qty = parseInt(match[2]);
        stats.potions[item] = (stats.potions[item] || 0) + qty;
      }
    });
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
        let potionList = 'Belum ada';
        if (Object.keys(stats.potions).length > 0) {
          potionList = Object.entries(stats.potions)
            .map(([name, qty]) => `  • ${name}: x${qty}`)
            .join('\n');
        }

        const reportText = `*Laporan Statistik Bot*\n────────────────\n` +
          `• Total Laporan: *${stats.totalLaporan}*\n` +
          `• Unit Masuk Tas: *${stats.unitMasukTas}*\n` +
          `• Tower Selesai: *${stats.towerSelesai}*\n` +
          `• Total Unit Rarity Tinggi (${stats.highestRareName}): *${stats.rareHighestCount}*\n` +
          `• Total Gems: *${stats.totalGems}*\n` +
          `• Total Trait Reroll: *${stats.totalTraitReroll}*\n` +
          `• Potion/Buff Diterima:\n${potionList}`;

        await sendTelegramMessage(chatId, reportText);
        return res.status(200).json({ success: true });
      }

      await sendTelegramMessage(chatId, `Pesan diterima: "${payload.message.text}"`);
      return res.status(200).json({ success: true });
    }

    // 2. Handling Event Webhook dari Roblox
    const senderName = payload?.username || 'Roblox Script';
    const timeWIB = getCurrentTimeWIB();
    const eventType = payload?.event_type || 'normal';

    stats.totalLaporan += 1;

    let formattedMessage = '';

    if (eventType === 'error') {
      const errorMsg = payload?.error_message || 'Terjadi kesalahan pada script.';
      formattedMessage = `*[ERROR LOG]*\nUsername: *${senderName}*\nWaktu: ${timeWIB}\n────────────────\n${errorMsg}`;
    } else if (eventType === 'disconnect') {
      formattedMessage = `*[DISCONNECT ALERT]*\nUsername: *${senderName}*\nWaktu: ${timeWIB}\n────────────────\nScript terputus dari server atau terkena AFK Kick!`;
    } else {
      let messageBody = '';
      if (Array.isArray(payload?.embeds) && payload.embeds.length > 0) {
        processPayloadStats(payload.embeds[0]);
        messageBody = parseDiscordEmbed(payload.embeds[0]);
      } else {
        messageBody = payload?.content || payload?.message || JSON.stringify(payload, null, 2);
      }

      formattedMessage = `Username: *${senderName}*\nWaktu: ${timeWIB}\n────────────────\n${messageBody}`;
    }

    await sendTelegramMessage(CONFIG.CHAT_ID, formattedMessage);

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('[Webhook Error]:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
};
