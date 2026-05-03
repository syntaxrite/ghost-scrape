import crypto from "crypto";
import { supabaseAdmin } from "../../../lib/supabase";
import { MONTHLY_LIMIT } from "../../../lib/usage";

export function generateApiKey() {
  return "ghost_" + crypto.randomBytes(24).toString("hex");
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { email, code } = req.body;
    const { data: otpRow } = await supabaseAdmin
      .from("otp_codes")
      .select("id")
      .eq("email", email)
      .eq("code", code)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (!otpRow) return res.status(401).json({ success: false, error: "Invalid or expired OTP" });

    let { data: user } = await supabaseAdmin.from("users").select("id, email, plan").eq("email", email).maybeSingle();
    if (!user) {
      const { data: newUser } = await supabaseAdmin.from("users").insert({ email, plan: "free" }).select("id, email, plan").single();
      user = newUser;
    }

    let { data: existingKey } = await supabaseAdmin.from("api_keys").select("key").eq("user_id", user.id).maybeSingle();
    let apiKey = existingKey?.key || generateApiKey();
    if (!existingKey) await supabaseAdmin.from("api_keys").insert({ user_id: user.id, key: apiKey });

    await supabaseAdmin.from("otp_codes").delete().eq("id", otpRow.id);

    return res.status(200).json({ success: true, apiKey, email: user.email, plan: user.plan, monthlyLimit: MONTHLY_LIMIT });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
