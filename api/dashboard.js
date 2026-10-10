const CONFIG = {
  DASHBOARD_USER: process.env.DASHBOARD_USER,
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
    const data = await res.json();
    return { result: data.result, latencyMs: Date.now() - start };
  } catch (e) {
    return { result: null, latencyMs: Date.now() - start };
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

function formatUptime(ms) {
  if (!ms || ms <= 0) return '0j 0m';
  const sec = Math.floor(ms / 1000);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  return days > 0 ? `${days}h ${hours}j ${minutes}m` : `${hours}j ${minutes}m`;
}

module.exports = async (req, res) => {
  const cookies = parseCookies(req);

  // PROTEKSI AKSES: Redirect ke /api/login jika belum login
  if (cookies.auth !== 'true') {
    res.writeHead(302, { Location: '/api/login' });
    return res.end();
  }

  // Aksi Logout
  if (req.method === 'POST' && req.body?.action === 'logout') {
    res.setHeader('Set-Cookie', [
      'auth=; Path=/; HttpOnly; Max-Age=0',
      'auth_user=; Path=/; HttpOnly; Max-Age=0',
      'auth_role=; Path=/; HttpOnly; Max-Age=0'
    ]);
    return res.status(200).json({ success: true, redirect: '/api/login' });
  }

  // Aksi Reset Database Statistik Akun (Data Metrik Upstash Tetap Aman)
  if (req.method === 'POST' && req.body?.action === 'reset') {
    const users = (await redisCmd('smembers', 'stats:users')).result || [];
    if (Array.isArray(users)) {
      await Promise.all(users.map(async (u) => {
        const keys = ['totalLaporan', 'unitMasukTas', 'towerSelesai', 'totalGems', 'totalTraitReroll', 'startTime', 'lastSeen', 'unitsReceived', 'towerList', 'potions'];
        await Promise.all(keys.map(k => redisCmd('del', `stats:${u}:${k}`)));
      }));
    }
    await redisCmd('del', 'stats:users');
    return res.status(200).json({ success: true });
  }

  // Aksi Hapus Key Spesifik Akun
  if (req.method === 'POST' && req.body?.action === 'deleteKey' && req.body?.key) {
    await redisCmd('del', req.body.key);
    if (req.body.key.startsWith('stats:')) {
      await redisCmd('srem', 'stats:users', req.body.key.replace('stats:', '').split(':')[0]);
    }
    return res.status(200).json({ success: true });
  }

  // Aksi Set Threshold Offline
  if (req.method === 'POST' && req.body?.action === 'setOfflineThreshold' && req.body?.offlineMin) {
    await redisCmd('set', 'system:offline_threshold_min', req.body.offlineMin);
    return res.status(200).json({ success: true });
  }

  // INFORMASI IDENTITAS USER
  const currentUser = decodeURIComponent(cookies.auth_user || 'Admin');
  const currentRole = cookies.auth_role || 'user';
  const isAdmin = currentRole === 'admin' || currentUser === CONFIG.DASHBOARD_USER;

  // FETCH DATA DASHBOARD DARI REDIS
  const [sysStatusRes, offlineMinRes, cmdRes, bytesRes, startRes, usersRes] = await Promise.all([
    redisCmd('get', 'system:analytics_status'),
    redisCmd('get', 'system:offline_threshold_min'),
    redisCmd('get', 'global:total_commands'),
    redisCmd('get', 'global:total_bytes'),
    redisCmd('get', 'global:system_start_time'),
    redisCmd('smembers', 'stats:users')
  ]);

  const isAnalyticsOn = sysStatusRes.result !== 'disabled';
  const offlineMinConfig = offlineMinRes.result || '20';
  const globalCommands = parseInt(cmdRes.result || 0, 10);
  const globalBytes = parseInt(bytesRes.result || 0, 10);
  const now = Date.now();
  const systemUptimeText = formatUptime(now - parseInt(startRes.result || now, 10));

  let users = usersRes.result || [];
  if (!Array.isArray(users)) users = users ? [users] : [];
  const realTimeMs = usersRes.latencyMs;

  let totalGemsGlobal = 0, totalTraitGlobal = 0, totalUnitsGlobal = 0;

  const accountsData = await Promise.all(users.map(async (user) => {
    const prefix = `stats:${user}`;
    const [laporan, unitTas, tower, gems, trait, start, last, units, towers, potionsRaw] = await Promise.all([
      redisCmd('get', `${prefix}:totalLaporan`),
      redisCmd('get', `${prefix}:unitMasukTas`),
      redisCmd('get', `${prefix}:towerSelesai`),
      redisCmd('get', `${prefix}:totalGems`),
      redisCmd('get', `${prefix}:totalTraitReroll`),
      redisCmd('get', `${prefix}:startTime`),
      redisCmd('get', `${prefix}:lastSeen`),
      redisCmd('lrange', `${prefix}:unitsReceived`, 0, -1),
      redisCmd('lrange', `${prefix}:towerList`, 0, -1),
      redisCmd('hgetall', `${prefix}:potions`)
    ]);

    const totalGems = parseInt(gems.result || 0, 10);
    const totalTrait = parseInt(trait.result || 0, 10);
    const unitsReceived = Array.isArray(units.result) ? units.result : (units.result ? [units.result] : []);
    const towerList = Array.isArray(towers.result) ? towers.result : (towers.result ? [towers.result] : []);

    totalGemsGlobal += totalGems;
    totalTraitGlobal += totalTrait;
    totalUnitsGlobal += unitsReceived.length;

    const potionsObj = {};
    if (Array.isArray(potionsRaw.result)) {
      for (let i = 0; i < potionsRaw.result.length; i += 2) potionsObj[potionsRaw.result[i]] = potionsRaw.result[i + 1];
    } else if (typeof potionsRaw.result === 'object' && potionsRaw.result !== null) {
      Object.assign(potionsObj, potionsRaw.result);
    }

    const duration = Math.max((now - parseInt(start.result || now, 10)) / 3600000, 0.01);
    const isOnline = (now - parseInt(last.result || 0, 10)) < (parseInt(offlineMinConfig, 10) * 60000);

    return {
      user, isOnline, totalLaporan: parseInt(laporan.result || 0, 10),
      unitMasukTas: parseInt(unitTas.result || 0, 10), towerSelesai: parseInt(tower.result || 0, 10),
      totalGems, totalTrait, gemsPerHour: Math.round(totalGems / duration),
      traitPerHour: Math.round(totalTrait / duration), unitsReceived, towerList, potionsObj
    };
  }));

  // FETCH DATA SELURUH USER UNTUK TAB MANAGEMENT ADMIN
  let allRegisteredUsers = [];
  if (isAdmin) {
    const allUsersList = (await redisCmd('smembers', 'users:all')).result || [];
    if (Array.isArray(allUsersList)) {
      allRegisteredUsers = await Promise.all(allUsersList.map(async (u) => {
        const raw = await redisCmd('get', `user:${u}`);
        return raw ? JSON.parse(raw) : null;
      }));
      allRegisteredUsers = allRegisteredUsers.filter(Boolean);
    }
  }

  const hostHeader = req.headers.host || 'animehjkdice.vercel.app';
  const webhookUrl = `${req.headers['x-forwarded-proto'] || 'https'}://${hostHeader}/api/webhook`;

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(`
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard Analytics & Real-Time Control</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root { --bg:#07090e; --card-bg:rgba(18,26,43,0.75); --card-border:rgba(255,255,255,0.08); --cyan:#38bdf8; --purple:#c084fc; --green:#34d399; --red:#f43f5e; --text:#f8fafc; --muted:#94a3b8; }
    *{margin:0;padding:0;box-sizing:border-box;font-family:'Plus Jakarta Sans',sans-serif;}
    body{background:var(--bg);color:var(--text);min-height:100vh;padding:2rem 1.5rem;}
    .container{max-width:1400px;margin:0 auto;}
    header{display:flex;justify-content:space-between;align-items:center;margin-bottom:2rem;flex-wrap:wrap;gap:1rem;}
    .logo{width:46px;height:46px;background:linear-gradient(135deg,var(--cyan),var(--purple));border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:800;}
    .btn{background:var(--card-bg);border:1px solid var(--card-border);color:var(--text);padding:0.6rem 1rem;border-radius:10px;font-weight:600;font-size:0.85rem;cursor:pointer;}
    .btn-danger{border-color:rgba(244,63,94,0.3);color:var(--red);}

    .user-badge-admin { color:#38bdf8; font-weight:800; font-size:1rem; text-shadow: 0 0 10px #38bdf8, 0 0 20px #38bdf8; padding:0.4rem 0.8rem; background:rgba(56,189,248,0.1); border-radius:10px; border:1px solid rgba(56,189,248,0.3); }
    .user-badge-user { color:#ffffff; font-weight:700; font-size:1rem; padding:0.4rem 0.8rem; background:rgba(255,255,255,0.05); border-radius:10px; border:1px solid rgba(255,255,255,0.1); }

    .nav-tabs { display:flex; gap:1rem; margin-bottom:1.5rem; border-bottom:1px solid var(--card-border); padding-bottom:0.75rem; }
    .nav-btn { background:none; border:none; color:var(--muted); font-size:1rem; font-weight:700; cursor:pointer; padding:0.4rem 0.8rem; border-radius:8px; }
    .nav-btn.active { color:var(--cyan); background:rgba(56,189,248,0.1); }

    .webhook-card{background:rgba(18,26,43,0.9);border:1px solid var(--card-border);border-radius:16px;padding:1.25rem;margin-bottom:1.5rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;}
    .wh-box{font-family:'JetBrains Mono',monospace;font-size:0.85rem;background:rgba(8,12,20,0.8);border:1px solid var(--card-border);padding:0.5rem 1rem;border-radius:10px;color:var(--cyan);flex:1;}
    .btn-copy{background:linear-gradient(135deg,var(--cyan),#0284c7);color:#fff;border:none;padding:0.6rem 1.2rem;border-radius:10px;font-weight:700;cursor:pointer;}
    .settings-panel{background:rgba(255,255,255,0.03);border:1px solid var(--card-border);border-radius:16px;padding:1.25rem;margin-bottom:2rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1.5rem;}
    .switch{position:relative;display:inline-block;width:44px;height:24px;}
    .switch input{opacity:0;width:0;height:0;}
    .slider{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:#334155;border-radius:24px;transition:.3s;}
    .slider:before{position:absolute;content:"";height:18px;width:18px;left:3px;bottom:3px;background-color:#fff;border-radius:50%;transition:.3s;}
    input:checked + .slider{background-color:var(--green);}
    input:checked + .slider:before{transform:translateX(20px);}
    .metrics-panel{background:rgba(255,255,255,0.03);border:1px solid var(--card-border);border-radius:16px;padding:1.25rem;margin-bottom:2rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;}
    .metric-box{background:rgba(18,26,43,0.6);border:1px solid var(--card-border);border-radius:12px;padding:1rem 1.25rem;}
    .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1.25rem;margin-bottom:2rem;}
    .stat-card{background:var(--card-bg);border:1px solid var(--card-border);border-radius:16px;padding:1.5rem;}
    .charts-grid{display:grid;grid-template-columns:2fr 1fr;gap:1.25rem;margin-bottom:2rem;}
    .chart-card{background:var(--card-bg);border:1px solid var(--card-border);border-radius:16px;padding:1.5rem;}
    .cards-wrapper{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:1.25rem;}
    .acc-card{background:var(--card-bg);border:1px solid var(--card-border);border-radius:16px;padding:1.5rem;}
    .acc-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;padding-bottom:0.75rem;border-bottom:1px solid var(--card-border);}
    .acc-metrics{display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem;background:rgba(8,12,20,0.5);padding:0.8rem;border-radius:10px;font-size:0.85rem;}
    .list-box{margin-top:0.75rem;}
    .list-title{font-size:0.8rem;font-weight:700;color:var(--muted);margin-bottom:0.4rem;text-transform:uppercase;}
    .list-content{background:rgba(8,12,20,0.7);border:1px solid var(--card-border);border-radius:8px;padding:0.6rem 0.8rem;max-height:120px;overflow-y:auto;font-size:0.8rem;line-height:1.5;}
    .status-pill{font-size:0.75rem;font-weight:700;padding:0.25rem 0.6rem;border-radius:6px;}
    .st-online{background:rgba(52,211,153,0.15);color:var(--green);border:1px solid rgba(52,211,153,0.3);}
    .st-offline{background:rgba(244,63,94,0.15);color:var(--red);border:1px solid rgba(244,63,94,0.3);}

    .admin-table { width:100%; border-collapse:collapse; margin-top:1rem; }
    .admin-table th, .admin-table td { padding:0.8rem; text-align:left; border-bottom:1px solid var(--card-border); font-size:0.85rem; }
    .admin-table th { color:var(--muted); font-weight:700; background:rgba(8,12,20,0.6); }
    .btn-action { padding:0.3rem 0.6rem; border-radius:6px; font-weight:700; font-size:0.75rem; cursor:pointer; border:none; margin-right:0.3rem; }
    .btn-acc { background:#34d399; color:#000; }
    .btn-rej { background:#f43f5e; color:#fff; }
    .btn-ban { background:#fbbf24; color:#000; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div style="display:flex;align-items:center;gap:1rem;">
        <div class="logo">🎲</div>
        <div><h1 style="font-size:1.6rem;font-weight:800;">Analytics Center</h1><p style="font-size:0.85rem;color:var(--muted);">Control & User Management Panel</p></div>
      </div>
      <div style="display:flex;align-items:center;gap:1rem;">
        <div class="${isAdmin ? 'user-badge-admin' : 'user-badge-user'}">
          👤 ${currentUser} ${isAdmin ? '[ADMIN]' : '[USER]'}
        </div>
        ${isAdmin ? '<button class="btn btn-danger" onclick="confirmReset()">🗑️ /reset</button>' : ''}
        <button class="btn" onclick="logout()">🚪 Logout</button>
      </div>
    </header>

    <div class="nav-tabs">
      <button class="nav-btn active" onclick="switchTab('analytics')">📊 Analytics Dashboard</button>
      ${isAdmin ? '<button class="nav-btn" onclick="switchTab(\'userAdmin\')">⚙️ Pengaturan & Manajemen User</button>' : ''}
    </div>

    <!-- TAB 1: ANALYTICS DASHBOARD -->
    <div id="analyticsTab">
      <div class="webhook-card">
        <div style="font-weight:700;font-size:0.9rem;color:var(--muted);">WEBHOOK GATEWAY URL:</div>
        <div class="wh-box" id="whUrlValue">${webhookUrl}</div>
        <button class="btn-copy" onclick="copyWebhookLink()">Salin Webhook URL</button>
      </div>

      <div class="settings-panel">
        <div style="display:flex;align-items:center;gap:0.8rem;">
          <span style="font-size:0.85rem;font-weight:700;color:var(--muted);">ANALYSIS SYSTEM:</span>
          <label class="switch"><input type="checkbox" ${isAnalyticsOn ? 'checked' : ''} ${isAdmin ? 'onchange="toggleSystemAnalytics(this)"' : 'disabled'}><span class="slider"></span></label>
        </div>
        <div style="display:flex;align-items:center;gap:0.8rem;">
          <span style="font-size:0.85rem;font-weight:700;color:var(--muted);">LAMA ONLINE SYSTEM:</span>
          <span style="font-family:'JetBrains Mono';font-weight:800;color:var(--green);background:rgba(52,211,153,0.1);padding:0.3rem 0.6rem;border-radius:6px;border:1px solid rgba(52,211,153,0.3);">${systemUptimeText}</span>
        </div>
        <div style="display:flex;align-items:center;gap:0.8rem;">
          <span style="font-size:0.85rem;font-weight:700;color:var(--muted);">OFFLINE THRESHOLD:</span>
          <select style="background:rgba(18,26,43,0.8);border:1px solid var(--card-border);color:#fff;padding:0.4rem;border-radius:8px;" ${isAdmin ? 'onchange="updateOfflineThreshold(this.value)"' : 'disabled'}>
            <option value="10" ${offlineMinConfig === '10' ? 'selected' : ''}>10 Menit</option>
            <option value="15" ${offlineMinConfig === '15' ? 'selected' : ''}>15 Menit</option>
            <option value="20" ${offlineMinConfig === '20' ? 'selected' : ''}>20 Menit</option>
            <option value="30" ${offlineMinConfig === '30' ? 'selected' : ''}>30 Menit</option>
          </select>
        </div>
      </div>

      <div class="metrics-panel">
        <div class="metric-box"><div style="font-size:0.75rem;font-weight:700;color:var(--muted);">WEBHOOK LATENCY</div><div style="font-size:1.3rem;font-weight:800;color:var(--green);margin:0.4rem 0;">${realTimeMs} ms</div></div>
        <div class="metric-box"><div style="font-size:0.75rem;font-weight:700;color:var(--muted);">COMMANDS</div><div style="font-size:1.3rem;font-weight:800;margin:0.4rem 0;">${globalCommands > 1000 ? (globalCommands/1000).toFixed(1) + ' rb' : globalCommands}</div></div>
        <div class="metric-box"><div style="font-size:0.75rem;font-weight:700;color:var(--muted);">BANDWIDTH</div><div style="font-size:1.3rem;font-weight:800;margin:0.4rem 0;">${(globalBytes / 1024).toFixed(0)} KB</div></div>
        <div class="metric-box"><div style="font-size:0.75rem;font-weight:700;color:var(--muted);">STORAGE</div><div style="font-size:1.3rem;font-weight:800;margin:0.4rem 0;">${globalBytes} B</div></div>
        <div class="metric-box"><div style="font-size:0.75rem;font-weight:700;color:var(--muted);">COST</div><div style="font-size:1.3rem;font-weight:800;margin:0.4rem 0;">$0.00</div></div>
      </div>

      <div class="stats-grid">
        <div class="stat-card"><div style="font-size:0.8rem;color:var(--muted);">Akun Aktif</div><div style="font-size:2rem;font-weight:800;">${users.length}</div></div>
        <div class="stat-card"><div style="font-size:0.8rem;color:var(--muted);">Total Gems Database</div><div style="font-size:2rem;font-weight:800;color:var(--cyan);">x${totalGemsGlobal.toLocaleString('id-ID')}</div></div>
        <div class="stat-card"><div style="font-size:0.8rem;color:var(--muted);">Total Trait Reroll</div><div style="font-size:2rem;font-weight:800;color:var(--purple);">x${totalTraitGlobal.toLocaleString('id-ID')}</div></div>
        <div class="stat-card"><div style="font-size:0.8rem;color:var(--muted);">Total Unit Diterima</div><div style="font-size:2rem;font-weight:800;">${totalUnitsGlobal}</div></div>
      </div>

      <div class="charts-grid">
        <div class="chart-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;font-weight:700;">
            <span>⚡ Live Webhook Latency (ms)</span>
            <span style="color:var(--green);font-size:0.8rem;">${realTimeMs} ms</span>
          </div>
          <canvas id="latencyChart" height="120"></canvas>
        </div>
        <div class="chart-card">
          <div style="margin-bottom:1rem;font-weight:700;">🎯 Distribusi Gems Per Akun</div>
          <canvas id="doughnutChart" height="220"></canvas>
        </div>
      </div>

      <div class="cards-wrapper">
        ${accountsData.map(acc => {
          const itemKeys = Object.keys(acc.potionsObj);
          return `
            <div class="acc-card">
              <div class="acc-header">
                <div style="font-size:1.1rem;font-weight:800;color:var(--cyan);">👤 ${acc.user}</div>
                <div style="display:flex;align-items:center;gap:0.5rem;">
                  <div class="status-pill ${acc.isOnline ? 'st-online' : 'st-offline'}">${acc.isOnline ? '● ONLINE' : '○ OFFLINE'}</div>
                  ${isAdmin ? `<button style="background:none;border:none;cursor:pointer;color:var(--red);" onclick="deleteAccountData('${acc.user}')">🗑️</button>` : ''}
                </div>
              </div>
              <div class="acc-metrics">
                <div><span style="color:var(--muted);font-size:0.75rem;">Total Gems</span><b style="color:var(--cyan);">x${acc.totalGems.toLocaleString('id-ID')}</b></div>
                <div><span style="color:var(--muted);font-size:0.75rem;">Total Trait</span><b style="color:var(--purple);">x${acc.totalTrait.toLocaleString('id-ID')}</b></div>
                <div><span style="color:var(--muted);font-size:0.75rem;">Gems/Jam</span><b>~${acc.gemsPerHour.toLocaleString('id-ID')}</b></div>
                <div><span style="color:var(--muted);font-size:0.75rem;">Trait/Jam</span><b>~${acc.traitPerHour.toLocaleString('id-ID')}</b></div>
              </div>
              <div class="list-box">
                <div class="list-title">Units Diterima (${acc.unitsReceived.length})</div>
                <div class="list-content">${acc.unitsReceived.length > 0 ? acc.unitsReceived.map(u => `<div>• ${u}</div>`).join('') : '<div style="color:var(--muted);">Belum ada unit</div>'}</div>
              </div>
              <div class="list-box">
                <div class="list-title">Tower Selesai / Floor Dicapai (${acc.towerList.length})</div>
                <div class="list-content">${acc.towerList.length > 0 ? acc.towerList.map(t => `<div>🏆 ${t}</div>`).join('') : '<div style="color:var(--muted);">Belum ada tower/floor selesai</div>'}</div>
              </div>
              <div class="list-box">
                <div class="list-title">Item & Potions</div>
                <div class="list-content">${itemKeys.length > 0 ? itemKeys.map(k => `<div>• ${k}: x${acc.potionsObj[k]}</div>`).join('') : '<div style="color:var(--muted);">Belum ada item</div>'}</div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- TAB 2: MANAJEMEN USER ADMIN -->
    ${isAdmin ? `
    <div id="userAdminTab" style="display:none;">
      <div class="acc-card" style="margin-bottom:1.5rem;">
        <h3 style="margin-bottom:1rem;">🔑 Root Admin (Vercel Env)</h3>
        <p style="color:var(--muted);font-size:0.9rem;">Username: <b style="color:var(--cyan);">${CONFIG.DASHBOARD_USER}</b></p>
      </div>

      <div class="acc-card">
        <h3 style="margin-bottom:1rem;">👥 Pengelolaan & Persetujuan Pengguna</h3>
        <table class="admin-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th>Spesifik HP / Perangkat Login</th>
              <th>Aksi Pengelolaan</th>
            </tr>
          </thead>
          <tbody>
            ${allRegisteredUsers.length > 0 ? allRegisteredUsers.map(u => `
              <tr>
                <td><b>${u.username}</b></td>
                <td>
                  <select onchange="changeUserRole('${u.username}', this.value)" style="background:rgba(8,12,20,0.8);color:#fff;border:1px solid var(--card-border);padding:0.2rem;border-radius:4px;">
                    <option value="user" ${u.role === 'user' ? 'selected' : ''}>User</option>
                    <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                  </select>
                </td>
                <td>
                  <span class="status-pill ${u.status === 'approved' ? 'st-online' : 'st-offline'}">
                    ${u.status.toUpperCase()}
                  </span>
                </td>
                <td style="font-family:'JetBrains Mono';color:var(--cyan);">${u.deviceInfo || 'Belum Ada Data'}</td>
                <td>
                  ${u.status === 'pending' ? `
                    <button class="btn-action btn-acc" onclick="approveUser('${u.username}', true)">ACC / Setujui</button>
                    <button class="btn-action btn-rej" onclick="approveUser('${u.username}', false)">Tolak</button>
                  ` : `
                    <button class="btn-action btn-ban" onclick="toggleBanUser('${u.username}')">
                      ${u.status === 'banned' ? 'Unban' : 'Banned'}
                    </button>
                  `}
                </td>
              </tr>
            `).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--muted);">Belum ada pengguna terdaftar.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    ` : ''}

  </div>

  <script>
    function switchTab(tab) {
      document.getElementById('analyticsTab').style.display = tab === 'analytics' ? 'block' : 'none';
      if (document.getElementById('userAdminTab')) {
        document.getElementById('userAdminTab').style.display = tab === 'userAdmin' ? 'block' : 'none';
      }
      document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
      event.target.classList.add('active');
    }

    function copyWebhookLink(){navigator.clipboard.writeText(document.getElementById('whUrlValue').innerText);alert('✅ Webhook URL disalin!');}
    async function toggleSystemAnalytics(el){await fetch('/api/system',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:el.checked})});}
    async function updateOfflineThreshold(v){await fetch('/api/dashboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'setOfflineThreshold',offlineMin:v})});alert('✅ Threshold diubah!');}
    async function deleteAccountData(u){if(confirm('Hapus akun '+u+'?')){await fetch('/api/dashboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'deleteKey',key:'stats:'+u})});location.reload();}}
    
    async function logout(){
      const res = await fetch('/api/dashboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout'})});
      const data = await res.json();
      if(data.redirect) window.location.href = data.redirect;
    }

    async function confirmReset(){if(confirm('⚠️ Reset database statistik akun?')){await fetch('/api/dashboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reset'})});location.reload();}}

    async function approveUser(user, approve) {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ action: 'approveUser', targetUser: user, approve })
      });
      const data = await res.json();
      alert(data.message);
      location.reload();
    }

    async function changeUserRole(user, newRole) {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ action: 'changeRole', targetUser: user, newRole })
      });
      const data = await res.json();
      alert(data.message);
      location.reload();
    }

    async function toggleBanUser(user) {
      if (confirm('Ubah status banned untuk ' + user + '?')) {
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ action: 'toggleBan', targetUser: user })
        });
        const data = await res.json();
        alert(data.message);
        location.reload();
      }
    }

    const currentMs = ${realTimeMs};
    let history = JSON.parse(localStorage.getItem('lat_hist') || '[]');
    history.push({ time: new Date().toLocaleTimeString('id-ID'), ms: currentMs });
    if (history.length > 12) history.shift();
    localStorage.setItem('lat_hist', JSON.stringify(history));

    new Chart(document.getElementById('latencyChart'), {
      type: 'line',
      data: {
        labels: history.map(h => h.time),
        datasets: [{ data: history.map(h => h.ms), borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.15)', fill: true, tension: 0.4 }]
      },
      options: { animation: { duration: 1000 }, plugins: { legend: { display: false } } }
    });

    const rawData = ${JSON.stringify(accountsData)};
    new Chart(document.getElementById('doughnutChart'), {
      type: 'doughnut',
      data: { labels: rawData.map(d => d.user), datasets: [{ data: rawData.map(d => d.totalGems), backgroundColor: ['#38bdf8','#c084fc','#34d399','#f43f5e','#fbbf24'] }] },
      options: { plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8' } } } }
    });
  </script>
</body>
</html>
  `);
};
