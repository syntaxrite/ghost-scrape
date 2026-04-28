const supabase = require("../../lib/supabase");
const crypto = require("crypto");

module.exports = async (req, res) => {
  const { email } = req.body;

  if (!email) return res.status(400).json({ error: "Email required" });

  const code = Math.floor(100000 + Math.random() * 900000).toString();

  const expires = new Date(Date.now() + 10 * 60 * 1000);

  await supabase.from("otp_codes").insert({
    email,
    code,
    expires_at: expires
  });

  // TEMP: just return OTP (we add email sending later)
  return res.json({
    success: true,
    message: "OTP generated",
    debug_code: code
  });
};