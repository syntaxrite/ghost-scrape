const { Resend } = require("resend");
const supabase = require("../../lib/supabase");

const resend = new Resend(process.env.RESEND_API_KEY);

function parseBody(req) {
  if (typeof req.body === "object" && req.body !== null) return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return null;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed",
    });
  }

  try {
    const body = parseBody(req);

    if (!body) {
      return res.status(400).json({
        success: false,
        error: "Invalid JSON body",
      });
    }

    const email = String(body.email || "").toLowerCase().trim();

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email required",
      });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    // Remove old OTPs for this email
    await supabase
      .from("otp_codes")
      .delete()
      .eq("email", email);

    // Save new OTP
    const { error: insertError } = await supabase.from("otp_codes").insert({
      email,
      code,
      expires_at: expiresAt,
    });

    if (insertError) {
      console.error("OTP insert error:", insertError);
      return res.status(500).json({
        success: false,
        error: "Failed to save OTP",
      });
    }

    // Send OTP email through Resend
    const { error: emailError } = await resend.emails.send({
      from: "Ghost Scrape <onboarding@resend.dev>",
      to: email,
      subject: "Your Ghost Scrape OTP",
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5;">
          <h2>Your OTP Code</h2>
          <p>Your one-time code is:</p>
          <h1>${code}</h1>
          <p>This code expires in 5 minutes.</p>
        </div>
      `,
    });

    if (emailError) {
      console.error("Resend error:", emailError);

      // Clean up if email failed
      await supabase.from("otp_codes").delete().eq("email", email);

      return res.status(500).json({
        success: false,
        error: "Failed to send OTP email",
      });
    }

    return res.status(200).json({
      success: true,
      message: "OTP sent",
    });
  } catch (err) {
    console.error("REQUEST OTP ERROR:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Server error",
    });
  }
};