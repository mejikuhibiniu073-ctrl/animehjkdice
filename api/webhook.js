const axios = require('axios');

module.exports = async (req, res) => {
  try {
    const BOT_TOKEN = process.env.BOT_TOKEN;
    const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

    // ID Telegram Anda
    const MY_CHAT_ID = '1315912406'; 

    let body = req.body;

    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        body = {};
      }
    }

    // 1. JIKA PESAN DARI CHAT TELEGRAM (Misal ketik /start)
    if (body && body.message) {
      const chatId = body.message.chat.id;
      const text = body.message.text || '';

      let reply = `ID Chat Anda adalah: ${chatId}`;
      if (text.toLowerCase() === '/start') {
        reply = `Selamat datang! Bot aktif dan terhubung ke ID: ${chatId}`;
      }

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: reply
      });

      return res.status(200).json({ status: 'ok' });
    }

    // 2. JIKA PESAN MASUK DARI SCRIPT ROBLOX (DISCORD EMBEDS)
    if (req.method === 'POST') {
      let textToSend = '';

      // Cek apakah data berisi Discord Embeds dari Roblox[span_1](start_span)[span_1](end_span)
      if (body.embeds && body.embeds.length > 0) {
        const embed = body.embeds[0];
        
        if (embed.title) textToSend += `*${embed.title}*\n\n`;
        if (embed.description) textToSend += `${embed.description}\n\n`;

        // Susun data fields (Name, Rarity, Level, Drops, dll)[span_2](start_span)[span_2](end_span)
        if (embed.fields && embed.fields.length > 0) {
          embed.fields.forEach(f => {
            textToSend += `*${f.name}:*\n${f.value}\n\n`;
          });
        }
      } else {
        // Teks biasa jika bukan embed
        textToSend = body.content || body.message || JSON.stringify(body, null, 2);
      }

      const username = body.username || 'Roblox Script';

      // Kirim pesan langsung ke ID Telegram Anda
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: MY_CHAT_ID,
        text: `🤖 *${username}*\n\n${textToSend}`,
        parse_mode: 'Markdown'
      });

      return res.status(200).json({ status: 'success' });
    }

    return res.status(200).send('Server Webhook Vercel Aktif!');
  } catch (error) {
    console.error('Error Webhook:', error.message);
    return res.status(200).json({ status: 'error', message: error.message });
  }
};
