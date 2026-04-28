const supabase = require("../../lib/supabase");
const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

const { data: existingUser } = await supabase
  .from("users")
  .select("id")
  .eq("email", email)
  .maybeSingle();

if (existingUser) {
  return res.status(200).json({
    success: false,
    error: "User already registered. Please login with your existing API key."
  });
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

await supabase.from("otp_codes").delete().eq("email", email);

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: "Email required" });
    }

    const code = generateOTP();
    const expires_at = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await supabase
      .from("otp_codes")
      .delete()
      .eq("email", email);

    const { error: insertError } = await supabase.from("otp_codes").insert({
      email,
      code,
      expires_at
    });

    if (insertError) {
      return res.status(500).json({ success: false, error: "Failed to store OTP" });
    }

    const { error: emailError } = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: "Your Ghost Scrape OTP",
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
          <h2>Your Ghost Scrape OTP</h2>
          <p>Use this code to log in:</p>
          <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">${code}</p>
          <p>This code expires in 5 minutes.</p>
        </div>
      `
    });

    if (emailError) {
      return res.status(500).json({ success: false, error: "Failed to send email" });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};