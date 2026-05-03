import { supabaseAdmin } from "../../lib/supabase";
import { MONTHLY_LIMIT, checkMonthlyUsage } from "../../lib/usage";
import { getApiKey, getClientIp } from "../../lib/request";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  const apiKey = getApiKey(req);
  const ip = getClientIp(req);
  
  const { data: keyRow } = await supabaseAdmin.from("api_keys").select("user_id").eq("key", apiKey).maybeSingle();
  if (!keyRow) return res.status(403).end();

  const { data: user } = await supabaseAdmin.from("users").select("email, plan").eq("id", keyRow.user_id).maybeSingle();
  const used = await checkMonthlyUsage(apiKey, ip);

  return res.status(200).json({
    success: true,
    email: user.email,
    plan: user.plan,
    monthly_used: used,
    monthly_limit: MONTHLY_LIMIT
  });
}
