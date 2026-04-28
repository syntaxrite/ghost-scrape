const supabase = require("../../lib/supabase");
const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email required" });
    }

    const code = generateOTP();
    const expires_at = new Date(Date.now() + 5 * 60 * 1000); // 5 mins

    // store OTP
    await supabase.from("otp_codes").insert({
      email,
      code,
      expires_at
    });

    // send email
    await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: "Your Ghost Scrape OTP",
      html: `
        <h2>Your OTP</h2>
        <p style="font-size:20px;"><strong>${code}</strong></p>
        <p>This expires in 5 minutes.</p>
      `
    });

    return res.json({ success: true });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to send OTP" });
  }
};