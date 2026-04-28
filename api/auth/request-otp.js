const supabase = require("../../lib/supabase");
const crypto = require("crypto");
const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6 digit
}

module.exports = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email required" });
  }

  const otp = generateOTP();

  // store OTP in DB
  const { error } = await supabase.from("otp_codes").insert({
    email,
    code: otp,
    expires_at: new Date(Date.now() + 5 * 60 * 1000) // 5 min
  });

  if (error) {
    return res.status(500).json({ error: "Failed to store OTP" });
  }

  try {
    await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: "Your Ghost Scrape OTP",
      html: `
        <div style="font-family: sans-serif;">
          <h2>Your OTP Code</h2>
          <p>Use this code to login:</p>
          <h1>${otp}</h1>
          <p>This expires in 5 minutes.</p>
        </div>
      `
    });

    return res.json({ success: true });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to send email" });
  }
};