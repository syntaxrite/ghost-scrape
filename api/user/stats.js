const supabase = require("../../lib/supabase");

module.exports = async (req, res) => {
  try {
    // 1. Get API key from headers
    const apiKey = req.headers["x-api-key"];

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: "No API key provided"
      });
    }

    // 2. Fetch API key record
    const { data: keyRow, error: keyError } = await supabase
      .from("api_keys")
      .select("*")
      .eq("key", apiKey)
      .maybeSingle();

    if (keyError) {
      console.error("API Key Query Error:", keyError);
      return res.status(500).json({
        success: false,
        error: "Database error (api_keys)"
      });
    }

    if (!keyRow) {
      return res.status(401).json({
        success: false,
        error: "Invalid API key"
      });
    }

    // 3. Fetch user
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("id", keyRow.user_id)
      .single();

    if (userError || !user) {
      console.error("User Fetch Error:", userError);
      return res.status(500).json({
        success: false,
        error: "User not found"
      });
    }

    // 4. Get today's usage
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count, error: usageError } = await supabase
      .from("usage_logs")
      .select("*", { count: "exact", head: true })
      .eq("api_key", apiKey)
      .gte("created_at", today.toISOString());

    if (usageError) {
      console.error("Usage Query Error:", usageError);
      return res.status(500).json({
        success: false,
        error: "Usage tracking failed"
      });
    }

    // 5. Success response
    return res.status(200).json({
      success: true,
      email: user.email,
      apiKey: apiKey,
      usageToday: count || 0,
      limit: 10 // keep this consistent with your system
    });

  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
};