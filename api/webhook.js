const axios = require('axios');

module.exports = async (req, res) => {
  try {
    const BOT_TOKEN = process.env.BOT_TOKEN;
    const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

    // MASUKKAN CHAT ID TELEGRAM ANDA DI SINI
    // (Bisa didapat dengan mengirim pesan ke bot @userinfobot di Telegram)
    const MY_CHAT_ID = '1315912406'; 

    const body = req.body;

    // 1. JIKA PESAN DATANG DARI CHAT TELEGRAM
    if (body && body.message) {
      const chatId = body.message.chat.id;
      const text = body.message.text;

      let reply = `Halo! Anda mengirim: "${text}"\n\nID Chat Anda adalah: ${chatId}`;
      if (text.toLowerCase() === '/start') {
        reply = `Selamat datang! Bot aktif.\n\nSimpan ID Chat ini untuk aplikasi luar: ${chatId}`;
      }

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: reply
      });

      return res.status(200).json({ status: 'success' });
    }

    // 2. JIKA DATA DATANG DARI APLIKASI LUAR (WEBHOOK LAIN)
    if (req.method === 'POST') {
      const dataString = JSON.stringify(body, null, 2);

      // Kirim notifikasi isi data dari aplikasi luar langsung ke chat Telegram Anda
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: MY_CHAT_ID,
        text: `📥 *Notifikasi Webhook Masuk:*\n\`\`\`json\n${dataString}\n\`\`\``,
        parse_mode: 'Markdown'
      });

      return res.status(200).json({ status: 'webhook received' });
    }

    return res.status(200).send('Server Webhook Vercel Aktif!');
  } catch (error) {
    console.error('Error Webhook:', error.message);
    return res.status(200).json({ status: 'error', message: error.message });
  }
};
