const supabase = require("../../lib/supabase");
const crypto = require("crypto");
const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ success: false });
    }

    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: "Email required" });
    }

    // ✅ CHECK IF USER EXISTS (NOW VALID)
    const { data: existingUser } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (existingUser) {
      return res.status(200).json({
        success: true,
        message: "User already registered. Please login.",
      });
    }

    const code = generateOTP();
    const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    // SAVE OTP
    await supabase.from("otp_codes").insert({
      email,
      code,
      expires_at: expires.toISOString(),
    });

    // SEND EMAIL
    await resend.emails.send({
      from: "Ghost Scrape <no-reply@ghost-scrape.tech>",
      to: email,
      subject: "Your OTP - Ghost Scrape",
      html: `<p>Your OTP is <strong>${code}</strong></p>`
    });

    return res.status(200).json({
      success: true,
      message: "OTP sent"
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
};