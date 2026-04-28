const supabase = require("../../lib/supabase");

module.exports = async (req, res) => {
  try {
    const apiKey = req.headers["x-api-key"];

    if (!apiKey) {
      return res.status(401).json({ success: false, error: "No API key" });
    }

    // 1. Get API key row
    const { data: keyRow, error: keyError } = await supabase
      .from("api_keys")
      .select("*")
      .eq("key", apiKey)
      .maybeSingle();

    if (keyError || !keyRow) {
      return res.status(401).json({ success: false, error: "Invalid API key" });
    }

    // 2. Get user
    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("id", keyRow.user_id)
      .single();

    // 3. Count usage today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count } = await supabase
      .from("usage_logs")
      .select("*", { count: "exact", head: true })
      .eq("api_key", apiKey)
      .gte("created_at", today.toISOString());

    return res.status(200).json({
      success: true,
      email: user.email,
      apiKey,
      usageToday: count || 0,
      limit: 10 // match your DAILY_LIMIT
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
};