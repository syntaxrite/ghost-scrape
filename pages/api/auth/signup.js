import crypto from "crypto";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "../../../lib/supabase";
import { MONTHLY_LIMIT } from "../../../lib/usage";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  try {
    const { email, password } = req.body;
    const emailLower = String(email).toLowerCase().trim();
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);

    const { data: newUser, error: userErr } = await supabaseAdmin
      .from("users")
      .insert({ email: emailLower, password_hash: hash, plan: "free" })
      .select("id, email, plan")
      .single();
    if (userErr) return res.status(400).json({ success: false, error: "User exists or error" });

    const apiKey = "ghost_" + crypto.randomBytes(24).toString("hex");
    await supabaseAdmin.from("api_keys").insert({ user_id: newUser.id, key: apiKey });

    return res.status(200).json({ success: true, apiKey, email: newUser.email, plan: "free", monthlyLimit: MONTHLY_LIMIT });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
