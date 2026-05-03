const supabase = require("../../lib/supabase");
const { MONTHLY_LIMIT, checkMonthlyUsage, monthWindow } = require("../../lib/usage");
const { getApiKey, getClientIp } = require("../../lib/request");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "x-api-key, content-type, authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const apiKey = getApiKey(req);
    if (!apiKey) {
      return res.status(401).json({ success: false, error: "API key required" });
    }

    const { data: keyRow, error: keyError } = await supabase
      .from("api_keys")
      .select("user_id")
      .eq("key", apiKey)
      .maybeSingle();

    if (keyError) {
      console.error("API key lookup error:", keyError);
      return res.status(500).json({ success: false, error: "Database error" });
    }

    if (!keyRow) {
      return res.status(403).json({ success: false, error: "Invalid API key" });
    }

    const { data: userRow, error: userError } = await supabase
      .from("users")
      .select("id, email, plan")
      .eq("id", keyRow.user_id)
      .maybeSingle();

    if (userError) {
      console.error("User lookup error:", userError);
      return res.status(500).json({ success: false, error: "Database error" });
    }

    const ip = getClientIp(req);
    const monthlyUsed = await checkMonthlyUsage(apiKey, ip);
    const { start, end } = monthWindow();

    return res.status(200).json({
      success: true,
      plan: userRow?.plan || "free",
      email: userRow?.email || "",
      monthly_used: monthlyUsed,
      monthly_limit: MONTHLY_LIMIT,
      monthly_remaining: Math.max(0, MONTHLY_LIMIT - monthlyUsed),
      cycle_start: start,
      cycle_end: end,
    });
  } catch (err) {
    console.error("USER STATS ERROR:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};
