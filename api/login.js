const CONFIG = {
  DASHBOARD_USER: process.env.DASHBOARD_USER,
  DASHBOARD_PASS: process.env.DASHBOARD_PASS,
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
  req.headers.cookie?.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    list[parts.shift().trim()] = decodeURI(parts.join('='));
  });
  return list;
}

function parseDevice(userAgent) {
  if (!userAgent) return 'Perangkat Tidak Diketahui';
  if (/android/i.test(userAgent)) {
    const match = userAgent.match(/Android\s+[\d\.]+;\s*([^;\)]+)/i);
    return match ? `Android (${match[1].trim()})` : 'Perangkat Android';
  } else if (/iphone/i.test(userAgent)) return 'Apple iPhone';
  else if (/ipad/i.test(userAgent)) return 'Apple iPad';
  else if (/windows/i.test(userAgent)) return 'Windows PC';
  else if (/macintosh|mac os x/i.test(userAgent)) return 'Apple Mac';
  return 'Desktop / PC';
}

module.exports = async (req, res) => {
  const cookies = parseCookies(req);

  // Jika sudah login, langsung alihkan (redirect) ke Dashboard
  if (cookies.auth === 'true' && req.method === 'GET') {
    res.writeHead(302, { Location: '/api/dashboard' });
    return res.end();
  }

  // Handle Request Login (POST)
  if (req.method === 'POST') {
    const { username, password } = req.body || {};
    const userAgent = req.headers['user-agent'] || '';
    const deviceName = parseDevice(userAgent);

    // Cek Akun Root Admin dari Vercel Env
    if (username === CONFIG.DASHBOARD_USER && password === CONFIG.DASHBOARD_PASS) {
      res.setHeader('Set-Cookie', [
        `auth=true; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
        `auth_user=${encodeURIComponent(username)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
        `auth_role=admin; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
      ]);
      return res.status(200).json({ success: true, redirect: '/api/dashboard' });
    }

    // Cek Akun Terdaftar di Redis
    const rawUser = await redisCmd('get', `user:${username}`);
    if (rawUser) {
      const uObj = JSON.parse(rawUser);
      if (uObj.password === password) {
        if (uObj.status === 'pending') {
          return res.status(403).json({ success: false, message: 'Akun Anda masih menunggu persetujuan Admin!' });
        }
        if (uObj.status === 'banned') {
          return res.status(403).json({ success: false, message: 'Akun Anda telah dibanned oleh Admin!' });
        }

        uObj.deviceInfo = deviceName;
        uObj.lastLogin = Date.now();
        await redisCmd('set', `user:${username}`, JSON.stringify(uObj));

        res.setHeader('Set-Cookie', [
          `auth=true; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
          `auth_user=${encodeURIComponent(username)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
          `auth_role=${uObj.role}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
        ]);
        return res.status(200).json({ success: true, redirect: '/api/dashboard' });
      }
    }

    return res.status(401).json({ success: false, message: 'Username atau Password salah!' });
  }

  // Tampilkan Halaman Login (GET)
  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(`
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login / Daftar - Analytics Gateway</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; font-family:'Plus Jakarta Sans',sans-serif; }
    body { background:#07090e; color:#fff; display:flex; align-items:center; justify-content:center; min-height:100vh; padding:1.5rem; }
    .card { background:rgba(18,26,43,0.85); border:1px solid rgba(255,255,255,0.1); padding:2.5rem; border-radius:20px; width:100%; max-width:400px; backdrop-filter:blur(12px); box-shadow:0 20px 40px rgba(0,0,0,0.5); }
    .logo { width:50px; height:50px; background:linear-gradient(135deg, #38bdf8, #c084fc); border-radius:14px; display:flex; align-items:center; justify-content:center; font-size:1.6rem; margin:0 auto 1.5rem auto; }
    h2 { text-align:center; font-size:1.4rem; font-weight:800; margin-bottom:0.5rem; }
    p { text-align:center; color:#94a3b8; font-size:0.85rem; margin-bottom:1.5rem; }
    .form-group { margin-bottom:1.2rem; }
    label { display:block; font-size:0.8rem; font-weight:600; color:#94a3b8; margin-bottom:0.4rem; }
    input { width:100%; background:rgba(8,12,20,0.8); border:1px solid rgba(255,255,255,0.1); padding:0.75rem 1rem; color:#fff; border-radius:10px; outline:none; }
    .btn { width:100%; background:linear-gradient(135deg, #38bdf8, #0284c7); border:none; color:#fff; padding:0.85rem; border-radius:10px; font-weight:700; cursor:pointer; }
    .toggle-link { text-align:center; font-size:0.85rem; color:#38bdf8; margin-top:1.2rem; cursor:pointer; text-decoration:underline; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🔐</div>
    <h2 id="titleText">System Login</h2>
    <p id="subText">Akses aman menuju Dashboard Analytics</p>

    <!-- FORM LOGIN -->
    <form id="loginForm">
      <div class="form-group"><label>Username</label><input type="text" id="loginUser" required autocomplete="off"></div>
      <div class="form-group"><label>Password</label><input type="password" id="loginPass" required></div>
      <button type="submit" class="btn">Masuk Ke Dashboard</button>
    </form>

    <!-- FORM REGISTER -->
    <form id="registerForm" style="display:none;">
      <div class="form-group"><label>Username Baru</label><input type="text" id="regUser" required autocomplete="off"></div>
      <div class="form-group"><label>Password Baru</label><input type="password" id="regPass" required></div>
      <button type="submit" class="btn" style="background:linear-gradient(135deg, #34d399, #059669);">Kirim Permintaan Akun</button>
    </form>

    <div class="toggle-link" id="toggleBtn" onclick="toggleForm()">Belum punya akun? Buat Akun</div>
  </div>

  <script>
    let isRegister = false;
    function toggleForm() {
      isRegister = !isRegister;
      document.getElementById('loginForm').style.display = isRegister ? 'none' : 'block';
      document.getElementById('registerForm').style.display = isRegister ? 'block' : 'none';
      document.getElementById('titleText').innerText = isRegister ? 'Buat Akun Baru' : 'System Login';
      document.getElementById('subText').innerText = isRegister ? 'Data pendaftaran akan dikirimkan ke Admin' : 'Akses aman menuju Dashboard Analytics';
      document.getElementById('toggleBtn').innerText = isRegister ? 'Sudah punya akun? Login' : 'Belum punya akun? Buat Akun';
    }

    document.getElementById('loginForm').onsubmit = async (e) => {
      e.preventDefault();
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ username: loginUser.value, password: loginPass.value })
      });
      const data = await res.json();
      if (res.ok && data.success) window.location.href = data.redirect;
      else alert(data.message || 'Login gagal!');
    };

    document.getElementById('registerForm').onsubmit = async (e) => {
      e.preventDefault();
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ action: 'register', username: regUser.value, password: regPass.value })
      });
      const data = await res.json();
      alert(data.message);
      if (res.ok) toggleForm();
    };
  </script>
</body>
</html>
  `);
};
