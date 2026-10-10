const CONFIG = {
  REDIS_URL: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  REDIS_TOKEN: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
};

async function redisCmd(command, ...args) {
  if (!CONFIG.REDIS_URL || !CONFIG.REDIS_TOKEN) return null;
  try {
    const res = await fetch(`${CONFIG.REDIS_URL}/${command}/${args.map(encodeURIComponent).join('/')}`, {
      headers: { Authorization: `Bearer ${CONFIG.REDIS_TOKEN}` }
    });
    const data = await res.json();
    return data.result;
  } catch (e) {
    return null;
  }
}

module.exports = async (req, res) => {
  const users = (await redisCmd('smembers', 'stats:users')) || [];
  const accountsData = [];

  let grandTotalGems = 0;
  let grandTotalTrait = 0;
  let totalLaporanSemua = 0;

  const now = Date.now();

  for (const user of users) {
    const prefix = `stats:${user}`;
    const totalLaporan = parseInt((await redisCmd('get', `${prefix}:totalLaporan`)) || 0, 10);
    const totalGems = parseInt((await redisCmd('get', `${prefix}:totalGems`)) || 0, 10);
    const totalTrait = parseInt((await redisCmd('get', `${prefix}:totalTraitReroll`)) || 0, 10);
    const startTime = parseInt((await redisCmd('get', `${prefix}:startTime`)) || now, 10);

    const durationHours = Math.max((now - startTime) / (1000 * 60 * 60), 0.01);
    const gemsPerHour = Math.round(totalGems / durationHours);
    const traitPerHour = Math.round(totalTrait / durationHours);

    grandTotalGems += totalGems;
    grandTotalTrait += totalTrait;
    totalLaporanSemua += totalLaporan;

    accountsData.push({
      user,
      totalLaporan,
      totalGems,
      totalTrait,
      gemsPerHour,
      traitPerHour
    });
  }

  const html = `
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Roblox Webhook Command Center & Tester</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-dark: #080c14;
      --card-bg: rgba(22, 30, 46, 0.7);
      --card-border: rgba(255, 255, 255, 0.08);
      --accent-blue: #38bdf8;
      --accent-purple: #c084fc;
      --accent-green: #34d399;
      --accent-red: #f43f5e;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Plus Jakarta Sans', sans-serif; }
    body { background-color: var(--bg-dark); color: var(--text-main); min-height: 100vh; padding: 2rem 1.5rem; }
    .container { max-width: 1300px; margin: 0 auto; }

    .nav-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; flex-wrap: wrap; gap: 1rem; }
    .brand-title { display: flex; align-items: center; gap: 0.75rem; }
    .brand-logo { width: 42px; height: 42px; background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple)); border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; font-weight: 800; color: #fff; box-shadow: 0 0 20px rgba(56, 189, 248, 0.4); }
    .brand-text h1 { font-size: 1.5rem; font-weight: 800; letter-spacing: -0.02em; background: linear-gradient(135deg, #fff, var(--text-muted)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .brand-text p { font-size: 0.8rem; color: var(--text-muted); }

    .header-controls { display: flex; align-items: center; gap: 1rem; }
    .btn-refresh { background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-main); padding: 0.6rem 1.2rem; border-radius: 10px; font-weight: 600; font-size: 0.85rem; cursor: pointer; transition: all 0.2s; backdrop-filter: blur(10px); }
    .btn-refresh:hover { border-color: var(--accent-blue); color: var(--accent-blue); transform: translateY(-1px); }
    .status-badge { display: flex; align-items: center; gap: 0.5rem; background: rgba(52, 211, 153, 0.1); border: 1px solid rgba(52, 211, 153, 0.2); color: var(--accent-green); padding: 0.5rem 1rem; border-radius: 9999px; font-size: 0.8rem; font-weight: 700; }
    .pulse-dot { width: 8px; height: 8px; background: var(--accent-green); border-radius: 50%; box-shadow: 0 0 10px var(--accent-green); animation: pulse 1.5s infinite; }
    @keyframes pulse { 0% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(1.2); } 100% { opacity: 1; transform: scale(1); } }

    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1.25rem; margin-bottom: 2rem; }
    .stat-card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 16px; padding: 1.5rem; backdrop-filter: blur(12px); position: relative; overflow: hidden; transition: all 0.3s ease; }
    .stat-card:hover { border-color: rgba(56, 189, 248, 0.3); transform: translateY(-2px); }
    .stat-label { font-size: 0.8rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-value { font-size: 2rem; font-weight: 800; margin-top: 0.5rem; letter-spacing: -0.02em; }
    .val-gems { color: var(--accent-blue); text-shadow: 0 0 20px rgba(56, 189, 248, 0.3); }
    .val-trait { color: var(--accent-purple); text-shadow: 0 0 20px rgba(192, 132, 252, 0.3); }

    .tester-card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 16px; padding: 1.5rem; backdrop-filter: blur(12px); margin-bottom: 2rem; }
    .tester-title { font-size: 1.1rem; font-weight: 700; margin-bottom: 1rem; color: var(--accent-blue); display: flex; align-items: center; gap: 0.5rem; }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem; }
    .form-group { display: flex; flex-direction: column; gap: 0.4rem; }
    .form-group label { font-size: 0.8rem; color: var(--text-muted); font-weight: 600; }
    .input-field, .select-field, .textarea-field { background: rgba(15, 23, 42, 0.6); border: 1px solid var(--card-border); color: var(--text-main); padding: 0.6rem 0.8rem; border-radius: 8px; font-size: 0.85rem; outline: none; transition: border-color 0.2s; }
    .input-field:focus, .select-field:focus, .textarea-field:focus { border-color: var(--accent-blue); }
    .textarea-field { resize: vertical; min-height: 80px; font-family: monospace; }
    .btn-send { background: linear-gradient(135deg, var(--accent-blue), #0284c7); color: #fff; border: none; padding: 0.75rem 1.5rem; border-radius: 10px; font-weight: 700; font-size: 0.85rem; cursor: pointer; transition: all 0.2s; }
    .btn-send:hover { opacity: 0.9; transform: translateY(-1px); }
    .log-box { background: rgba(8, 12, 20, 0.9); border: 1px solid var(--card-border); border-radius: 8px; padding: 0.8rem; margin-top: 1rem; font-family: monospace; font-size: 0.8rem; display: none; }

    .charts-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 1.25rem; margin-bottom: 2rem; }
    .chart-card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 16px; padding: 1.5rem; backdrop-filter: blur(12px); }
    .chart-title { font-size: 1rem; font-weight: 700; color: var(--text-main); margin-bottom: 1.25rem; }

    .table-card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 16px; padding: 1.5rem; backdrop-filter: blur(12px); overflow: hidden; }
    .table-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 1rem; }
    .search-input { background: rgba(15, 23, 42, 0.6); border: 1px solid var(--card-border); color: var(--text-main); padding: 0.6rem 1rem; border-radius: 10px; font-size: 0.85rem; outline: none; width: 250px; }

    .table-wrapper { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem; }
    th { padding: 1rem; color: var(--text-muted); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; border-bottom: 1px solid var(--card-border); }
    td { padding: 1.1rem 1rem; border-bottom: 1px solid rgba(255, 255, 255, 0.03); color: var(--text-main); }
    
    @media (max-width: 900px) {
      .charts-grid, .form-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    
    <div class="nav-header">
      <div class="brand-title">
        <div class="brand-logo">R</div>
        <div class="brand-text">
          <h1>Command Center</h1>
          <p>Real-Time Roblox Farming Analytics & Webhook Tester</p>
        </div>
      </div>
      <div class="header-controls">
        <button class="btn-refresh" onclick="window.location.reload()">🔄 Refresh Data</button>
        <div class="status-badge">
          <div class="pulse-dot"></div> LIVE MONITORING
        </div>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Akun Terhubung</div>
        <div class="stat-value">${users.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Laporan Sesi</div>
        <div class="stat-value">${totalLaporanSemua.toLocaleString('id-ID')}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Gems</div>
        <div class="stat-value val-gems">x${grandTotalGems.toLocaleString('id-ID')}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Trait Reroll</div>
        <div class="stat-value val-trait">x${grandTotalTrait.toLocaleString('id-ID')}</div>
      </div>
    </div>

    <div class="tester-card">
      <div class="tester-title">🧪 Live Webhook Tester Console</div>
      <div class="form-grid">
        <div class="form-group">
          <label>Username Test</label>
          <input type="text" id="testUser" class="input-field" value="TestAccount_01">
        </div>
        <div class="form-group">
          <label>Tipe Event Webhook</label>
          <select id="testType" class="select-field" onchange="updatePresetPayload()">
            <option value="normal">Normal Report (Gems & Items)</option>
            <option value="unit">New Unit Drop</option>
            <option value="tower">Tower Completed</option>
            <option value="error">Error Log Alert</option>
          </select>
        </div>
      </div>
      <div class="form-group" style="margin-bottom: 1rem;">
        <label>Payload Content (Teks Simulasi Webhook)</label>
        <textarea id="testContent" class="textarea-field">Tower Completed!
Gems: x150
Trait Reroll: x10
Shadow Income I: x2</textarea>
      </div>
      <button class="btn-send" onclick="sendTestWebhook()">🚀 Kirim Payload Simulasi</button>
      <div id="logBox" class="log-box"></div>
    </div>

    <div class="charts-grid">
      <div class="chart-card">
        <div class="chart-title">📊 Hasil Farming Per Akun</div>
        <canvas id="barChart" height="110"></canvas>
      </div>
      <div class="chart-card">
        <div class="chart-title">🎯 Distribusi Gems</div>
        <canvas id="doughnutChart" height="220"></canvas>
      </div>
    </div>

    <div class="table-card">
      <div class="table-header">
        <h3 style="font-size: 1.1rem; font-weight: 700;">📋 Rincian Performa Akun</h3>
        <input type="text" id="searchInput" class="search-input" placeholder="Cari username..." onkeyup="filterTable()">
      </div>
      <div class="table-wrapper">
        <table id="accountsTable">
          <thead>
            <tr>
              <th>Status</th>
              <th>Username</th>
              <th>Total Laporan</th>
              <th>Total Gems</th>
              <th>Total Trait</th>
              <th>Rate Gems/Jam</th>
              <th>Rate Trait/Jam</th>
            </tr>
          </thead>
          <tbody>
            ${accountsData.length > 0 ? accountsData.map(acc => `
              <tr>
                <td><span style="color: var(--accent-green); font-weight: 700;">● Active</span></td>
                <td style="font-weight: 700; color: var(--accent-blue);">👤 ${acc.user}</td>
                <td>${acc.totalLaporan} log</td>
                <td style="font-weight: 700; color: var(--accent-blue);">x${acc.totalGems.toLocaleString('id-ID')}</td>
                <td style="font-weight: 700; color: var(--accent-purple);">x${acc.totalTrait.toLocaleString('id-ID')}</td>
                <td>~${acc.gemsPerHour.toLocaleString('id-ID')} / jam</td>
                <td>~${acc.traitPerHour.toLocaleString('id-ID')} / jam</td>
              </tr>
            `).join('') : `
              <tr>
                <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 2rem;">Belum ada data statistik tersedia.</td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    </div>

  </div>

  <script>
    setTimeout(() => { window.location.reload(); }, 30000);

    function updatePresetPayload() {
      const type = document.getElementById('testType').value;
      const content = document.getElementById('testContent');

      if (type === 'normal') {
        content.value = "Tower Completed!\nGems: x150\nTrait Reroll: x10\nShadow Income I: x2";
      } else if (type === 'unit') {
        content.value = "New Unit!\nName: Gold Huge Friza\nMutation: Gold\nRarity: Secret";
      } else if (type === 'tower') {
        content.value = "Tower Completed!\nGems: x500\nTrait Reroll: x25";
      } else if (type === 'error') {
        content.value = "Script disconnected from server!";
      }
    }

    async function sendTestWebhook() {
      const user = document.getElementById('testUser').value || 'TestAccount_01';
      const type = document.getElementById('testType').value;
      const contentText = document.getElementById('testContent').value;
      const logBox = document.getElementById('logBox');

      logBox.style.display = 'block';
      logBox.style.color = '#38bdf8';
      logBox.innerText = 'Mengirim payload simulasi...';

      // Payload disesuaikan penuh dengan skema Discord Embed yang dibaca api/webhook.js
      const payload = {
        username: user,
        event_type: type === 'error' ? 'error' : 'normal',
        embeds: [
          {
            title: type === 'unit' ? 'New Unit!' : 'Webhook Report',
            description: "Username: ||" + user + "||\n" + contentText
          }
        ]
      };

      try {
        const targetUrl = window.location.origin + '/api/webhook';
        const response = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok && data.success) {
          logBox.style.color = '#34d399';
          logBox.innerText = '✅ BERHASIL [HTTP ' + response.status + ']: ' + JSON.stringify(data) + '\nRefreshing dashboard dalam 1.5 detik...';
          setTimeout(() => { window.location.reload(); }, 1500);
        } else {
          logBox.style.color = '#f43f5e';
          logBox.innerText = '❌ GAGAL [HTTP ' + response.status + ']: ' + JSON.stringify(data);
        }
      } catch (err) {
        logBox.style.color = '#f43f5e';
        logBox.innerText = '❌ ERROR REQUEST: ' + err.message;
      }
    }

    function filterTable() {
      const input = document.getElementById('searchInput').value.toLowerCase();
      const rows = document.querySelectorAll('#accountsTable tbody tr');
      rows.forEach(row => {
        const username = row.cells[1] ? row.cells[1].innerText.toLowerCase() : '';
        row.style.display = username.includes(input) ? '' : 'none';
      });
    }

    const rawData = ${JSON.stringify(accountsData)};
    const labels = rawData.map(d => d.user);
    const gemsData = rawData.map(d => d.totalGems);
    const traitData = rawData.map(d => d.totalTrait);

    const ctxBar = document.getElementById('barChart').getContext('2d');
    new Chart(ctxBar, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: 'Gems', data: gemsData, backgroundColor: '#38bdf8', borderRadius: 8 },
          { label: 'Trait Reroll', data: traitData, backgroundColor: '#c084fc', borderRadius: 8 }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', weight: '600' } } } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#94a3b8' } },
          y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#94a3b8' } }
        }
      }
    });

    const ctxDoughnut = document.getElementById('doughnutChart').getContext('2d');
    new Chart(ctxDoughnut, {
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
        plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans' } } } }
      }
    });
  </script>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html);
};
