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
