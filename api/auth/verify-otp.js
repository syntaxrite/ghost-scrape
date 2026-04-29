res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader("Access-Control-Allow-Headers", "x-api-key, content-type");
res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

if (req.method === "OPTIONS") {
  return res.status(200).end();
}

const supabase = require("../../lib/supabase");
const crypto = require("crypto");

function generateApiKey() {
  return "ghost_" + crypto.randomBytes(24).toString("hex");
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const email = req.body.email?.toLowerCase().trim();
    const code = String(req.body.code || req.body.otp || "").trim();

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        error: "Email and OTP required",
      });
    }

    // 🔥 only VALID + NON-EXPIRED OTP
    const { data: otpRow, error: otpError } = await supabase
      .from("otp_codes")
      .select("*")
      .eq("email", email)
      .eq("code", code)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (otpError || !otpRow) {
      return res.status(401).json({
        success: false,
        error: "Invalid or expired OTP",
      });
    }

    // 🔥 get or create user
    let { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (!user) {
      const { data: newUser, error } = await supabase
        .from("users")
        .insert({ email })
        .select()
        .single();

      if (error) {
        return res.status(500).json({
          success: false,
          error: "User creation failed",
        });
      }

      user = newUser;
    }

    // 🔥 check existing API key
    const { data: existingKey } = await supabase
      .from("api_keys")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    let apiKey;

    if (existingKey) {
      apiKey = existingKey.key;
    } else {
      apiKey = generateApiKey();

      const { error: keyError } = await supabase.from("api_keys").insert({
        user_id: user.id,
        key: apiKey,
      });

      if (keyError) {
        return res.status(500).json({
          success: false,
          error: "API key creation failed",
        });
      }
    }

    // 🔥 cleanup OTP (IMPORTANT)
    await supabase
      .from("otp_codes")
      .delete()
      .eq("email", email);

    return res.status(200).json({
      success: true,
      apiKey,
    });

  } catch (err) {
    console.error("Verify OTP error:", err);
    return res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
};