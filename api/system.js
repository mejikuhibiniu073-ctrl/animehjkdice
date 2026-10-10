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
    return (await res.json()).result;
  } catch (e) {
    return null;
  }
}

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    const { enabled } = req.body || {};
    const val = enabled ? 'enabled' : 'disabled';
    await redisCmd('set', 'system:analytics_status', val);
    return res.status(200).json({ success: true, status: val });
  }
  return res.status(405).json({ error: 'Method not allowed' });
};
