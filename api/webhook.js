const axios = require('axios');

const CONFIG = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  CHAT_ID: '1315912406',
  TELEGRAM_BASE_URL: 'https://api.telegram.org/bot'
};

const stats = {
  totalRuns: 0,
  towersCompleted: 0,
  lastActive: null
};

// Fungsi untuk mendapatkan format tanggal dan jam WIB
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

    // 1. Handling Event / Chat dari Telegram
    if (payload?.message) {
      const chatId = payload.message.chat.id;
      const userText = (payload.message.text || '').toLowerCase();

      let responseText = `Pesan diterima: "${payload.message.text}"`;

      if (userText === '/start') {
        responseText = `Bot Online\n\nID Telegram Anda: \`${chatId}\``;
      } else if (userText === '/stats') {
        responseText = `*Statistik Sesi Bot*\n────────────────\n` +
          `Total Laporan: *${stats.totalRuns}*\n` +
          `Tower Selesai: *${stats.towersCompleted}*\n` +
          `Terakhir Aktif: *${stats.lastActive || 'Belum Ada Data'}*`;
      }

      await sendTelegramMessage(chatId, responseText);
      return res.status(200).json({ success: true, source: 'telegram' });
    }

    // 2. Handling Event Webhook dari Roblox
    const senderName = payload?.username || 'Roblox Script';
    const timeWIB = getCurrentTimeWIB();
    const eventType = payload?.event_type || 'normal';

    stats.totalRuns += 1;
    stats.lastActive = timeWIB;

    let formattedMessage = '';

    if (eventType === 'error') {
      const errorMsg = payload?.error_message || 'Terjadi kesalahan tidak diketahui pada script.';
      formattedMessage = `*[ERROR LOG]*\nUsername: *${senderName}*\nWaktu: ${timeWIB}\n────────────────\n${errorMsg}`;
    } else if (eventType === 'disconnect') {
      formattedMessage = `*[DISCONNECT ALERT]*\nUsername: *${senderName}*\nWaktu: ${timeWIB}\n────────────────\nScript terputus dari server atau terkena AFK Kick!`;
    } else {
      let messageBody = '';
      if (Array.isArray(payload?.embeds) && payload.embeds.length > 0) {
        messageBody = parseDiscordEmbed(payload.embeds[0]);
        if (payload.embeds[0].title && payload.embeds[0].title.includes('Tower Completed')) {
          stats.towersCompleted += 1;
        }
      } else {
        messageBody = payload?.content || payload?.message || JSON.stringify(payload, null, 2);
      }
      
      formattedMessage = `Username: *${senderName}*\nWaktu: ${timeWIB}\n────────────────\n${messageBody}`;
    }

    await sendTelegramMessage(CONFIG.CHAT_ID, formattedMessage);

    return res.status(200).json({ success: true, source: 'external_webhook' });

  } catch (error) {
    console.error('[Webhook Error]:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
};
