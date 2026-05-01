const supabase = require("./supabase");

// -----------------------------
// SINGLE SOURCE OF TRUTH
// -----------------------------
const USAGE_LIMITS = {
  FREE: {
    DAILY: 25,
    MONTHLY: 300,
  },
};

// -----------------------------
// DAILY USAGE
// -----------------------------
async function getDailyUsage(apiKey, ip, demoId) {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    let query = supabase
      .from("usage_logs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startOfDay.toISOString());

    if (apiKey) query = query.eq("api_key", apiKey);
    else if (demoId) query = query.eq("demo_id", demoId);
    else if (ip) query = query.eq("ip", ip);

    const { count, error } = await query;

    if (error) {
      console.error("[USAGE] Daily error:", error);
      return 0;
    }

    return count || 0;
  } catch (err) {
    console.error("[USAGE] Daily fatal:", err);
    return 0;
  }
}

// -----------------------------
// MONTHLY USAGE
// -----------------------------
async function getMonthlyUsage(apiKey) {
  if (!apiKey) return 0;

  try {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setMonth(start.getMonth() + 1);

    const { count, error } = await supabase
      .from("usage_logs")
      .select("id", { count: "exact", head: true })
      .eq("api_key", apiKey)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString());

    if (error) {
      console.error("[USAGE] Monthly error:", error);
      return 0;
    }

    return count || 0;
  } catch (err) {
    console.error("[USAGE] Monthly fatal:", err);
    return 0;
  }
}

// -----------------------------
// LOG USAGE (SINGLE EVENT)
// -----------------------------
async function logUsage({ apiKey, ip, endpoint, demoId }) {
  try {
    const { error } = await supabase.from("usage_logs").insert([
      {
        api_key: apiKey || null,
        ip: ip || null,
        demo_id: demoId || null,
        endpoint: endpoint || null,
      },
    ]);

    if (error) {
      console.error("[USAGE] Log error:", error);
    }
  } catch (err) {
    console.error("[USAGE] Log fatal:", err);
  }
}

module.exports = {
  USAGE_LIMITS,
  getDailyUsage,
  getMonthlyUsage,
  logUsage,
};
