const supabase = require("../../lib/supabase");
const crypto = require("crypto");

function generateApiKey() {
  return "ghost_" + crypto.randomBytes(16).toString("hex");
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const { email } = req.body;
    const code = String(req.body.code || req.body.otp || "").trim();

    if (!email || !code) {
      return res.status(400).json({ success: false, error: "Email and OTP required" });
    }

    const { data: otpRow, error: otpError } = await supabase
      .from("otp_codes")
      .select("*")
      .eq("email", email)
      .eq("code", code)
      .maybeSingle();

    if (otpError || !otpRow) {
      return res.status(401).json({ success: false, error: "Invalid OTP" });
    }

    if (new Date(otpRow.expires_at) < new Date()) {
      return res.status(401).json({ success: false, error: "OTP expired" });
    }

    let { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (userError) {
      return res.status(500).json({ success: false, error: "User lookup failed" });
    }

    if (!user) {
      const { data: createdUser, error: createError } = await supabase
        .from("users")
        .insert({ email })
        .select("*")
        .single();

      if (createError || !createdUser) {
        return res.status(500).json({ success: false, error: "User creation failed" });
      }

      user = createdUser;
    }

    const apiKey = generateApiKey();

    await supabase.from("api_keys").delete().eq("user_id", user.id);

    const { error: keyError } = await supabase.from("api_keys").insert({
      user_id: user.id,
      key: apiKey
    });

    if (keyError) {
      return res.status(500).json({ success: false, error: "API key creation failed" });
    }

    await supabase.from("otp_codes").delete().eq("id", otpRow.id);

    return res.status(200).json({
      success: true,
      apiKey
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};