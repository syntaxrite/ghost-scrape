import crypto from "crypto";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "../../../lib/supabase";
import { MONTHLY_LIMIT } from "../../../lib/usage";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  try {
    const { email, password } = req.body;
    const { data: user } = await supabaseAdmin.from("users").select("*").eq("email", email.toLowerCase().trim()).maybeSingle();
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }

    const { data: existingKey } = await supabaseAdmin.from("api_keys").select("key").eq("user_id", user.id).maybeSingle();
    let apiKey = existingKey?.key || "ghost_" + crypto.randomBytes(24).toString("hex");
    if (!existingKey) await supabaseAdmin.from("api_keys").insert({ user_id: user.id, key: apiKey });

    return res.status(200).json({ success: true, apiKey, email: user.email, plan: user.plan, monthlyLimit: MONTHLY_LIMIT });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
