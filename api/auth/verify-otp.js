const crypto = require("node:crypto");
const supabase = require("../../lib/supabase");
const { parseJsonBody } = require("../../lib/request");

function generateApiKey() {
  return "ghost_" + crypto.randomBytes(24).toString("hex");
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-api-key");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const body = parseJsonBody(req);
    if (!body) {
      return res.status(400).json({ success: false, error: "Invalid JSON body" });
    }

    const email = String(body.email || "").toLowerCase().trim();
    const code = String(body.code || body.otp || "").trim();

    if (!email || !code) {
      return res.status(400).json({ success: false, error: "Email and OTP required" });
    }

    const { data: otpRow, error: otpError } = await supabase
      .from("otp_codes")
      .select("id, email, code, expires_at")
      .eq("email", email)
      .eq("code", code)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (otpError) {
      console.error("OTP lookup error:", otpError);
      return res.status(500).json({ success: false, error: "Failed to verify OTP" });
    }

    if (!otpRow) {
      return res.status(401).json({ success: false, error: "Invalid or expired OTP" });
    }

    let { data: user, error: userError } = await supabase
      .from("users")
      .select("id, email, plan")
      .eq("email", email)
      .maybeSingle();

    if (userError) {
      console.error("User lookup error:", userError);
      return res.status(500).json({ success: false, error: "Failed to load user" });
    }

    if (!user) {
      const { data: newUser, error: createUserError } = await supabase
        .from("users")
        .insert({
          email,
          plan: "free",
        })
        .select("id, email, plan")
        .single();

      if (createUserError) {
        console.error("User creation error:", createUserError);
        return res.status(500).json({ success: false, error: "User creation failed" });
      }

      user = newUser;
    }

    const { data: existingKey, error: keyLookupError } = await supabase
      .from("api_keys")
      .select("key")
      .eq("user_id", user.id)
      .maybeSingle();

    if (keyLookupError) {
      console.error("API key lookup error:", keyLookupError);
      return res.status(500).json({ success: false, error: "Failed to load API key" });
    }

    let apiKey = existingKey?.key;

    if (!apiKey) {
      apiKey = generateApiKey();
      const { error: keyInsertError } = await supabase.from("api_keys").insert({
        user_id: user.id,
        key: apiKey,
      });

      if (keyInsertError) {
        console.error("API key insert error:", keyInsertError);
        return res.status(500).json({ success: false, error: "API key creation failed" });
      }
    }

    const { error: deleteOtpError } = await supabase.from("otp_codes").delete().eq("email", email);
    if (deleteOtpError) {
      console.error("OTP cleanup error:", deleteOtpError);
    }

    return res.status(200).json({
      success: true,
      apiKey,
      email: user.email,
      plan: user.plan || "free",
      monthlyLimit: 300,
    });
  } catch (err) {
    console.error("VERIFY OTP ERROR:", err);
    return res.status(500).json({ success: false, error: err.message || "Server error" });
  }
};
