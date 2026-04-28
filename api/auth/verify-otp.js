const supabase = require("../../lib/supabase");
const crypto = require("crypto");

function generateApiKey() {
  return "ghost_" + crypto.randomBytes(16).toString("hex");
}

module.exports = async (req, res) => {
  const { email, code } = req.body;

  const { data } = await supabase
    .from("otp_codes")
    .select("*")
    .eq("email", email)
    .eq("code", code)
    .single();

  if (!data) {
    return res.status(401).json({ error: "Invalid OTP" });
  }

  if (new Date(data.expires_at) < new Date()) {
    return res.status(401).json({ error: "OTP expired" });
  }

  // create user if not exists
  let user = await supabase.from("users").select("*").eq("email", email).single();

  if (!user.data) {
    const created = await supabase.from("users").insert({ email }).select().single();
    user = created;
  }

  const apiKey = generateApiKey();

  await supabase.from("api_keys").insert({
    user_id: user.data.id,
    key: apiKey
  });

  return res.json({
    success: true,
    apiKey
  });
};