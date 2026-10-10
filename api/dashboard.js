const CONFIG = {
  DASHBOARD_USER: process.env.DASHBOARD_USER,
  DASHBOARD_PASS: process.env.DASHBOARD_PASS,
  REDIS_URL: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  REDIS_TOKEN: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
};

async function redisCmd(command, ...args) {
  if (!CONFIG.REDIS_URL || !CONFIG.REDIS_TOKEN) return { result: null, latencyMs: 0 };
  const start = Date.now();
  try {
    const formattedArgs = args.map(arg => encodeURIComponent(String(arg))).join('/');
    const res = await fetch(`${CONFIG.REDIS_URL}/${command}/${formattedArgs}`, {
      headers: { Authorization: `Bearer ${CONFIG.REDIS_TOKEN}` }
    });
    const latencyMs = Date.now() - start;
    const data = await res.json();
    return { result: data.result, latencyMs };
  } catch (e) {
    return { result: null, latencyMs: Date.now() - start };
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

  // Logout Action
  if (req.method === 'POST' && req.body && req.body.action === 'logout') {
    res.setHeader('Set-Cookie', 'auth=; Path=/; HttpOnly; Max-Age=0');
    return res.status(200).json({ success: true });
  }

  // Login Action
  if (req.method === 'POST' && req.body && req.body.action === 'login') {
    const { username, password } = req.body;
    if (!CONFIG.DASHBOARD_USER || !CONFIG.DASHBOARD_PASS) {
      return res.status(500).json({ 
        success: false, 
        message: 'Kredensial belum dikonfigurasi di Vercel Environment Variables!' 
      });
    }

    if (username === CONFIG.DASHBOARD_USER && password === CONFIG.DASHBOARD_PASS) {
      res.setHeader('Set-Cookie', `auth=true; Path=/; HttpOnly; Max-Age=86400`);
      return res.status(200).json({ success: true });
    } else {
      return res.status(401).json({ success: false, message: 'Username atau Password salah!' });
    }
  }

  // API TETAPAN DAN PENGURUSAN
  if (req.method === 'POST' && req.body && req.body.action) {
    if (cookies.auth !== 'true') {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { action, key, value, offlineMin } = req.body;

    if (action === 'reset') {
      await redisCmd('flushall');
      return res.status(200).json({ success: true, message: 'Database telah dibersihkan.' });
    }

    if (action === 'deleteKey' && key) {
      await redisCmd('del', key);
      if (key.startsWith('stats:')) {
        const uName = key.replace('stats:', '').split(':')[0];
        await redisCmd('srem', 'stats:users', uName);
      }
      return res.status(200).json({ success: true });
    }

    if (action === 'setOfflineThreshold' && offlineMin) {
      await redisCmd('set', 'system:offline_threshold_min', offlineMin);
      return res.status(200).json({ success: true });
    }
  }

  // HALAMAN LOGIN
  if (cookies.auth !== 'true') {
    const loginHtml = `
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - Dashboard Analytics</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Plus Jakarta Sans', sans-serif; }
    body { background: #07090e; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 1.5rem; }
    .login-card { background: rgba(18, 26, 43, 0.85); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 20px; padding: 2.5rem; width: 100%; max-width: 400px; backdrop-filter: blur(12px); box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
    .logo { width: 50px; height: 50px; background: linear-gradient(135deg, #38bdf8, #c084fc); border-radius: 14px; display: flex; align-items: center; justify-content: center; font-size: 1.6rem; margin: 0 auto 1.5rem auto; }
    h2 { text-align: center; font-size: 1.4rem; font-weight: 800; margin-bottom: 0.5rem; }
    p { text-align: center; color: #94a3b8; font-size: 0.85rem; margin-bottom: 1.5rem; }
    .form-group { margin-bottom: 1.2rem; }
    label { display: block; font-size: 0.8rem; font-weight: 600; color: #94a3b8; margin-bottom: 0.4rem; }
    input { width: 100%; background: rgba(8, 12, 20, 0.8); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; padding: 0.75rem 1rem; color: #fff; font-size: 0.9rem; outline: none; transition: border-color 0.2s; }
    input:focus { border-color: #38bdf8; }
    .btn-submit { width: 100%; background: linear-gradient(135deg, #38bdf8, #0284c7); border: none; color: #fff; padding: 0.85rem; border-radius: 10px; font-weight: 700; font-size: 0.9rem; cursor: pointer; transition: opacity 0.2s; margin-top: 0.5rem; }
    .btn-submit:hover { opacity: 0.9; }
    .error-msg { color: #f43f5e; font-size: 0.8rem; text-align: center; margin-top: 1rem; display: none; }
  </style>
</head>
<body>
  <div class="login-card">
    <div class="logo">🔐</div>
    <h2>Dashboard Login</h2>
    <p>Masukkan kredensial akun untuk mengakses data</p>
    <form id="loginForm">
      <div class="form-group">
        <label>Username</label>
        <input type="text" id="username" required autocomplete="off">
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" id="password" required>
      </div>
      <button type="submit" class="btn-submit">Masuk Ke Dashboard</button>
      <div id="errorMsg" class="error-msg"></div>
    </form>
  </div>
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const u = document.getElementById('username').value;
      const p = document.getElementById('password').value;
      const err = document.getElementById('errorMsg');
      try {
        const res = await fetch('/api/dashboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'login', username: u, password: p })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          window.location.reload();
        } else {
          err.style.display = 'block';
          err.innerText = data.message || 'Gagal login';
        }
      } catch (e) {
        err.style.display = 'block';
        err.innerText = 'Koneksi bermasalah!';
      }
    });
  </script>
</body>
</html>
    `;
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(loginHtml);
  }

  // AMBIL DATA DASHBOARD & TENTUKAN URL WEBHOOK
  const systemStatus = (await redisCmd('get', 'system:analytics_status')).result;
  const isAnalyticsOn = systemStatus !== 'disabled';

  const offlineMinConfig = (await redisCmd('get', 'system:offline_threshold_min')).result || '20';

  const usersRes = await redisCmd('smembers', 'stats:users');
  let users = usersRes.result;
  const realTimeMs = usersRes.latencyMs;

  if (!Array.isArray(users)) users = users ? [users] : [];

  const accountsData = [];
  let totalGemsGlobal = 0;
  let totalTraitGlobal = 0;
  let totalLaporanGlobal = 0;
  let totalUnitsGlobal = 0;
  let totalBytesEstimated = 0;

  const now = Date.now();

  for (const user of users) {
    const prefix = `stats:${user}`;
    const totalLaporan = parseInt((await redisCmd('get', `${prefix}:totalLaporan`)).result || 0, 10);
    const unitMasukTas = parseInt((await redisCmd('get', `${prefix}:unitMasukTas`)).result || 0, 10);
    const towerSelesai = parseInt((await redisCmd('get', `${prefix}:towerSelesai`)).result || 0, 10);
    const totalGems = parseInt((await redisCmd('get', `${prefix}:totalGems`)).result || 0, 10);
    const totalTrait = parseInt((await redisCmd('get', `${prefix}:totalTraitReroll`)).result || 0, 10);
    const startTime = parseInt((await redisCmd('get', `${prefix}:startTime`)).result || now, 10);
    const lastSeen = parseInt((await redisCmd('get', `${prefix}:lastSeen`)).result || 0, 10);

    let unitsReceived = (await redisCmd('lrange', `${prefix}:unitsReceived`, 0, -1)).result;
    if (!Array.isArray(unitsReceived)) unitsReceived = unitsReceived ? [unitsReceived] : [];

    const potionsRaw = (await redisCmd('hgetall', `${prefix}:potions`)).result || [];
    const potionsObj = {};
    if (Array.isArray(potionsRaw)) {
      for (let i = 0; i < potionsRaw.length; i += 2) {
        potionsObj[potionsRaw[i]] = potionsRaw[i + 1];
      }
    } else if (typeof potionsRaw === 'object' && potionsRaw !== null) {
      Object.assign(potionsObj, potionsRaw);
    }

    const durationHours = Math.max((now - startTime) / (1000 * 60 * 60), 0.01);
    const gemsPerHour = Math.round(totalGems / durationHours);
    const traitPerHour = Math.round(totalTrait / durationHours);

    const isOnline = (now - lastSeen) < (parseInt(offlineMinConfig, 10) * 60 * 1000);

    totalGemsGlobal += totalGems;
    totalTraitGlobal += totalTrait;
    totalLaporanGlobal += totalLaporan;
    totalUnitsGlobal += unitsReceived.length;
    totalBytesEstimated += (totalLaporan * 120) + (unitsReceived.length * 40);

    accountsData.push({
      user,
      isOnline,
      totalLaporan,
      unitMasukTas,
      towerSelesai,
      totalGems,
      totalTrait,
      gemsPerHour,
      traitPerHour,
      unitsReceived,
      potionsObj
    });
  }

  const hostHeader = req.headers.host || 'animehjkdice.vercel.app';
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const webhookUrl = `${protocol}://${hostHeader}/api/webhook`;

  // UTAMA DASHBOARD HTML
  const html = `
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard Analytics & Manual Settings</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #07090e;
      --card-bg: rgba(18, 26, 43, 0.75);
      --card-border: rgba(255, 255, 255, 0.08);
      --accent-cyan: #38bdf8;
      --accent-purple: #c084fc;
      --accent-green: #34d399;
      --accent-red: #f43f5e;
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Plus Jakarta Sans', sans-serif; }
    body { background: var(--bg); color: var(--text); min-height: 100vh; padding: 2rem 1.5rem; }
    .container { max-width: 1400px; margin: 0 auto; }

    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; flex-wrap: wrap; gap: 1rem; }
    .title-group { display: flex; align-items: center; gap: 1rem; }
    .logo { width: 46px; height: 46px; background: linear-gradient(135deg, var(--accent-cyan), var(--accent-purple)); border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; font-weight: 800; box-shadow: 0 0 20px rgba(56, 189, 248, 0.3); }
    .title-group h1 { font-size: 1.6rem; font-weight: 800; }
    .title-group p { font-size: 0.85rem; color: var(--text-muted); }

    .header-right { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
    .btn { background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text); padding: 0.6rem 1rem; border-radius: 10px; font-weight: 600; font-size: 0.85rem; cursor: pointer; transition: all 0.2s; backdrop-filter: blur(10px); display: inline-flex; align-items: center; gap: 0.4rem; }
    .btn:hover { border-color: var(--accent-cyan); color: var(--accent-cyan); }
    .btn-danger { border-color: rgba(244, 63, 94, 0.3); color: var(--accent-red); }
    .btn-danger:hover { background: rgba(244, 63, 94, 0.15); border-color: var(--accent-red); color: var(--accent-red); }

    /* WEBHOOK DISPLAY CARD DENGAN TOMBOL SALIN BARU */
    .webhook-display-card { background: rgba(18, 26, 43, 0.9); border: 1px solid var(--card-border); border-radius: 16px; padding: 1.25rem; margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; }
    .wh-url-box { font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; background: rgba(8, 12, 20, 0.8); border: 1px solid var(--card-border); padding: 0.5rem 1rem; border-radius: 10px; color: var(--accent-cyan); flex: 1; min-width: 280px; overflow-x: auto; white-space: nowrap; }
    .btn-copy { background: linear-gradient(135deg, var(--accent-cyan), #0284c7); color: #fff; border: none; padding: 0.6rem 1.2rem; border-radius: 10px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 0.4rem; }
    .btn-copy:hover { opacity: 0.9; }

    /* MANUAL SETTINGS PANEL */
    .settings-panel { background: rgba(255, 255, 255, 0.03); border: 1px solid var(--card-border); border-radius: 16px; padding: 1.25rem; margin-bottom: 2rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1.5rem; }
    .setting-item { display: flex; align-items: center; gap: 0.8rem; }
    .setting-label { font-size: 0.85rem; font-weight: 700; color: var(--text-muted); }
    .setting-select, .setting-input { background: rgba(18, 26, 43, 0.8); border: 1px solid var(--card-border); color: #fff; padding: 0.4rem 0.8rem; border-radius: 8px; font-size: 0.85rem; outline: none; }

    .toggle-container { display: flex; align-items: center; gap: 0.6rem; background: rgba(18, 26, 43, 0.9); padding: 0.4rem 0.8rem; border-radius: 12px; border: 1px solid var(--card-border); }
    .switch { position: relative; display: inline-block; width: 44px; height: 24px; }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #334155; transition: .3s; border-radius: 24px; }
    .slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .3s; border-radius: 50%; }
    input:checked + .slider { background-color: var(--accent-green); }
    input:checked + .slider:before { transform: translateX(20px); }

    .upstash-metrics-panel { background: rgba(255, 255, 255, 0.03); border: 1px solid var(--card-border); border-radius: 16px; padding: 1.25rem; margin-bottom: 2rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
    .up-metric-box { background: rgba(18, 26, 43, 0.6); border: 1px solid var(--card-border); border-radius: 12px; padding: 1rem 1.25rem; }
    .up-label { font-size: 0.75rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.4rem; }
    .up-val-row { display: flex; align-items: baseline; gap: 0.4rem; margin-bottom: 0.6rem; }
    .up-val { font-size: 1.4rem; font-weight: 800; color: #ffffff; }
    .up-sub { font-size: 0.8rem; color: var(--text-muted); }
    .up-progress-bg { width: 100%; height: 4px; background: rgba(255,255,255,0.1); border-radius: 999px; overflow: hidden; }
    .up-progress-fill { height: 100%; background: var(--accent-green); border-radius: 999px; }

    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.25rem; margin-bottom: 2rem; }
    .stat-card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 16px; padding: 1.5rem; backdrop-filter: blur(12px); }
    .stat-label { font-size: 0.8rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-val { font-size: 2rem; font-weight: 800; margin-top: 0.4rem; letter-spacing: -0.02em; }
    .c-cyan { color: var(--accent-cyan); }
    .c-purple { color: var(--accent-purple); }

    .charts-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 1.25rem; margin-bottom: 2rem; }
    .chart-card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 16px; padding: 1.5rem; backdrop-filter: blur(12px); }
    .chart-title { font-size: 1.05rem; font-weight: 700; margin-bottom: 1.25rem; }

    .accounts-section { margin-bottom: 2rem; }
    .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 1rem; }
    .search-bar { background: rgba(15, 23, 42, 0.6); border: 1px solid var(--card-border); color: var(--text); padding: 0.6rem 1rem; border-radius: 10px; font-size: 0.85rem; outline: none; width: 260px; }

    .cards-wrapper { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 1.25rem; }
    .acc-card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 16px; padding: 1.5rem; backdrop-filter: blur(12px); position: relative; }
    .acc-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding-bottom: 0.75rem; border-bottom: 1px solid var(--card-border); }
    .acc-user { font-size: 1.1rem; font-weight: 800; color: var(--accent-cyan); }
    .btn-delete-acc { background: none; border: none; color: var(--accent-red); cursor: pointer; font-size: 0.85rem; }

    .status-pill { font-size: 0.75rem; font-weight: 700; padding: 0.25rem 0.6rem; border-radius: 6px; }
    .st-online { background: rgba(52, 211, 153, 0.15); color: var(--accent-green); border: 1px solid rgba(52, 211, 153, 0.3); }
    .st-offline { background: rgba(244, 63, 94, 0.15); color: var(--accent-red); border: 1px solid rgba(244, 63, 94, 0.3); }

    .acc-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 1rem; background: rgba(8, 12, 20, 0.5); padding: 0.8rem; border-radius: 10px; font-size: 0.85rem; }
    .metric-item span { color: var(--text-muted); font-size: 0.75rem; display: block; }
    .metric-item b { font-size: 0.95rem; font-weight: 700; }

    .list-box { margin-top: 0.75rem; }
    .list-title { font-size: 0.8rem; font-weight: 700; color: var(--text-muted); margin-bottom: 0.4rem; text-transform: uppercase; }
    .list-content { background: rgba(8, 12, 20, 0.7); border: 1px solid var(--card-border); border-radius: 8px; padding: 0.6rem 0.8rem; max-height: 120px; overflow-y: auto; font-size: 0.8rem; line-height: 1.5; }

    @media (max-width: 900px) {
      .charts-grid { grid-template-columns: 1fr; }
      .cards-wrapper { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    
    <header>
      <div class="title-group">
        <div class="logo">🎲</div>
        <div>
          <h1>Analytics & DB Control Center</h1>
          <p>Real-Time Webhook & Upstash Control Panel</p>
        </div>
      </div>
      <div class="header-right">
        <button class="btn" onclick="window.location.reload()">🔄 Refresh /stats</button>
        <button class="btn btn-danger" onclick="confirmReset()">🗑️ /reset Database</button>
        <button class="btn" onclick="logout()">🚪 Logout</button>
      </div>
    </header>

    <!-- KAD WEBHOOK URL LENGKAP DENGAN TOMBOL SALIN -->
    <div class="webhook-display-card">
      <div style="font-weight: 700; font-size: 0.9rem; color: var(--text-muted);">WEBHOOK GATEWAY URL:</div>
      <div class="wh-url-box" id="whUrlValue">${webhookUrl}</div>
      <button class="btn-copy" onclick="copyWebhookLink()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        Salin Webhook URL
      </button>
    </div>

    <!-- PANEL TETAPAN MANUAL -->
    <div class="settings-panel">
      <div class="setting-item">
        <span class="setting-label">ANALYSIS SYSTEM:</span>
        <div class="toggle-container">
          <label class="switch">
            <input type="checkbox" id="analyticsToggle" ${isAnalyticsOn ? 'checked' : ''} onchange="toggleSystemAnalytics(this)">
            <span class="slider"></span>
          </label>
        </div>
      </div>

      <div class="setting-item">
        <span class="setting-label">OFFLINE ALERT THRESHOLD:</span>
        <select class="setting-select" id="offlineSelect" onchange="updateOfflineThreshold(this.value)">
          <option value="10" ${offlineMinConfig === '10' ? 'selected' : ''}>10 Minit</option>
          <option value="15" ${offlineMinConfig === '15' ? 'selected' : ''}>15 Minit</option>
          <option value="20" ${offlineMinConfig === '20' ? 'selected' : ''}>20 Minit</option>
          <option value="30" ${offlineMinConfig === '30' ? 'selected' : ''}>30 Minit</option>
        </select>
      </div>

      <div class="setting-item">
        <span class="setting-label">AUTO REFRESH RATE:</span>
        <select class="setting-select" id="refreshSelect" onchange="changeAutoRefresh(this.value)">
          <option value="15000">15 Saat</option>
          <option value="30000" selected>30 Saat</option>
          <option value="60000">1 Minit</option>
          <option value="0">OFF</option>
        </select>
      </div>
    </div>

    <!-- METRICS PANEL -->
    <div class="upstash-metrics-panel">
      <div class="up-metric-box">
        <div class="up-label">WEBHOOK LATENCY</div>
        <div class="up-val-row">
          <div class="up-val" style="color: var(--accent-green);">${realTimeMs} ms</div>
          <div class="up-sub">Real-Time</div>
        </div>
        <div class="up-progress-bg"><div class="up-progress-fill" style="width: ${Math.min((realTimeMs/500)*100, 100)}%;"></div></div>
      </div>

      <div class="up-metric-box">
        <div class="up-label">COMMANDS</div>
        <div class="up-val-row">
          <div class="up-val">${totalLaporanGlobal > 1000 ? (totalLaporanGlobal/1000).toFixed(1) + ' rb' : totalLaporanGlobal}</div>
          <div class="up-sub">/ 500k per month</div>
        </div>
        <div class="up-progress-bg"><div class="up-progress-fill" style="width: ${Math.min((totalLaporanGlobal/500000)*100, 100)}%;"></div></div>
      </div>

      <div class="up-metric-box">
        <div class="up-label">BANDWIDTH</div>
        <div class="up-val-row">
          <div class="up-val">${(totalBytesEstimated / 1024).toFixed(0)} KB</div>
          <div class="up-sub">/ 10 GB</div>
        </div>
        <div class="up-progress-bg"><div class="up-progress-fill" style="width: 1%;"></div></div>
      </div>

      <div class="up-metric-box">
        <div class="up-label">STORAGE</div>
        <div class="up-val-row">
          <div class="up-val">${totalBytesEstimated} B</div>
          <div class="up-sub">/ 238 MB</div>
        </div>
        <div class="up-progress-bg"><div class="up-progress-fill" style="width: 1%;"></div></div>
      </div>

      <div class="up-metric-box">
        <div class="up-label">COST</div>
        <div class="up-val-row">
          <div class="up-val">$0.00</div>
        </div>
      </div>
    </div>

    <!-- CARDS STATISTIK AKUN -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Akun Aktif</div>
        <div class="stat-val">${users.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Gems Database</div>
        <div class="stat-val c-cyan">x${totalGemsGlobal.toLocaleString('id-ID')}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Trait Reroll</div>
        <div class="stat-val c-purple">x${totalTraitGlobal.toLocaleString('id-ID')}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Unit Diterima</div>
        <div class="stat-val">${totalUnitsGlobal}</div>
      </div>
    </div>

    <!-- GRAFIK -->
    <div class="charts-grid">
      <div class="chart-card">
        <div class="chart-title">📊 Perbandingan Perolehan Gems & Trait</div>
        <canvas id="barChart" height="120"></canvas>
      </div>
      <div class="chart-card">
        <div class="chart-title">🎯 Distribusi Gems Per Akun</div>
        <canvas id="doughnutChart" height="220"></canvas>
      </div>
    </div>

    <!-- DAFTAR AKUN STATS -->
    <div class="accounts-section">
      <div class="section-header">
        <h2 style="font-size: 1.2rem; font-weight: 800;">📋 Detail Statistik Akun (/stats)</h2>
        <input type="text" id="searchInput" class="search-bar" placeholder="Cari nama akun..." onkeyup="filterCards()">
      </div>

      <div class="cards-wrapper" id="cardsContainer">
        ${accountsData.length > 0 ? accountsData.map(acc => {
          const itemKeys = Object.keys(acc.potionsObj);
          return `
            <div class="acc-card" data-user="${acc.user.toLowerCase()}">
              <div class="acc-header">
                <div class="acc-user">👤 ${acc.user}</div>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <div class="status-pill ${acc.isOnline ? 'st-online' : 'st-offline'}">
                    ${acc.isOnline ? '● ONLINE' : '○ OFFLINE'}
                  </div>
                  <button class="btn-delete-acc" onclick="deleteAccountData('${acc.user}')" title="Hapus Data Akun Ini">🗑️</button>
                </div>
              </div>

              <div class="acc-metrics">
                <div class="metric-item">
                  <span>Total Gems</span>
                  <b class="c-cyan">x${acc.totalGems.toLocaleString('id-ID')}</b>
                </div>
                <div class="metric-item">
                  <span>Total Trait Reroll</span>
                  <b class="c-purple">x${acc.totalTrait.toLocaleString('id-ID')}</b>
                </div>
                <div class="metric-item">
                  <span>Rate Gems/Jam</span>
                  <b>~${acc.gemsPerHour.toLocaleString('id-ID')}</b>
                </div>
                <div class="metric-item">
                  <span>Rate Trait/Jam</span>
                  <b>~${acc.traitPerHour.toLocaleString('id-ID')}</b>
                </div>
                <div class="metric-item">
                  <span>Total Laporan</span>
                  <b>${acc.totalLaporan} log</b>
                </div>
                <div class="metric-item">
                  <span>Tower Selesai</span>
                  <b>${acc.towerSelesai}</b>
                </div>
              </div>

              <div class="list-box">
                <div class="list-title">Units Diterima (${acc.unitsReceived.length})</div>
                <div class="list-content">
                  ${acc.unitsReceived.length > 0 
                    ? acc.unitsReceived.map(u => `<div>• ${u}</div>`).join('') 
                    : '<div style="color: var(--text-muted);">Belum ada unit</div>'}
                </div>
              </div>

              <div class="list-box">
                <div class="list-title">Item & Potions</div>
                <div class="list-content">
                  ${itemKeys.length > 0 
                    ? itemKeys.map(k => `<div>• ${k}: x${acc.potionsObj[k]}</div>`).join('') 
                    : '<div style="color: var(--text-muted);">Belum ada item</div>'}
                </div>
              </div>

            </div>
          `;
        }).join('') : `
          <div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 3rem; background: var(--card-bg); border-radius: 16px;">
            Belum ada data laporan yang tersimpan di database.
          </div>
        `}
      </div>
    </div>

  </div>

  <script>
    let refreshTimer = setInterval(() => { window.location.reload(); }, 30000);

    function changeAutoRefresh(val) {
      clearInterval(refreshTimer);
      const intervalMs = parseInt(val, 10);
      if (intervalMs > 0) {
        refreshTimer = setInterval(() => { window.location.reload(); }, intervalMs);
      }
    }

    function copyWebhookLink() {
      const urlText = document.getElementById('whUrlValue').innerText;
      navigator.clipboard.writeText(urlText);
      alert('✅ Webhook URL berhasil disalin!');
    }

    async function toggleSystemAnalytics(el) {
      const isChecked = el.checked;
      try {
        const res = await fetch('/api/system', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: isChecked })
        });
        if (res.ok) {
          alert(isChecked ? '🟢 Analisis system DIAKTIFKAN!' : '🔴 Analisis system DIMATIKAN!');
        } else {
          el.checked = !isChecked;
        }
      } catch (e) {
        el.checked = !isChecked;
      }
    }

    async function updateOfflineThreshold(minVal) {
      await fetch('/api/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setOfflineThreshold', offlineMin: minVal })
      });
      alert('✅ Threshold Alert Offline diubah ke ' + minVal + ' minit.');
    }

    async function deleteAccountData(username) {
      if (confirm('Hapus seluruh data khusus untuk akun ' + username + '?')) {
        await fetch('/api/dashboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'deleteKey', key: 'stats:' + username })
        });
        window.location.reload();
      }
    }

    async function logout() {
      await fetch('/api/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout' })
      });
      window.location.reload();
    }

    async function confirmReset() {
      if (confirm('⚠️ PERINGATAN: Menghapus SELURUH database?')) {
        const res = await fetch('/api/dashboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reset' })
        });
        if (res.ok) {
          alert('✅ Database dibersihkan.');
          window.location.reload();
        }
      }
    }

    function filterCards() {
      const q = document.getElementById('searchInput').value.toLowerCase();
      const cards = document.querySelectorAll('.acc-card');
      cards.forEach(card => {
        const u = card.getAttribute('data-user');
        card.style.display = u.includes(q) ? 'block' : 'none';
      });
    }

    const rawData = ${JSON.stringify(accountsData)};
    const labels = rawData.map(d => d.user);
    const gemsData = rawData.map(d => d.totalGems);
    const traitData = rawData.map(d => d.totalTrait);

    new Chart(document.getElementById('barChart').getContext('2d'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: 'Gems', data: gemsData, backgroundColor: '#38bdf8', borderRadius: 6 },
          { label: 'Trait Reroll', data: traitData, backgroundColor: '#c084fc', borderRadius: 6 }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#94a3b8' } } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#94a3b8' } },
          y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#94a3b8' } }
        }
      }
    });

    new Chart(document.getElementById('doughnutChart').getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: gemsData,
          backgroundColor: ['#38bdf8', '#c084fc', '#34d399', '#f43f5e', '#fbbf24'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8' } } }
      }
    });
  </script>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html);
};
