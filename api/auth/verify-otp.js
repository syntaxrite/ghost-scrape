const supabase = require("../../lib/supabase");
const crypto = require("crypto");

function generateApiKey() {
  return "ghost_" + crypto.randomBytes(16).toString("hex");
}

module.exports = async (req, res) => {
  const { email, code } = req.body;

  // 1. Verify OTP
  const { data, error } = await supabase
    .from("otp_codes")
    .select("*")
    .eq("email", email)
    .eq("code", code)
    .single();

  if (error || !data) {
    return res.status(401).json({ error: "Invalid OTP" });
  }

  if (new Date(data.expires_at) < new Date()) {
    return res.status(401).json({ error: "OTP expired" });
  }

  // 2. Get or create user
  let { data: user, error: userError } = await supabase
    .from("users")
    .select("*")
    .eq("email", email)
    .single();

  if (userError || !user) {
    const { data: createdUser, error: createError } = await supabase
      .from("users")
      .insert({ email })
      .select()
      .single();

    if (createError) {
      return res.status(500).json({ error: "User creation failed" });
    }

    user = createdUser;
  }

  // 3. Generate API key
  const apiKey = generateApiKey();

  await supabase.from("api_keys").delete().eq("user_id", user.id);

  await supabase.from("api_keys").insert({
    user_id: user.id,
    key: apiKey
  });

  // 4. Delete OTP
  await supabase.from("otp_codes").delete().eq("id", data.id);

  return res.json({
    success: true,
    apiKey
  });
};