const crypto = require("node:crypto");
const { Resend } = require("resend");
const supabase = require("../../lib/supabase");

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

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

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
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

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        error: "Valid email required",
      });
    }

    if (!resend || !process.env.RESEND_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "Email service not configured",
      });
    }

    const code = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const { error: deleteError } = await supabase
      .from("otp_codes")
      .delete()
      .eq("email", email);

    if (deleteError) {
      console.error("OTP delete error:", deleteError);
      return res.status(500).json({
        success: false,
        error: "Failed to prepare OTP",
      });
    }

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

    const { error: emailError } = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: "Your Ghost Scrape OTP",
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5;">
          <h2>Your OTP Code</h2>
          <p>Your one-time code is:</p>
          <h1 style="letter-spacing: 6px;">${code}</h1>
          <p>This code expires in 5 minutes.</p>
        </div>
      `,
    });

    if (emailError) {
      console.error("Resend error:", emailError);

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
