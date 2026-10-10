const CONFIG = {
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

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const status = await redisCmd('get', 'system:analytics_status');
    return res.status(200).json({ enabled: status !== 'disabled' });
  }

  if (req.method === 'POST') {
    const { enabled } = req.body || {};
    if (enabled === false) {
      await redisCmd('set', 'system:analytics_status', 'disabled');
      return res.status(200).json({ success: true, enabled: false, message: 'Analytics & Webhook dimatikan.' });
    } else {
      await redisCmd('del', 'system:analytics_status');
      return res.status(200).json({ success: true, enabled: true, message: 'Analytics & Webhook diaktifkan.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
