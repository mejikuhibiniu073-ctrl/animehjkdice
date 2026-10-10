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
    const data = await res.json();
    return data.result;
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

  // Logout
  if (req.method === 'POST' && req.body && req.body.action === 'logout') {
    res.setHeader('Set-Cookie', 'auth=; Path=/; HttpOnly; Max-Age=0');
    return res.status(200).json({ success: true });
  }

  // Login
  if (req.method === 'POST' && req.body && req.body.action === 'login') {
    const { username, password } = req.body;
    if (!CONFIG.DASHBOARD_USER || !CONFIG.DASHBOARD_PASS) {
      return res.status(500).json({ success: false, message: 'DASHBOARD_USER & DASHBOARD_PASS belum diset di Vercel!' });
    }
    if (username === CONFIG.DASHBOARD_USER && password === CONFIG.DASHBOARD_PASS) {
      res.setHeader('Set-Cookie', `auth=true; Path=/; HttpOnly; Max-Age=86400`);
      return res.status(200).json({ success: true });
    } else {
      return res.status(401).json({ success: false, message: 'Username atau Password salah!' });
    }
  }

  // API Aksi Database
  if (req.method === 'POST' && req.body && req.body.action) {
    if (cookies.auth !== 'true') {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { action, key, value, type, field } = req.body;

    if (action === 'reset') {
      await redisCmd('flushall');
      return res.status(200).json({ success: true, message: 'Database berhasil dibersihkan.' });
    }

    if (action === 'deleteKey' && key) {
      await redisCmd('del', key);
      if (key.startsWith('stats:')) {
        const uName = key.replace('stats:', '').split(':')[0];
        await redisCmd('srem', 'stats:users', uName);
      }
      return res.status(200).json({ success: true });
    }

    if (action === 'setKey' && key) {
      if (type === 'string') {
        await redisCmd('set', key, value);
      } else if (type === 'set') {
        await redisCmd('sadd', key, value);
      } else if (type === 'list') {
        await redisCmd('rpush', key, value);
      } else if (type === 'hash' && field) {
        await redisCmd('hset', key, field, value);
      }
      return res.status(200).json({ success: true });
    }

    if (action === 'removeSetItem' && key && value) {
      await redisCmd('srem', key, value);
      return res.status(200).json({ success: true });
    }

    if (action === 'removeListItem' && key && value) {
      await redisCmd('lrem', key, 0, value);
      return res.status(200).json({ success: true });
    }

    if (action === 'removeHashField' && key && field) {
      await redisCmd('hdel', key, field);
      return res.status(200).json({ success: true });
    }
  }

  // Tampilan Login
  if (cookies.auth !== 'true') {
    const loginHtml = `
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - Upstash DB Center</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Plus Jakarta Sans', sans-serif; }
    body { background: #0b0f17; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 1.5rem; }
    .login-card { background: #131b2e; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 20px; padding: 2.5rem; width: 100%; max-width: 400px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
    .logo { width: 48px; height: 48px; background: #00e599; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; margin: 0 auto 1.25rem auto; color: #0b0f17; font-weight: 800; }
    h2 { text-align: center; font-size: 1.35rem; font-weight: 800; margin-bottom: 0.4rem; }
    p { text-align: center; color: #94a3b8; font-size: 0.85rem; margin-bottom: 1.5rem; }
    .form-group { margin-bottom: 1.2rem; }
    label { display: block; font-size: 0.8rem; font-weight: 600; color: #94a3b8; margin-bottom: 0.4rem; }
    input { width: 100%; background: #0b0f17; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; padding: 0.75rem 1rem; color: #fff; font-size: 0.9rem; outline: none; transition: border-color 0.2s; }
    input:focus { border-color: #00e599; }
    .btn-submit { width: 100%; background: #00e599; border: none; color: #0b0f17; padding: 0.85rem; border-radius: 10px; font-weight: 700; font-size: 0.9rem; cursor: pointer; transition: opacity 0.2s; margin-top: 0.5rem; }
    .btn-submit:hover { opacity: 0.9; }
    .error-msg { color: #f43f5e; font-size: 0.8rem; text-align: center; margin-top: 1rem; display: none; }
  </style>
</head>
<body>
  <div class="login-card">
    <div class="logo">⚡</div>
    <h2>Upstash DB Login</h2>
    <p>Masukkan kredensial akun untuk mengakses dashboard</p>
    <form id="loginForm">
      <div class="form-group">
        <label>Username</label>
        <input type="text" id="username" required autocomplete="off">
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" id="password" required>
      </div>
      <button type="submit" class="btn-submit">Masuk Dashboard</button>
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
          err.innerText = data.message || 'Login gagal!';
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

  // AMBIL DATA REDIS
  let keysList = await redisCmd('keys', '*');
  if (!Array.isArray(keysList)) keysList = keysList ? [keysList] : [];

  const dbBrowserData = {};
  let totalBytes = 0;
  let totalCommands = 0;
  let latestSeenTime = 0;

  for (const k of keysList) {
    const kType = await redisCmd('type', k);
    const ttl = await redisCmd('ttl', k);
    let val = null;

    if (kType === 'string') {
      val = await redisCmd('get', k);
      totalBytes += (String(val).length);
    } else if (kType === 'set') {
      val = await redisCmd('smembers', k);
      if (!Array.isArray(val)) val = val ? [val] : [];
      totalBytes += JSON.stringify(val).length;
    } else if (kType === 'list') {
      val = await redisCmd('lrange', k, 0, -1);
      if (!Array.isArray(val)) val = val ? [val] : [];
      totalBytes += JSON.stringify(val).length;
    } else if (kType === 'hash') {
      const rawH = await redisCmd('hgetall', k) || [];
      const hObj = {};
      if (Array.isArray(rawH)) {
        for (let i = 0; i < rawH.length; i += 2) {
          hObj[rawH[i]] = rawH[i + 1];
        }
      } else if (typeof rawH === 'object') {
        Object.assign(hObj, rawH);
      }
      val = hObj;
      totalBytes += JSON.stringify(val).length;
    }

    if (k.endsWith(':totalLaporan')) {
      totalCommands += parseInt(val || 0, 10);
    }

    if (k.endsWith(':lastSeen')) {
      const seenVal = parseInt(val || 0, 10);
      if (seenVal > latestSeenTime) latestSeenTime = seenVal;
    }

    dbBrowserData[k] = { type: kType, ttl, value: val };
  }

  const hostHeader = req.headers.host || 'localhost';
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const webhookEndpoint = `${protocol}://${hostHeader}/api/webhook`;

  // Render Dashboard
  const html = `
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Upstash Redis Manager & Webhook Monitor</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --border: #e2e8f0;
      --text: #0f172a;
      --text-muted: #64748b;
      --emerald: #10b981;
      --emerald-light: #ecfdf5;
      --purple-bg: #eef2ff;
      --purple-text: #4f46e5;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Plus Jakarta Sans', sans-serif; }
    body { background: #f1f5f9; color: var(--text); padding: 1.5rem; min-height: 100vh; }
    .container { max-width: 1300px; margin: 0 auto; }

    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    .brand { display: flex; align-items: center; gap: 0.75rem; }
    .brand-icon { width: 38px; height: 38px; background: var(--emerald); color: #fff; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.2rem; }
    .brand h1 { font-size: 1.25rem; font-weight: 800; }

    .header-actions { display: flex; gap: 0.5rem; }
    .btn { background: #fff; border: 1px solid var(--border); padding: 0.5rem 0.9rem; border-radius: 8px; font-weight: 600; font-size: 0.82rem; cursor: pointer; color: var(--text); transition: all 0.2s; display: inline-flex; align-items: center; gap: 0.4rem; }
    .btn:hover { background: #f8fafc; border-color: #cbd5e1; }
    .btn-emerald { background: var(--emerald); color: #fff; border: none; }
    .btn-emerald:hover { background: #059669; }
    .btn-danger { color: #ef4444; border-color: #fee2e2; }
    .btn-danger:hover { background: #fef2f2; }

    /* WEBHOOK PANEL (DESAIN MODERN BARU) */
    .webhook-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 14px; padding: 1.25rem; margin-bottom: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.02); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; }
    .wh-info { display: flex; align-items: center; gap: 1rem; }
    .wh-status-dot { width: 12px; height: 12px; background: var(--emerald); border-radius: 50%; box-shadow: 0 0 10px var(--emerald); animation: pulse 1.8s infinite; }
    @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.3; } 100% { opacity: 1; } }
    .wh-title { font-size: 0.9rem; font-weight: 800; display: flex; align-items: center; gap: 0.5rem; }
    .wh-url-box { font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; background: #f1f5f9; padding: 0.4rem 0.75rem; border-radius: 8px; border: 1px solid var(--border); margin-top: 0.3rem; color: #334155; }
    .wh-meta { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem; }

    /* METRICS CARDS */
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
    .metric-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 14px; padding: 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
    .metric-title { font-size: 0.75rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }
    .metric-value-box { display: flex; align-items: baseline; gap: 0.4rem; margin-bottom: 0.75rem; }
    .metric-val { font-size: 1.6rem; font-weight: 800; }
    .metric-sub { font-size: 0.85rem; color: var(--text-muted); font-weight: 500; }
    .progress-bar { width: 100%; height: 5px; background: #e2e8f0; border-radius: 999px; overflow: hidden; }
    .progress-fill { height: 100%; background: var(--emerald); border-radius: 999px; }

    /* DATA BROWSER CONTAINER */
    .browser-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); overflow: hidden; }
    .browser-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border); background: #fafafa; flex-wrap: wrap; gap: 0.75rem; }
    
    .toolbar-left { display: flex; align-items: center; gap: 0.5rem; flex: 1; max-width: 600px; }
    .select-type { background: #fff; border: 1px solid var(--border); padding: 0.5rem 0.75rem; border-radius: 8px; font-size: 0.85rem; font-weight: 600; color: var(--text); outline: none; }
    .search-input { width: 100%; background: #fff; border: 1px solid var(--border); padding: 0.5rem 0.85rem; border-radius: 8px; font-size: 0.85rem; outline: none; }

    .browser-body { display: grid; grid-template-columns: 280px 1fr; min-height: 480px; }

    /* LEFT SIDEBAR: KEY LIST */
    .keys-sidebar { border-right: 1px solid var(--border); padding: 0.75rem; background: #f8fafc; }
    .key-item { display: flex; align-items: center; gap: 0.6rem; padding: 0.65rem 0.8rem; border-radius: 10px; font-size: 0.85rem; font-weight: 600; cursor: pointer; color: var(--text); margin-bottom: 0.25rem; transition: all 0.15s; }
    .key-item:hover { background: #f1f5f9; }
    .key-item.active { background: var(--purple-bg); color: var(--purple-text); border: 1px solid rgba(79, 70, 229, 0.2); }
    
    .type-badge { font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; font-weight: 700; padding: 0.15rem 0.4rem; border-radius: 4px; text-transform: uppercase; }
    .badge-set { background: #e0e7ff; color: #3730a3; }
    .badge-string { background: #dbeafe; color: #1e40af; }
    .badge-hash { background: #fef3c7; color: #92400e; }
    .badge-list { background: #fce7f3; color: #9d174d; }

    /* RIGHT CONTENT: KEY DETAIL */
    .key-detail { padding: 1.25rem; background: #fff; display: flex; flex-direction: column; }
    .detail-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding-bottom: 0.85rem; border-bottom: 1px solid var(--border); }
    .key-title { font-family: 'JetBrains Mono', monospace; font-size: 1.1rem; font-weight: 700; }

    .meta-badges { display: flex; align-items: center; gap: 0.5rem; }
    .meta-tag { font-size: 0.75rem; background: #f1f5f9; padding: 0.25rem 0.6rem; border-radius: 6px; color: var(--text-muted); font-weight: 600; }

    .value-container { flex: 1; background: #f8fafc; border: 1px solid var(--border); border-radius: 12px; padding: 1rem; font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; overflow-y: auto; max-height: 360px; }
    
    .val-row { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0.75rem; background: #fff; border: 1px solid var(--border); border-radius: 8px; margin-bottom: 0.5rem; }
    .val-row:last-child { margin-bottom: 0; }
    .btn-icon { background: none; border: none; cursor: pointer; color: var(--text-muted); padding: 0.2rem; border-radius: 4px; }
    .btn-icon:hover { color: #ef4444; }

    /* MODAL ADD KEY */
    .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(15, 23, 42, 0.4); display: none; align-items: center; justify-content: center; z-index: 1000; }
    .modal-box { background: #fff; border-radius: 16px; padding: 1.5rem; width: 100%; max-width: 420px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); }
    .modal-title { font-size: 1.1rem; font-weight: 800; margin-bottom: 1rem; }
    .form-field { margin-bottom: 0.85rem; }
    .form-field label { display: block; font-size: 0.8rem; font-weight: 600; color: var(--text-muted); margin-bottom: 0.3rem; }
    .form-field input, .form-field select { width: 100%; border: 1px solid var(--border); padding: 0.6rem 0.8rem; border-radius: 8px; font-size: 0.85rem; outline: none; }

    @media (max-width: 768px) {
      .browser-body { grid-template-columns: 1fr; }
      .keys-sidebar { border-right: none; border-bottom: 1px solid var(--border); }
    }
  </style>
</head>
<body>
  <div class="container">
    
    <!-- HEADER -->
    <header>
      <div class="brand">
        <div class="brand-icon">⚡</div>
        <div>
          <h1>Upstash Database & Webhook Center</h1>
        </div>
      </div>
      <div class="header-actions">
        <button class="btn" onclick="window.location.reload()">🔄 Refresh</button>
        <button class="btn btn-danger" onclick="confirmReset()">🗑️ Flush DB</button>
        <button class="btn" onclick="logout()">🚪 Logout</button>
      </div>
    </header>

    <!-- PANEL KONEKTIVITAS WEBHOOK MODERN -->
    <div class="webhook-card">
      <div class="wh-info">
        <div class="wh-status-dot" id="whDot"></div>
        <div>
          <div class="wh-title">
            <span>🔗 Vercel Webhook Endpoint Gateway</span>
            <span style="font-size: 0.7rem; background: var(--emerald-light); color: var(--emerald); padding: 0.1rem 0.5rem; border-radius: 999px; font-weight: 700;">ACTIVE</span>
          </div>
          <div class="wh-url-box" id="whUrlText">${webhookEndpoint}</div>
          <div class="wh-meta">
            Aktivitas Terakhir: <b>${latestSeenTime > 0 ? new Date(latestSeenTime).toLocaleString('id-ID') : 'Belum ada aktivitas'}</b>
          </div>
        </div>
      </div>
      <div style="display: flex; gap: 0.5rem;">
        <button class="btn" onclick="copyWebhookUrl()">📋 Salin URL</button>
        <button class="btn btn-emerald" onclick="testPingWebhook()">⚡ Test Ping Gateway</button>
      </div>
    </div>

    <!-- METRICS CARDS -->
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-title">COMMANDS</div>
        <div class="metric-value-box">
          <div class="metric-val">${totalCommands > 1000 ? (totalCommands/1000).toFixed(1) + ' rb' : totalCommands}</div>
          <div class="metric-sub">/ 500k per month</div>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width: ${Math.min((totalCommands/500000)*100, 100)}%;"></div></div>
      </div>

      <div class="metric-card">
        <div class="metric-title">BANDWIDTH</div>
        <div class="metric-value-box">
          <div class="metric-val">${(totalBytes/1024).toFixed(1)} KB</div>
          <div class="metric-sub">/ 10 GB</div>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width: ${Math.min(((totalBytes/1024)/(10*1024*1024))*100, 100)}%;"></div></div>
      </div>

      <div class="metric-card">
        <div class="metric-title">STORAGE</div>
        <div class="metric-value-box">
          <div class="metric-val">${totalBytes} B</div>
          <div class="metric-sub">/ 256 MB</div>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width: ${Math.min((totalBytes/(256*1024*1024))*100, 100)}%;"></div></div>
      </div>

      <div class="metric-card">
        <div class="metric-title">COST</div>
        <div class="metric-value-box">
          <div class="metric-val">$0.00</div>
        </div>
      </div>
    </div>

    <!-- DATA BROWSER CONTAINER -->
    <div class="browser-card">
      <div class="browser-toolbar">
        <div class="toolbar-left">
          <select class="select-type" id="filterType" onchange="filterKeys()">
            <option value="ALL">All Types</option>
            <option value="SET">SET</option>
            <option value="STRING">STRING</option>
            <option value="HASH">HASH</option>
            <option value="LIST">LIST</option>
          </select>
          <input type="text" id="searchKey" class="search-input" placeholder="Search keys..." onkeyup="filterKeys()">
        </div>
        <div>
          <button class="btn btn-emerald" onclick="openAddModal()">+ Key</button>
        </div>
      </div>

      <div class="browser-body">
        <!-- LEFT SIDEBAR -->
        <div class="keys-sidebar" id="keysList">
          ${keysList.length > 0 ? keysList.map(k => {
            const item = dbBrowserData[k];
            const badgeClass = 'badge-' + item.type.toLowerCase();
            return `
              <div class="key-item" data-key="${k}" data-type="${item.type.toUpperCase()}" onclick="selectKey('${k}')">
                <span class="type-badge ${badgeClass}">${item.type}</span>
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${k}</span>
              </div>
            `;
          }).join('') : `<div style="padding: 1rem; color: var(--text-muted); font-size: 0.85rem;">No keys found</div>`}
        </div>

        <!-- RIGHT DETAIL -->
        <div class="key-detail" id="keyDetail">
          <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); font-size: 0.9rem;">
            Pilih key di sebelah kiri untuk melihat & mengedit isi data.
          </div>
        </div>
      </div>
    </div>

  </div>

  <!-- MODAL ADD KEY -->
  <div class="modal-overlay" id="addModal">
    <div class="modal-box">
      <div class="modal-title">Tambah Key Baru</div>
      <div class="form-field">
        <label>Key Name</label>
        <input type="text" id="newKeyName" placeholder="stats:Username">
      </div>
      <div class="form-field">
        <label>Data Type</label>
        <select id="newKeyType" onchange="toggleFieldInput()">
          <option value="string">STRING</option>
          <option value="set">SET</option>
          <option value="list">LIST</option>
          <option value="hash">HASH</option>
        </select>
      </div>
      <div class="form-field" id="hashFieldGroup" style="display: none;">
        <label>Hash Field</label>
        <input type="text" id="newHashField" placeholder="PotionName">
      </div>
      <div class="form-field">
        <label>Value</label>
        <input type="text" id="newKeyValue" placeholder="Value...">
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.25rem;">
        <button class="btn" onclick="closeAddModal()">Batal</button>
        <button class="btn btn-emerald" onclick="saveNewKey()">Simpan Key</button>
      </div>
    </div>
  </div>

  <script>
    const dbData = ${JSON.stringify(dbBrowserData)};
    let activeKey = null;

    function copyWebhookUrl() {
      const urlText = document.getElementById('whUrlText').innerText;
      navigator.clipboard.writeText(urlText);
      alert('✅ Webhook URL berhasil disalin ke clipboard!');
    }

    async function testPingWebhook() {
      const urlText = document.getElementById('whUrlText').innerText;
      try {
        const res = await fetch(urlText, { method: 'GET' });
        const data = await res.json();
        if (res.ok) {
          alert('🟢 WEBHOOK ONLINE!\n\nStatus: ' + data.status + '\nPesan: ' + data.message);
        } else {
          alert('🔴 Webhook merespons dengan error status: ' + res.status);
        }
      } catch (e) {
        alert('❌ Gagal menghubungi endpoint Webhook.');
      }
    }

    function selectKey(k) {
      activeKey = k;
      document.querySelectorAll('.key-item').forEach(el => {
        el.classList.toggle('active', el.getAttribute('data-key') === k);
      });

      const item = dbData[k];
      const detailContainer = document.getElementById('keyDetail');

      let valueHtml = '';

      if (item.type === 'set' || item.type === 'list') {
        const arr = Array.isArray(item.value) ? item.value : [item.value];
        valueHtml = arr.map(v => `
          <div class="val-row">
            <span>${v}</span>
            <button class="btn-icon" onclick="removeItem('${k}', '${item.type}', '${v}')">🗑️</button>
          </div>
        `).join('');
      } else if (item.type === 'hash') {
        const keys = Object.keys(item.value || {});
        valueHtml = keys.map(f => `
          <div class="val-row">
            <div><b>${f}:</b>${item.value[f]}</div>
            <button class="btn-icon" onclick="removeHashField('${k}', '${f}')">🗑️</button>
          </div>
        `).join('');
      } else {
        valueHtml = `
          <div class="val-row">
            <span>${item.value}</span>
          </div>
        `;
      }

      detailContainer.innerHTML = `
        <div class="detail-header">
          <div class="key-title">${k}</div>
          <div class="meta-badges">
            <span class="type-badge badge-\${item.type.toLowerCase()}">\${item.type}</span>
            <span class="meta-tag">TTL: \${item.ttl > 0 ? item.ttl + 's' : 'No'}</span>
            <button class="btn btn-danger" onclick="deleteEntireKey('\${k}')">Hapus Key</button>
          </div>
        </div>
        <div style="margin-bottom: 0.5rem; font-size: 0.8rem; font-weight: 700; color: var(--text-muted);">VALUES / ITEMS:</div>
        <div class="value-container">
          \${valueHtml || '<div style="color: var(--text-muted);">Kosong</div>'}
        </div>
      `;
    }

    function filterKeys() {
      const type = document.getElementById('filterType').value;
      const q = document.getElementById('searchKey').value.toLowerCase();

      document.querySelectorAll('.key-item').forEach(el => {
        const k = el.getAttribute('data-key').toLowerCase();
        const t = el.getAttribute('data-type');
        const matchType = type === 'ALL' || t === type;
        const matchQ = k.includes(q);
        el.style.display = (matchType && matchQ) ? 'flex' : 'none';
      });
    }

    async function deleteEntireKey(k) {
      if (confirm('Hapus key ' + k + ' dari database?')) {
        await fetch('/api/dashboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'deleteKey', key: k })
        });
        window.location.reload();
      }
    }

    async function removeItem(k, type, val) {
      const act = type === 'set' ? 'removeSetItem' : 'removeListItem';
      await fetch('/api/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: act, key: k, value: val })
      });
      window.location.reload();
    }

    async function removeHashField(k, field) {
      await fetch('/api/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'removeHashField', key: k, field: field })
      });
      window.location.reload();
    }

    function openAddModal() {
      document.getElementById('addModal').style.display = 'flex';
    }

    function closeAddModal() {
      document.getElementById('addModal').style.display = 'none';
    }

    function toggleFieldInput() {
      const t = document.getElementById('newKeyType').value;
      document.getElementById('hashFieldGroup').style.display = t === 'hash' ? 'block' : 'none';
    }

    async function saveNewKey() {
      const k = document.getElementById('newKeyName').value;
      const t = document.getElementById('newKeyType').value;
      const v = document.getElementById('newKeyValue').value;
      const f = document.getElementById('newHashField').value;

      if (!k || !v) {
        alert('Key Name dan Value harus diisi!');
        return;
      }

      await fetch('/api/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setKey', key: k, type: t, value: v, field: f })
      });
      window.location.reload();
    }

    async function confirmReset() {
      if (confirm('⚠️ PERINGATAN: Apakah Anda yakin ingin menghapus SELURUH database?')) {
        await fetch('/api/dashboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reset' })
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
  </script>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html);
};
