const supabase = require("../../lib/supabase");
const {
  checkUsage,
  checkMonthlyUsage,
  DAILY_LIMIT,
  MONTHLY_LIMIT,
} = require("../../lib/usage");

function getApiKey(req) {
  const auth =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    req.headers?.["x-api-key"];

  if (!auth || typeof auth !== "string") return null;

  if (/^bearer\s+/i.test(auth)) {
    return auth.slice(7).trim();
  }

  return auth.trim();
}

function getIp(req) {
  const raw =
    req.headers["x-forwarded-for"] ||
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "unknown";

  return String(raw).split(",")[0].trim();
}

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
    return res.status(405).json({
      success: false,
      error: "Method not allowed",
    });
  }

  try {
    const apiKey = getApiKey(req);

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: "API key required",
      });
    }

    const { data: keyRow, error: keyError } = await supabase
      .from("api_keys")
      .select("user_id")
      .eq("key", apiKey.trim())
      .limit(1)
      .maybeSingle();

    if (keyError) {
      console.error("API key lookup error:", keyError);
      return res.status(500).json({
        success: false,
        error: "Database error",
      });
    }

    if (!keyRow) {
      return res.status(403).json({
        success: false,
        error: "Invalid API key",
      });
    }

    const ip = getIp(req);

    let dailyUsed = 0;
    let monthlyUsed = 0;

    try {
      dailyUsed = await checkUsage(apiKey.trim(), ip);
      monthlyUsed = await checkMonthlyUsage(apiKey.trim(), ip);
    } catch (err) {
      console.error("Usage lookup error:", err);
    }

    return res.status(200).json({
      success: true,
      daily_used: dailyUsed,
      daily_limit: DAILY_LIMIT,
      monthly_used: monthlyUsed,
      monthly_limit: MONTHLY_LIMIT,
    });
  } catch (err) {
    console.error("USER STATS ERROR:", err);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};
