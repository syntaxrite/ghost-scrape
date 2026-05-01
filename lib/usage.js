const supabase = require("./supabase");

const DAILY_LIMIT = 50;
const MONTHLY_LIMIT = 300;

// -----------------------------
// NORMALIZE IDENTITY (IMPORTANT FIX)
// -----------------------------
function buildIdentity({ apiKey, ip, demoId }) {
  return {
    api_key: apiKey || null,
    ip: ip || null,
    demo_id: demoId || null,
  };
}

// -----------------------------
// DAILY USAGE
// -----------------------------
async function checkUsage(apiKey, ip, demoId) {
  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    let query = supabase
      .from("usage_logs")
      .select("*", { count: "exact", head: true })
      .gte("created_at", today.toISOString());

    // IMPORTANT: unified matching rule
    if (apiKey) query = query.eq("api_key", apiKey);
    else if (demoId) query = query.eq("demo_id", demoId);
    else if (ip) query = query.eq("ip", ip);

    const { count, error } = await query;

    if (error) {
      console.error("DAILY USAGE ERROR:", error);
      return 0;
    }

    return count || 0;
  } catch (err) {
    console.error("DAILY USAGE FATAL:", err);
    return 0;
  }
}

// -----------------------------
// MONTHLY USAGE (FIXED)
// -----------------------------
async function checkMonthlyUsage(apiKey, ip, demoId) {
  try {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setUTCMonth(start.getUTCMonth() + 1);

    let query = supabase
      .from("usage_logs")
      .select("*", { count: "exact", head: true })
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString());

    // 🔥 FIX: match ANY identity (not only api_key)
    const orConditions = [];

    if (apiKey) orConditions.push(`api_key.eq.${apiKey}`);
    if (ip) orConditions.push(`ip.eq.${ip}`);
    if (demoId) orConditions.push(`demo_id.eq.${demoId}`);

    if (orConditions.length > 0) {
      query = query.or(orConditions.join(","));
    }

    const { count, error } = await query;

    if (error) {
      console.error("MONTHLY USAGE ERROR:", error);
      return 0;
    }

    return count || 0;
  } catch (err) {
    console.error("MONTHLY USAGE FATAL:", err);
    return 0;
  }
}

// -----------------------------
// LOG USAGE (IMPORTANT FIX)
// -----------------------------
async function logUsage(apiKey, ip, endpoint, demoId) {
  try {
    const { error } = await supabase.from("usage_logs").insert({
      api_key: apiKey || null,
      ip: ip || null,
      demo_id: demoId || null,
      endpoint: endpoint || null,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error("USAGE LOG ERROR:", error);
    }
  } catch (err) {
    console.error("USAGE LOG FATAL:", err);
  }
}

module.exports = {
  checkUsage,
  checkMonthlyUsage,
  logUsage,
  DAILY_LIMIT,
  MONTHLY_LIMIT,
};
