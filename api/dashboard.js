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

function formatUptime(ms) {
  if (!ms || ms <= 0) return '0j 0m';
  const sec = Math.floor(ms / 1000);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  return days > 0 ? `${days}h ${hours}j ${minutes}m` : `${hours}j ${minutes}m`;
}

module.exports = async (req, res) => {
  try {
    const cookies = parseCookies(req);

    if (cookies.auth !== 'true') {
      res.writeHead(302, { Location: '/api/login' });
      return res.end();
    }

    const body = req.body || {};

    if (req.method === 'POST' && body.action === 'logout') {
      res.setHeader('Set-Cookie', [
        'auth=; Path=/; HttpOnly; Max-Age=0',
        'auth_user=; Path=/; HttpOnly; Max-Age=0',
        'auth_role=; Path=/; HttpOnly; Max-Age=0'
      ]);
      return res.status(200).json({ success: true, redirect: '/api/login' });
    }

    // RESET DB: Hapus data statistik & reset tracker persisten ke 0
    if (req.method === 'POST' && body.action === 'reset') {
      const usersRes = await redisCmd('smembers', 'stats:users');
      const users = usersRes.result || [];

      if (Array.isArray(users) && users.length > 0) {
        for (const u of users) {
          const keys = [
            `stats:${u}:totalLaporan`,
            `stats:${u}:unitMasukTas`,
            `stats:${u}:towerSelesai`,
            `stats:${u}:totalGems`,
            `stats:${u}:totalTraitReroll`,
            `stats:${u}:startTime`,
            `stats:${u}:lastSeen`,
            `stats:${u}:unitsReceived`,
            `stats:${u}:towerList`,
            `stats:${u}:potions`
          ];

          for (const k of keys) {
            await redisCmd('del', k);
          }
        }
      }

      await redisCmd('del', 'stats:users');
      await redisCmd('set', 'global:total_commands', '0');
      await redisCmd('set', 'global:total_bytes', '0');

      return res.status(200).json({ 
        success: true, 
        message: 'Seluruh statistik akun dan storage tracker berhasil dibersihkan!' 
      });
    }

    if (req.method === 'POST' && body.action === 'deleteKey' && body.key) {
      await redisCmd('del', body.key);
      if (body.key.startsWith('stats:')) {
        const uName = body.key.replace('stats:', '').split(':')[0];
        await redisCmd('srem', 'stats:users', uName);
      }
      return res.status(200).json({ success: true });
    }

    if (req.method === 'POST' && body.action === 'setOfflineThreshold' && body.offlineMin) {
      await redisCmd('set', 'system:offline_threshold_min', body.offlineMin);
      return res.status(200).json({ success: true });
    }

    const currentUser = decodeURIComponent(cookies.auth_user || 'Admin');
    const currentRole = cookies.auth_role || 'user';
    const isAdmin = currentRole === 'admin' || currentUser === CONFIG.DASHBOARD_USER;

    // AMBIL DATA PERSISTEN REAL-TIME LANGSUNG DARI KEY REDIS
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

    // Nilai presisi dari transaksi webhook
    const globalCommands = parseInt(cmdRes.result || 0, 10);
    const globalBytes = parseInt(bytesRes.result || 0, 10);

    const now = Date.now();
    const systemUptimeText = formatUptime(now - parseInt(startRes.result || now, 10));

    let users = usersRes.result || [];
    if (!Array.isArray(users)) users = users ? [users] : [];
    const realTimeMs = usersRes.latencyMs || 0;

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

    let allRegisteredUsers = [];
    if (isAdmin) {
      const allUsersListRes = await redisCmd('smembers', 'users:all');
      const allUsersList = allUsersListRes.result || [];
      if (Array.isArray(allUsersList)) {
        allRegisteredUsers = await Promise.all(allUsersList.map(async (u) => {
          const raw = await redisCmd('get', `user:${u}`);
          return raw.result ? JSON.parse(raw.result) : null;
        }));
        allRegisteredUsers = allRegisteredUsers.filter(Boolean);
      }
    }

    const hostHeader = req.headers.host || 'animehjkdice.vercel.app';
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const webhookUrl = `${protocol}://${hostHeader}/api/webhook`;

    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(`
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Analytics Control Center</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div class="container">
    <header>
      <div class="title-group">
        <div class="logo">🎲</div>
        <div>
          <h1>Analytics Control Center</h1>
          <p>Real-Time Upstash Redis Database Center</p>
        </div>
      </div>
      <div class="header-right">
        <div class="${isAdmin ? 'user-badge-admin' : 'user-badge-user'}">
          👤 ${currentUser} ${isAdmin ? '[ADMIN]' : '[USER]'}
        </div>
        ${isAdmin ? '<button class="btn btn-danger" onclick="confirmReset()">🗑️ /reset Database</button>' : ''}
        <button class="btn" onclick="logout()">🚪 Logout</button>
      </div>
    </header>

    <div class="nav-tabs">
      <button class="nav-btn active" id="btnTabAnalytics" onclick="switchTab('analytics')">📊 Analytics Dashboard</button>
      ${isAdmin ? '<button class="nav-btn" id="btnTabAdmin" onclick="switchTab(\'userAdmin\')">⚙️ Pengaturan & Manajemen User</button>' : ''}
    </div>

    <div id="analyticsTab">
      <div class="webhook-display-card">
        <div style="font-weight: 700; font-size: 0.9rem; color: var(--text-muted);">WEBHOOK GATEWAY URL:</div>
        <div class="wh-url-box" id="whUrlValue">${webhookUrl}</div>
        <button class="btn-copy" onclick="copyWebhookLink()">Salin Webhook URL</button>
      </div>

      <div class="settings-panel">
        <div class="setting-item">
          <span class="setting-label">ANALYSIS SYSTEM:</span>
          <div class="toggle-container">
            <label class="switch">
              <input type="checkbox" id="analyticsToggle" ${isAnalyticsOn ? 'checked' : ''} ${isAdmin ? 'onchange="toggleSystemAnalytics(this)"' : 'disabled'}>
              <span class="slider"></span>
            </label>
          </div>
        </div>
        <div class="setting-item">
          <span class="setting-label">LAMA ONLINE SYSTEM:</span>
          <span style="font-family: 'JetBrains Mono', monospace; font-weight: 800; color: var(--accent-green); background: rgba(52, 211, 153, 0.1); padding: 0.3rem 0.6rem; border-radius: 6px; border: 1px solid rgba(52, 211, 153, 0.3);">${systemUptimeText}</span>
        </div>
        <div class="setting-item">
          <span class="setting-label">OFFLINE THRESHOLD:</span>
          <select class="setting-select" id="offlineSelect" ${isAdmin ? 'onchange="updateOfflineThreshold(this.value)"' : 'disabled'}>
            <option value="10" ${offlineMinConfig === '10' ? 'selected' : ''}>10 Menit</option>
            <option value="15" ${offlineMinConfig === '15' ? 'selected' : ''}>15 Menit</option>
            <option value="20" ${offlineMinConfig === '20' ? 'selected' : ''}>20 Menit</option>
            <option value="30" ${offlineMinConfig === '30' ? 'selected' : ''}>30 Menit</option>
          </select>
        </div>
      </div>

      <div class="upstash-metrics-panel">
        <div class="up-metric-box">
          <div class="up-label">WEBHOOK LATENCY</div>
          <div class="up-val-row"><div class="up-val" style="color: var(--accent-green);">${realTimeMs} ms</div></div>
          <div class="up-progress-bg"><div class="up-progress-fill" style="width: ${Math.min((realTimeMs/500)*100, 100)}%;"></div></div>
        </div>
        <div class="up-metric-box">
          <div class="up-label">COMMANDS</div>
          <div class="up-val-row"><div class="up-val">${globalCommands > 1000 ? (globalCommands/1000).toFixed(1) + ' rb' : globalCommands}</div><div class="up-sub">/ 500k per month</div></div>
          <div class="up-progress-bg"><div class="up-progress-fill" style="width: ${Math.min((globalCommands/500000)*100, 100)}%;"></div></div>
        </div>
        <div class="up-metric-box">
          <div class="up-label">BANDWIDTH</div>
          <div class="up-val-row"><div class="up-val">${(globalBytes / 1024).toFixed(0)} KB</div><div class="up-sub">/ 10 GB</div></div>
          <div class="up-progress-bg"><div class="up-progress-fill" style="width: ${Math.min(((globalBytes/1024)/(10*1024*1024))*100, 100)}%;"></div></div>
        </div>
        <div class="up-metric-box">
          <div class="up-label">STORAGE</div>
          <div class="up-val-row"><div class="up-val">${globalBytes} B</div><div class="up-sub">/ 256 MB</div></div>
          <div class="up-progress-bg"><div class="up-progress-fill" style="width: ${Math.min((globalBytes/(256*1024*1024))*100, 100)}%;"></div></div>
        </div>
        <div class="up-metric-box">
          <div class="up-label">COST</div>
          <div class="up-val-row"><div class="up-val">$0.00</div></div>
          <div class="up-progress-bg"><div class="up-progress-fill" style="width: 0%;"></div></div>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">Akun Aktif</div><div class="stat-val">${users.length}</div></div>
        <div class="stat-card"><div class="stat-label">Total Gems Database</div><div class="stat-val c-cyan">x${totalGemsGlobal.toLocaleString('id-ID')}</div></div>
        <div class="stat-card"><div class="stat-label">Total Trait Reroll</div><div class="stat-val c-purple">x${totalTraitGlobal.toLocaleString('id-ID')}</div></div>
        <div class="stat-card"><div class="stat-label">Total Unit Diterima</div><div class="stat-val">${totalUnitsGlobal}</div></div>
      </div>

      <div class="charts-grid">
        <div class="chart-card">
          <div class="chart-title"><span>⚡ Live Webhook Latency (ms)</span><span style="font-size: 0.8rem; color: var(--accent-green);">${realTimeMs} ms</span></div>
          <canvas id="latencyChart" height="120"></canvas>
        </div>
        <div class="chart-card">
          <div class="chart-title">🎯 Distribusi Gems Per Akun</div>
          <canvas id="doughnutChart" height="220"></canvas>
        </div>
      </div>

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
                    <div class="status-pill ${acc.isOnline ? 'st-online' : 'st-offline'}">${acc.isOnline ? '● ONLINE' : '○ OFFLINE'}</div>
                    ${isAdmin ? `<button class="btn-delete-acc" onclick="deleteAccountData('${acc.user}')">🗑️</button>` : ''}
                  </div>
                </div>
                <div class="acc-metrics">
                  <div class="metric-item"><span>Total Gems</span><b class="c-cyan">x${acc.totalGems.toLocaleString('id-ID')}</b></div>
                  <div class="metric-item"><span>Total Trait Reroll</span><b class="c-purple">x${acc.totalTrait.toLocaleString('id-ID')}</b></div>
                  <div class="metric-item"><span>Rate Gems/Jam</span><b>~${acc.gemsPerHour.toLocaleString('id-ID')}</b></div>
                  <div class="metric-item"><span>Rate Trait/Jam</span><b>~${acc.traitPerHour.toLocaleString('id-ID')}</b></div>
                </div>
                <div class="list-box">
                  <div class="list-title">Units Diterima (${acc.unitsReceived.length})</div>
                  <div class="list-content">${acc.unitsReceived.length > 0 ? acc.unitsReceived.map(u => `<div>• ${u}</div>`).join('') : '<div style="color: var(--text-muted);">Belum ada unit</div>'}</div>
                </div>
                <div class="list-box">
                  <div class="list-title">Tower Selesai / Floor Dicapai (${acc.towerList.length})</div>
                  <div class="list-content">${acc.towerList.length > 0 ? acc.towerList.map(t => `<div>🏆 ${t}</div>`).join('') : '<div style="color: var(--text-muted);">Belum ada tower/floor selesai</div>'}</div>
                </div>
                <div class="list-box">
                  <div class="list-title">Item & Potions</div>
                  <div class="list-content">${itemKeys.length > 0 ? itemKeys.map(k => `<div>• ${k}: x${acc.potionsObj[k]}</div>`).join('') : '<div style="color: var(--text-muted);">Belum ada item</div>'}</div>
                </div>
              </div>
            `;
          }).join('') : `<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 3rem;">Belum ada data laporan.</div>`}
        </div>
      </div>
    </div>

    ${isAdmin ? `
    <div id="userAdminTab" style="display:none;">
      <div class="acc-card" style="margin-bottom:1.5rem;">
        <h3 style="margin-bottom:0.5rem; color:var(--accent-cyan);">🔑 Root Admin</h3>
        <p style="color:var(--text-muted); font-size:0.9rem;">Pengguna utama: <b style="color:#fff;">${CONFIG.DASHBOARD_USER}</b></p>
      </div>

      <div class="acc-card">
        <h3 style="margin-bottom:1rem;">👥 Pengelolaan & Persetujuan Registrasi Pengguna</h3>
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
                  <select onchange="changeUserRole('${u.username}', this.value)" style="background:rgba(8,12,20,0.8); color:#fff; border:1px solid var(--card-border); padding:0.3rem; border-radius:6px;">
                    <option value="user" ${u.role === 'user' ? 'selected' : ''}>User</option>
                    <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                  </select>
                </td>
                <td>
                  <span class="status-pill ${u.status === 'approved' ? 'st-online' : 'st-offline'}">${u.status.toUpperCase()}</span>
                </td>
                <td style="font-family:'JetBrains Mono', monospace; color:var(--accent-cyan); font-weight:600;">${u.deviceInfo || 'Belum Ada Data Login'}</td>
                <td>
                  ${u.status === 'pending' ? `
                    <button class="btn-action btn-acc" onclick="approveUser('${u.username}', true)">Setujui / ACC</button>
                    <button class="btn-action btn-rej" onclick="approveUser('${u.username}', false)">Tolak</button>
                  ` : `
                    <button class="btn-action btn-ban" onclick="toggleBanUser('${u.username}')">${u.status === 'banned' ? 'Unban' : 'Ban User'}</button>
                  `}
                </td>
              </tr>
            `).join('') : '<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:2rem;">Belum ada akun pengguna terdaftar.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    ` : ''}

  </div>

  <script src="/dashboard.js"></script>
  <script>
    renderCharts(${realTimeMs}, ${JSON.stringify(accountsData)});
  </script>
</body>
</html>
    `);
  } catch (err) {
    return res.status(500).send('Internal Server Error: ' + err.message);
  }
};
