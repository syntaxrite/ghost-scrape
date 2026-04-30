const supabase = require("../../lib/supabase");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "x-api-key, content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
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
      .select("*")
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

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("id", keyRow.user_id)
      .maybeSingle();

    if (userError || !user) {
      console.error("User Fetch Error:", userError);
      return res.status(500).json({
        success: false,
        error: "User not found",
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count, error: usageError } = await supabase
      .from("usage_log")
      .select("*", { count: "exact", head: true })
      .eq("api_key", apiKey)
      .gte("created_at", today.toISOString());

    if (usageError) {
      console.error("Usage Query Error:", usageError);
      return res.status(500).json({
        success: false,
        error: "Usage tracking failed",
      });
    }

    return res.status(200).json({
      success: true,
      email: user.email,
      apiKey,
      usageToday: count || 0,
      limit: 10,
    });
  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};
