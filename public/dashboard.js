function switchTab(tab) {
  document.getElementById('analyticsTab').style.display = tab === 'analytics' ? 'block' : 'none';
  if (document.getElementById('userAdminTab')) {
    document.getElementById('userAdminTab').style.display = tab === 'userAdmin' ? 'block' : 'none';
  }
  document.getElementById('btnTabAnalytics').classList.toggle('active', tab === 'analytics');
  if (document.getElementById('btnTabAdmin')) {
    document.getElementById('btnTabAdmin').classList.toggle('active', tab === 'userAdmin');
  }
}

function copyWebhookLink() {
  navigator.clipboard.writeText(document.getElementById('whUrlValue').innerText);
  alert('✅ Webhook URL disalin!');
}

async function toggleSystemAnalytics(el) {
  await fetch('/api/system', { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ enabled: el.checked }) 
  });
}

async function updateOfflineThreshold(v) {
  await fetch('/api/dashboard', { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ action: 'setOfflineThreshold', offlineMin: v }) 
  });
  alert('✅ Threshold diubah!');
}

async function deleteAccountData(u) {
  if (confirm('Hapus akun ' + u + '?')) {
    await fetch('/api/dashboard', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ action: 'deleteKey', key: 'stats:' + u }) 
    });
    location.reload();
  }
}

async function logout() {
  const res = await fetch('/api/dashboard', { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ action: 'logout' }) 
  });
  const data = await res.json();
  if (data.redirect) window.location.href = data.redirect;
}

async function confirmReset() {
  if (confirm('⚠️ Reset database statistik & storage tracker?')) {
    await fetch('/api/dashboard', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ action: 'reset' }) 
    });
    location.reload();
  }
}

function filterCards() {
  const q = document.getElementById('searchInput').value.toLowerCase();
  document.querySelectorAll('.acc-card').forEach(card => {
    const u = card.getAttribute('data-user');
    if (u) card.style.display = u.includes(q) ? 'block' : 'none';
  });
}

async function approveUser(user, approve) {
  const res = await fetch('/api/users', { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ action: 'approveUser', targetUser: user, approve }) 
  });
  const data = await res.json();
  alert(data.message);
  location.reload();
}

async function changeUserRole(user, newRole) {
  const res = await fetch('/api/users', { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ action: 'changeRole', targetUser: user, newRole }) 
  });
  const data = await res.json();
  alert(data.message);
  location.reload();
}

async function toggleBanUser(user) {
  if (confirm('Ubah status ' + user + '?')) {
    const res = await fetch('/api/users', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ action: 'toggleBan', targetUser: user }) 
    });
    const data = await res.json();
    alert(data.message);
    location.reload();
  }
}

function renderCharts(realTimeMs, accountsData) {
  let history = JSON.parse(localStorage.getItem('lat_hist') || '[]');
  history.push({ time: new Date().toLocaleTimeString('id-ID'), ms: realTimeMs });
  if (history.length > 12) history.shift();
  localStorage.setItem('lat_hist', JSON.stringify(history));

  new Chart(document.getElementById('latencyChart').getContext('2d'), {
    type: 'line',
    data: { 
      labels: history.map(h => h.time), 
      datasets: [{ data: history.map(h => h.ms), borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.15)', fill: true, tension: 0.4 }] 
    },
    options: { animation: { duration: 1000 }, plugins: { legend: { display: false } } }
  });

  new Chart(document.getElementById('doughnutChart').getContext('2d'), {
    type: 'doughnut',
    data: { 
      labels: accountsData.map(d => d.user), 
      datasets: [{ data: accountsData.map(d => d.totalGems), backgroundColor: ['#38bdf8','#c084fc','#34d399','#f43f5e','#fbbf24'] }] 
    },
    options: { plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8' } } } }
  });
}
