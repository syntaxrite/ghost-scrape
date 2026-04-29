res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader("Access-Control-Allow-Headers", "x-api-key, content-type");
res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

if (req.method === "OPTIONS") {
  return res.status(200).end();
}

const supabase = require("../../lib/supabase");
const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: "Email required" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 🔥 optional but recommended: delete previous OTPs
    await supabase
      .from("otp_codes")
      .delete()
      .eq("email", normalizedEmail);

    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const { error: insertError } = await supabase.from("otp_codes").insert({
      email: normalizedEmail,
      code,
      expires_at: expiresAt.toISOString(),
    });

    if (insertError) {
      return res.status(500).json({ success: false, error: "Failed to store OTP" });
    }

    await resend.emails.send({
      from: "Ghost Scrape <no-reply@ghost-scrape.tech>",
      to: normalizedEmail,
      subject: "Your OTP - Ghost Scrape",
      html: `
        <h2>Your OTP</h2>
        <p><strong>${code}</strong></p>
        <p>This code expires in 10 minutes.</p>
      `,
    });

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully",
    });

  } catch (err) {
    console.error("OTP request error:", err);
    return res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
};