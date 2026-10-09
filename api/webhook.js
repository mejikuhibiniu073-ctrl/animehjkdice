const axios = require('axios');

const CONFIG = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  CHAT_ID: '1315912406',
  TELEGRAM_BASE_URL: 'https://api.telegram.org/bot'
};

// Penampung statistik hasil scanning laporan Roblox
const stats = {
  totalLaporan: 0,
  unitMasukTas: 0,
  towerSelesai: 0,
  rareHighestCount: 0,
  highestRareName: 'Belum Ada',
  totalGems: 0,
  totalTraitReroll: 0,
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

// Proses scanning & ekstraksi data mentah dari Roblox
function scanAndProcessData(embed) {
  const fullText = JSON.stringify(embed);

  // Scan Unit Masuk Tas
  if (embed.title && (embed.title.includes('New Unit') || embed.title.includes('Unit Received'))) {
    stats.unitMasukTas += 1;
  }

  // Scan Tower Selesai
  if (embed.title && embed.title.includes('Tower Completed')) {
    stats.towerSelesai += 1;
  }

  // Scan Rare Tinggi (Secret / Mythic / Monarch)
  if (fullText.includes('Secret') || fullText.includes('Monarch') || fullText.includes('Mythic')) {
    stats.rareHighestCount += 1;
    if (fullText.includes('Secret')) stats.highestRareName = 'Secret';
    else if (fullText.includes('Monarch')) stats.highestRareName = 'Monarch';
    else stats.highestRareName = 'Mythic';
  }

  // Scan Drops (Gems, Trait Reroll, Potions)
  if (Array.isArray(embed.fields)) {
    embed.fields.forEach(field => {
      const val = field.value || '';
      
      const gemsMatch = val.match(/Gems:\s*x?(\d+)/i);
      if (gemsMatch) stats.totalGems += parseInt(gemsMatch[1]);

      const traitMatch = val.match(/Trait Reroll:\s*x?(\d+)/i);
      if (traitMatch) stats.totalTraitReroll += parseInt(traitMatch[1]);

      const potionMatches = val.matchAll(/([A-Za-z\s]+(?:Speed|Income|Luck|Potion)[A-Za-z\s]*):\s*x?(\d+)/gi);
      for (const match of potionMatches) {
        const item = match[1].trim();
        const qty = parseInt(match[2]);
        stats.potions[item] = (stats.potions[item] || 0) + qty;
      }
    });
  }
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

    // 1. RESPON PERINTAH DARI TELEGRAM
    if (payload?.message) {
      const chatId = payload.message.chat.id;
      const userText = (payload.message.text || '').toLowerCase();

      if (userText === '/start') {
        await sendTelegramMessage(chatId, `Bot Online\n\nID Telegram Anda: \`${chatId}\``);
        return res.status(200).json({ success: true });
      }

      // Saat pengguna meminta laporan /stats
      if (userText === '/stats') {
        let potionList = 'Belum ada';
        if (Object.keys(stats.potions).length > 0) {
          potionList = Object.entries(stats.potions)
            .map(([name, qty]) => `  • ${name}: x${qty}`)
            .join('\n');
        }

        const reportText = `*Hasil Scanning Laporan Bot*\n` +
          `Waktu Cetak: ${getCurrentTimeWIB()}\n────────────────\n` +
          `• Total Laporan Diproses: *${stats.totalLaporan}*\n` +
          `• Unit Masuk Tas: *${stats.unitMasukTas}*\n` +
          `• Tower Selesai: *${stats.towerSelesai}*\n` +
          `• Total Unit Rare Tinggi (${stats.highestRareName}): *${stats.rareHighestCount}*\n` +
          `• Total Gems Terkumpul: *${stats.totalGems}*\n` +
          `• Total Trait Reroll: *${stats.totalTraitReroll}*\n` +
          `• Potion/Buff Diterima:\n${potionList}`;

        await sendTelegramMessage(chatId, reportText);
        return res.status(200).json({ success: true });
      }

      await sendTelegramMessage(chatId, `Pesan diterima: "${payload.message.text}"`);
      return res.status(200).json({ success: true });
    }

    // 2. PROSES SCANNING LAPORAN DARI ROBLOX (TANPA LANGSUNG DIKIRIM KE TELEGRAM)
    const eventType = payload?.event_type || 'normal';

    // Jika pesan bertipe error atau disconnect, bot tetap langsung memberi notifikasi darurat
    if (eventType === 'error' || eventType === 'disconnect') {
      const senderName = payload?.username || 'Roblox Script';
      const timeWIB = getCurrentTimeWIB();
      const alertMsg = eventType === 'error'
        ? `*[ERROR LOG]*\nUsername: *${senderName}*\nWaktu: ${timeWIB}\n────────────────\n${payload?.error_message || 'Error pada script.'}`
        : `*[DISCONNECT ALERT]*\nUsername: *${senderName}*\nWaktu: ${timeWIB}\n────────────────\nScript terputus dari server!`;

      await sendTelegramMessage(CONFIG.CHAT_ID, alertMsg);
      return res.status(200).json({ success: true, processed: 'emergency_alert_sent' });
    }

    // Laporan normal: Diproses & dipindai saja
    stats.totalLaporan += 1;

    if (Array.isArray(payload?.embeds) && payload.embeds.length > 0) {
      scanAndProcessData(payload.embeds[0]);
    }

    // Memberikan respon sukses ke Roblox tanpa mengirim pesan spaming ke chat Telegram
    return res.status(200).json({ success: true, processed: 'data_scanned_quietly' });

  } catch (error) {
    console.error('[Webhook Error]:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
};
