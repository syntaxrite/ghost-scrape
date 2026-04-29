res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader("Access-Control-Allow-Headers", "x-api-key, content-type");
res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

if (req.method === "OPTIONS") {
  return res.status(200).end();
}
module.exports = async (req, res) => {
  return res.status(200).json({
    ok: true,
    env: {
      supabase: !!process.env.SUPABASE_URL,
      key: !!process.env.SUPABASE_KEY,
      browserless: !!process.env.BROWSERLESS_TOKEN
    },
    time: new Date().toISOString()
  });
};
