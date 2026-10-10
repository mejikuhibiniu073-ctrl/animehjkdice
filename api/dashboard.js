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

  for (const user of users) {
    const prefix = `stats:${user}`;
    const totalLaporan = parseInt((await redisCmd('get', `${prefix}:totalLaporan`)) || 0, 10);
    const totalGems = parseInt((await redisCmd('get', `${prefix}:totalGems`)) || 0, 10);
    const totalTrait = parseInt((await redisCmd('get', `${prefix}:totalTraitReroll`)) || 0, 10);
    const startTime = parseInt((await redisCmd('get', `${prefix}:startTime`)) || Date.now(), 10);

    const durationHours = Math.max((Date.now() - startTime) / (1000 * 60 * 60), 0.01);
    const gemsPerHour = Math.round(totalGems / durationHours);
    const traitPerHour = Math.round(totalTrait / durationHours);

    grandTotalGems += totalGems;
    grandTotalTrait += totalTrait;

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
  <title>Roblox Farm Monitoring Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Plus Jakarta Sans', sans-serif; }
    body { background-color: #0b0f19; color: #f1f5f9; min-height: 100vh; padding: 2rem 1rem; }
    .container { max-width: 1200px; margin: 0 auto; }

    /* Header */
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; flex-wrap: wrap; gap: 1rem; }
    .header h1 { font-size: 1.8rem; font-weight: 800; background: linear-gradient(135deg, #38bdf8, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .badge-live { display: inline-flex; align-items: center; gap: 0.5rem; background: rgba(16, 185, 129, 0.1); color: #10b981; padding: 0.4rem 0.8rem; border-radius: 9999px; border: 1px solid rgba(16, 185, 129, 0.2); font-size: 0.85rem; font-weight: 600; }
    .pulse { width: 8px; height: 8px; background: #10b981; border-radius: 50%; animation: pulse-animation 1.5s infinite; }
    @keyframes pulse-animation { 0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); } 70% { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); } 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); } }

    /* Cards Grid */
    .grid-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1.25rem; margin-bottom: 2rem; }
    .card-stat { background: #161e2e; border: 1px solid #243044; border-radius: 1rem; padding: 1.25rem; backdrop-filter: blur(8px); transition: transform 0.2s ease, border-color 0.2s ease; }
    .card-stat:hover { transform: translateY(-3px); border-color: #38bdf8; }
    .card-stat .title { color: #94a3b8; font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    .card-stat .value { font-size: 1.8rem; font-weight: 800; margin-top: 0.5rem; color: #f8fafc; }
    .card-stat .subtext { font-size: 0.8rem; color: #64748b; margin-top: 0.25rem; }

    /* Chart Section */
    .chart-container { background: #161e2e; border: 1px solid #243044; border-radius: 1rem; padding: 1.5rem; margin-bottom: 2rem; }
    .chart-header { margin-bottom: 1rem; font-size: 1.1rem; font-weight: 700; color: #cbd5e1; }

    /* Table Section */
    .table-container { background: #161e2e; border: 1px solid #243044; border-radius: 1rem; overflow: hidden; }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem; }
    th { background: #1e293b; color: #94a3b8; font-weight: 600; padding: 1rem; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.05em; }
    td { padding: 1rem; border-top: 1px solid #243044; color: #e2e8f0; }
    tr:hover { background: rgba(51, 65, 85, 0.3); }
    .user-pill { font-weight: 700; color: #38bdf8; }
    .highlight-gems { color: #38bdf8; font-weight: 700; }
    .highlight-trait { color: #a855f7; font-weight: 700; }

    @media (max-width: 768px) {
      .table-container { overflow-x: auto; }
    }
  </style>
</head>
<body>
  <div class="container">
    
    <!-- Top Header -->
    <div class="header">
      <div>
        <h1>Roblox Webhook Analytics</h1>
        <p style="color: #64748b; font-size: 0.9rem; margin-top: 0.2rem;">Live Monitoring & Statistics Dashboard</p>
      </div>
      <div class="badge-live">
        <div class="pulse"></div> Live Auto-Refresh
      </div>
    </div>

    <!-- Stat Cards -->
    <div class="grid-cards">
      <div class="card-stat">
        <div class="title">Total Akun Aktif</div>
        <div class="value">${users.length}</div>
        <div class="subtext">Sesi aktif 5 jam terakhir</div>
      </div>
      <div class="card-stat">
        <div class="title">Total Gems Terkumpul</div>
        <div class="value highlight-gems">x${grandTotalGems.toLocaleString('id-ID')}</div>
        <div class="subtext">Akumulasi seluruh akun</div>
      </div>
      <div class="card-stat">
        <div class="title">Total Trait Reroll</div>
        <div class="value highlight-trait">x${grandTotalTrait.toLocaleString('id-ID')}</div>
        <div class="subtext">Akumulasi seluruh akun</div>
      </div>
    </div>

    <!-- Visual Chart -->
    <div class="chart-container">
      <div class="chart-header">📊 Perbandingan Hasil Farming Per Akun</div>
      <canvas id="farmChart" height="100"></canvas>
    </div>

    <!-- Data Table -->
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Username</th>
            <th>Laporan</th>
            <th>Total Gems</th>
            <th>Total Trait</th>
            <th>Rate Gems/Jam</th>
            <th>Rate Trait/Jam</th>
          </tr>
        </thead>
        <tbody>
          ${accountsData.length > 0 ? accountsData.map(acc => `
            <tr>
              <td class="user-pill">👤 ${acc.user}</td>
              <td>${acc.totalLaporan} Laporan</td>
              <td class="highlight-gems">x${acc.totalGems.toLocaleString('id-ID')}</td>
              <td class="highlight-trait">x${acc.totalTrait.toLocaleString('id-ID')}</td>
              <td>~${acc.gemsPerHour.toLocaleString('id-ID')} / jam</td>
              <td>~${acc.traitPerHour.toLocaleString('id-ID')} / jam</td>
            </tr>
          `).join('') : `
            <tr>
              <td colspan="6" style="text-align: center; color: #64748b; padding: 2rem;">Belum ada data statistik masuk.</td>
            </tr>
          `}
        </tbody>
      </table>
    </div>

  </div>

  <script>
    // Auto Refresh setiap 30 detik
    setTimeout(() => {
      window.location.reload();
    }, 30000);

    // Chart Configuration
    const rawData = ${JSON.stringify(accountsData)};
    const labels = rawData.map(d => d.user);
    const gemsData = rawData.map(d => d.totalGems);
    const traitData = rawData.map(d => d.totalTrait);

    const ctx = document.getElementById('farmChart').getContext('2d');

    const gradientGems = ctx.createLinearGradient(0, 0, 0, 300);
    gradientGems.addColorStop(0, '#38bdf8');
    gradientGems.addColorStop(1, '#0284c7');

    const gradientTrait = ctx.createLinearGradient(0, 0, 0, 300);
    gradientTrait.addColorStop(0, '#a855f7');
    gradientTrait.addColorStop(1, '#7e22ce');

    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Total Gems',
            data: gemsData,
            backgroundColor: gradientGems,
            borderRadius: 6
          },
          {
            label: 'Total Trait Reroll',
            data: traitData,
            backgroundColor: gradientTrait,
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            labels: { color: '#cbd5e1', font: { family: 'Plus Jakarta Sans', weight: '600' } }
          }
        },
        scales: {
          x: {
            grid: { color: '#1e293b' },
            ticks: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans' } }
          },
          y: {
            grid: { color: '#1e293b' },
            ticks: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans' } }
          }
        }
      }
    });
  </script>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html);
};
