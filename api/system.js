const CONFIG = {
  DASHBOARD_USER: process.env.DASHBOARD_USER,
  DASHBOARD_PASS: process.env.DASHBOARD_PASS,
  REDIS_URL: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  REDIS_TOKEN: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
};

// Status In-Memory Cache (Default ON / true)
// Disimpan di memori serverless Vercel agar 0% panggil Redis saat webhook mengecek status OFF
let isSystemEnabled = true;

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
    return null;
  }
}

module.exports = async (req, res) => {
  // GET: Cek Status System Analytics
  if (req.method === 'GET') {
    return res.status(200).json({ enabled: isSystemEnabled });
  }

  // POST: Menangani Login & Toggle Switch System Analytics
  if (req.method === 'POST') {
    const { action, username, password, enabled } = req.body || {};

    // 1. Fitur Login Autentikasi
    if (action === 'login') {
      if (!CONFIG.DASHBOARD_USER || !CONFIG.DASHBOARD_PASS) {
        return res.status(500).json({ 
          success: false, 
          message: 'Kredensial belum dikonfigurasi di Vercel Environment Variables!' 
        });
      }

      if (username === CONFIG.DASHBOARD_USER && password === CONFIG.DASHBOARD_PASS) {
        res.setHeader('Set-Cookie', `auth=true; Path=/; HttpOnly; Max-Age=86400`);
        return res.status(200).json({ success: true, message: 'Login berhasil' });
      } else {
        return res.status(401).json({ success: false, message: 'Username atau Password salah!' });
      }
    }

    // 2. Fitur Toggle Switch ON/OFF System Analytics
    if (typeof enabled === 'boolean') {
      isSystemEnabled = enabled;
      
      // Simpan juga ke Redis opsional agar persisten saat serverless restart
      if (enabled) {
        await redisCmd('del', 'system:analytics_status');
      } else {
        await redisCmd('set', 'system:analytics_status', 'disabled');
      }

      return res.status(200).json({ 
        success: true, 
        enabled: isSystemEnabled, 
        message: isSystemEnabled ? 'System Analytics DIAKTIFKAN' : 'System Analytics DIMATIKAN TOTAL' 
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

// Export fungsi pembaca status langsung untuk digunakan oleh api/webhook.js tanpa memanggil DB
module.exports.getStatus = () => isSystemEnabled;
