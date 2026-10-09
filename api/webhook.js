const axios = require('axios');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send('Server Webhook Vercel Aktif!');
  }

  try {
    const BOT_TOKEN = process.env.BOT_TOKEN;
    const TELEGRAM_API = `https://api.telegram.org/bot${8867286519:AAFCsH9InhDdTAolaDDn-dU4-zvAOPdLGSQ}`;
    const { message } = req.body;

    if (message && message.text) {
      const chatId = message.chat.id;
      const text = message.text;

      let reply = `Halo dari Vercel! Anda mengirim: "${text}"`;
      if (text.toLowerCase() === '/start') {
        reply = 'Selamat datang! Bot aktif di Vercel.';
      }

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: reply
      });
    }

    return res.status(200).json({ status: 'success' });
  } catch (error) {
    console.error('Error Webhook:', error.message);
    return res.status(200).json({ status: 'error', message: error.message });
  }
};
