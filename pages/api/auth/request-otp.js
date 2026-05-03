import crypto from "crypto";
import { Resend } from "resend";
import { supabaseAdmin } from "../../../lib/supabase";
import { parseJsonBody, getClientIp } from "../../../lib/request";

const resendClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const OTP_COOLDOWN_MS = 60 * 1000;
const recentRequests = new Map();

function isValidEmail(email) {
  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email);
}
function generateOtp() {
  return String(crypto.randomInt(100000, 1000000)).padStart(6, "0");
}
function canSendAgain(key) {
  const now = Date.now();
  const last = recentRequests.get(key) || 0;
  if (now - last < OTP_COOLDOWN_MS) return false;
  recentRequests.set(key, now);
  return true;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" });

  try {
    const body = parseJsonBody(req);
    const email = String(body?.email || "").toLowerCase().trim();
    if (!isValidEmail(email)) return res.status(400).json({ success: false, error: "Valid email required" });
    if (!resendClient || !process.env.EMAIL_FROM) return res.status(500).json({ success: false, error: "Email service not configured" });

    const ip = getClientIp(req);
    const rateKey = `${email}:${ip}`;
    if (!canSendAgain(rateKey)) return res.status(429).json({ success: false, error: "Please wait before requesting another code" });

    const code = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await supabaseAdmin.from("otp_codes").delete().eq("email", email);
    await supabaseAdmin.from("otp_codes").insert({ email, code, expires_at: expiresAt });

    await resendClient.emails.send({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: "Your Ghost Scrape Login Code",
      html: `<div style="font-family: Arial, sans-serif;"><p>Your code is: <b>${code}</b></p></div>`,
    });

    return res.status(200).json({ success: true, message: "OTP sent" });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Server error" });
  }
}
