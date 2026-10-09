const axios = require('axios');

module.exports = async (req, res) => {
  try {
    const BOT_TOKEN = process.env.BOT_TOKEN;
    const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
    const MY_CHAT_ID = '1315912406'; 

    let body = req.body;

    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        body = {};
      }
    }

    // Pesan dari chat Telegram
    if (body && body.message) {
      const chatId = body.message.chat.id;
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: `ID Chat Anda: ${chatId}`
      });
      return res.status(200).json({ status: 'ok' });
    }

    // Pesan dari Roblox / Webhook
    if (req.method === 'POST') {
      let textToSend = '';

      if (body.embeds && body.embeds.length > 0) {
        const embed = body.embeds[0];
        
        if (embed.title) textToSend += `${embed.title}\n\n`;
        if (embed.description) textToSend += `${embed.description}\n\n`;

        if (embed.fields && embed.fields.length > 0) {
          embed.fields.forEach(f => {
            textToSend += `${f.name}:\n${f.value}\n\n`;
          });
        }
      } else {
        textToSend = body.content || body.message || JSON.stringify(body, null, 2);
      }

      const username = body.username || 'Roblox Script';

      // Kirim tanpa parse_mode agar tidak error jika ada karakter unik
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: MY_CHAT_ID,
        text: `🤖 ${username}\n\n${textToSend}`
      });

      return res.status(200).json({ status: 'success' });
    }

    return res.status(200).send('Server Webhook Vercel Aktif!');
  } catch (error) {
    console.error('Error Webhook:', error.message);
    return res.status(200).json({ status: 'error', message: error.message });
  }
};
