const supabase = require("../lib/supabase");
const {
  checkUsage,
  checkMonthlyUsage,
  DAILY_LIMIT,
  MONTHLY_LIMIT,
} = require("../lib/usage");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "x-api-key, content-type");
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
    const apiKey = req.headers["x-api-key"];

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: "No API key provided",
      });
    }

    const { data: keyRow, error: keyError } = await supabase
      .from("api_keys")
      .select("key")
      .eq("key", apiKey)
      .maybeSingle();

    if (keyError) {
      console.error("API Key Query Error:", keyError);
      return res.status(500).json({
        success: false,
        error: "Database error (api_keys)",
      });
    }

    if (!keyRow) {
      return res.status(401).json({
        success: false,
        error: "Invalid API key",
      });
    }

    const dailyUsed = await checkUsage(apiKey, null);
    const monthlyUsed = await checkMonthlyUsage(apiKey);

    return res.status(200).json({
      daily_used: dailyUsed || 0,
      daily_limit: DAILY_LIMIT,
      monthly_used: monthlyUsed || 0,
      monthly_limit: MONTHLY_LIMIT,
    });
  } catch (err) {
    console.error("USAGE ERROR:", err);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};
