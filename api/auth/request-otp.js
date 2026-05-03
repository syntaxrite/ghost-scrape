const crypto = require("node:crypto");
const { Resend } = require("resend");
const supabase = require("../../lib/supabase");
const { parseJsonBody, getClientIp } = require("../../lib/request");

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const OTP_COOLDOWN_MS = 60 * 1000;
const recentRequests = new Map();

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function canSendAgain(key) {
  const now = Date.now();
  const last = recentRequests.get(key) || 0;
  if (now - last < OTP_COOLDOWN_MS) return false;
  recentRequests.set(key, now);
  return true;
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
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const body = parseJsonBody(req);
    if (!body) {
      return res.status(400).json({ success: false, error: "Invalid JSON body" });
    }

    const email = String(body.email || "").toLowerCase().trim();
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, error: "Valid email required" });
    }

    if (!resend || !process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
      return res.status(500).json({ success: false, error: "Email service not configured" });
    }

    const ip = getClientIp(req);
    const rateKey = `${email}:${ip}`;
    if (!canSendAgain(rateKey)) {
      return res.status(429).json({ success: false, error: "Please wait a moment before requesting another code" });
    }

    const code = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const { error: deleteError } = await supabase.from("otp_codes").delete().eq("email", email);
    if (deleteError) {
      console.error("OTP delete error:", deleteError);
      return res.status(500).json({ success: false, error: "Failed to prepare OTP" });
    }

    const { error: insertError } = await supabase.from("otp_codes").insert({
      email,
      code,
      expires_at: expiresAt,
    });

    if (insertError) {
      console.error("OTP insert error:", insertError);
      return res.status(500).json({ success: false, error: "Failed to save OTP" });
    }

    const { error: emailError } = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: "Your Ghost Scrape login code",
      html: `
        <div style="font-family: Inter, Arial, sans-serif; line-height: 1.6; color: #0f172a;">
          <h2 style="margin: 0 0 12px;">Your login code</h2>
          <p style="margin: 0 0 18px;">Use this code to sign in to Ghost Scrape.</p>
          <div style="font-size: 32px; font-weight: 800; letter-spacing: 8px; padding: 18px 22px; border-radius: 16px; background: #f8fafc; display: inline-block;">${code}</div>
          <p style="margin: 18px 0 0; color: #475569;">The code expires in 5 minutes.</p>
        </div>
      `,
    });

    if (emailError) {
      console.error("Resend error:", emailError);
      await supabase.from("otp_codes").delete().eq("email", email);
      return res.status(500).json({ success: false, error: "Failed to send OTP email" });
    }

    return res.status(200).json({ success: true, message: "OTP sent" });
  } catch (err) {
    console.error("REQUEST OTP ERROR:", err);
    return res.status(500).json({ success: false, error: err.message || "Server error" });
  }
};
