const CONFIG = {
  DASHBOARD_USER: process.env.DASHBOARD_USER,
  REDIS_URL: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  REDIS_TOKEN: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
};

async function redisCmd(command, ...args) {
  if (!CONFIG.REDIS_URL || !CONFIG.REDIS_TOKEN) return null;
  try {
    const formattedArgs = args.map(arg => encodeURIComponent(String(arg))).join('/');
    const res = await fetch(`${CONFIG.REDIS_URL}/${command}/${formattedArgs}`, {
      headers: { Authorization: `Bearer ${CONFIG.REDIS_TOKEN}` }
    });
    return (await res.json()).result;
  } catch (e) {
    return null;
  }
}

function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      list[parts.shift().trim()] = decodeURI(parts.join('='));
    });
  }
  return list;
}

module.exports = async (req, res) => {
  const cookies = parseCookies(req);
  const currentUser = cookies.auth_user;

  if (req.method === 'POST' && req.body?.action === 'register') {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username dan password wajib diisi!' });
    }

    const cleanUser = username.trim();
    if (cleanUser === CONFIG.DASHBOARD_USER) {
      return res.status(400).json({ success: false, message: 'Username ini dilindungi sistem!' });
    }

    const existing = await redisCmd('get', `user:${cleanUser}`);
    if (existing) {
      return res.status(400).json({ success: false, message: 'Username sudah terdaftar atau menunggu persetujuan!' });
    }

    const userData = {
      username: cleanUser,
      password: password,
      role: 'user',
      status: 'pending',
      registeredAt: Date.now(),
      deviceInfo: 'Belum login'
    };

    await redisCmd('set', `user:${cleanUser}`, JSON.stringify(userData));
    await redisCmd('sadd', 'users:pending', cleanUser);
    await redisCmd('sadd', 'users:all', cleanUser);

    return res.status(200).json({ success: true, message: 'Permintaan akun berhasil dikirim! Menunggu persetujuan Admin.' });
  }

  if (currentUser !== CONFIG.DASHBOARD_USER) {
    const rawData = await redisCmd('get', `user:${currentUser}`);
    const uObj = rawData ? JSON.parse(rawData) : null;
    if (!uObj || uObj.role !== 'admin' || uObj.status !== 'approved') {
      return res.status(403).json({ success: false, message: 'Akses khusus Admin!' });
    }
  }

  if (req.method === 'POST' && req.body?.action === 'approveUser') {
    const { targetUser, approve } = req.body;
    const rawData = await redisCmd('get', `user:${targetUser}`);
    if (!rawData) return res.status(404).json({ success: false, message: 'Pengguna tidak ditemukan.' });

    const uObj = JSON.parse(rawData);
    await redisCmd('srem', 'users:pending', targetUser);

    if (approve) {
      uObj.status = 'approved';
      await redisCmd('set', `user:${targetUser}`, JSON.stringify(uObj));
      await redisCmd('sadd', 'users:approved', targetUser);
      return res.status(200).json({ success: true, message: `Akun ${targetUser} berhasil disetujui!` });
    } else {
      await redisCmd('del', `user:${targetUser}`);
      await redisCmd('srem', 'users:all', targetUser);
      return res.status(200).json({ success: true, message: `Permintaan akun ${targetUser} ditolak.` });
    }
  }

  if (req.method === 'POST' && req.body?.action === 'changeRole') {
    const { targetUser, newRole } = req.body;
    if (targetUser === CONFIG.DASHBOARD_USER) {
      return res.status(400).json({ success: false, message: 'Role Admin Utama Vercel tidak dapat diubah!' });
    }

    const rawData = await redisCmd('get', `user:${targetUser}`);
    if (!rawData) return res.status(404).json({ success: false, message: 'Pengguna tidak ditemukan.' });

    const uObj = JSON.parse(rawData);
    uObj.role = newRole;
    await redisCmd('set', `user:${targetUser}`, JSON.stringify(uObj));
    return res.status(200).json({ success: true, message: `Role ${targetUser} diubah menjadi ${newRole}.` });
  }

  if (req.method === 'POST' && req.body?.action === 'toggleBan') {
    const { targetUser } = req.body;
    if (targetUser === CONFIG.DASHBOARD_USER) {
      return res.status(400).json({ success: false, message: 'Admin Utama Vercel tidak dapat dibanned!' });
    }

    const rawData = await redisCmd('get', `user:${targetUser}`);
    if (!rawData) return res.status(404).json({ success: false, message: 'Pengguna tidak ditemukan.' });

    const uObj = JSON.parse(rawData);
    uObj.status = uObj.status === 'banned' ? 'approved' : 'banned';
    await redisCmd('set', `user:${targetUser}`, JSON.stringify(uObj));

    const statusMsg = uObj.status === 'banned' ? 'dibanned' : 'diaktifkan kembali';
    return res.status(200).json({ success: true, message: `Akun ${targetUser} berhasil ${statusMsg}.` });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
