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
  const chartData = [];

  for (const user of users) {
    const prefix = `stats:${user}`;
    const totalGems = parseInt((await redisCmd('get', `${prefix}:totalGems`)) || 0, 10);
    const totalTrait = parseInt((await redisCmd('get', `${prefix}:totalTraitReroll`)) || 0, 10);
    chartData.push({ user, totalGems, totalTrait });
  }

  const html = `
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Roblox Farm Web Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 20px; }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { text-align: center; color: #38bdf8; }
    .card { background: #1e293b; border-radius: 12px; padding: 20px; margin-top: 20px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 Roblox Analytics Dashboard</h1>
    <div class="card">
      <canvas id="farmChart"></canvas>
    </div>
  </div>
  <script>
    const rawData = ${JSON.stringify(chartData)};
    const labels = rawData.map(d => d.user);
    const gemsData = rawData.map(d => d.totalGems);
    const traitData = rawData.map(d => d.totalTrait);

    const ctx = document.getElementById('farmChart').getContext('2d');
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: 'Total Gems', data: gemsData, backgroundColor: '#38bdf8' },
          { label: 'Total Trait Reroll', data: traitData, backgroundColor: '#a855f7' }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#f8fafc' } } },
        scales: {
          x: { ticks: { color: '#94a3b8' } },
          y: { ticks: { color: '#94a3b8' } }
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
