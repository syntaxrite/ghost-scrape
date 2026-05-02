const supabase = require("./supabase");

const DAILY_LIMIT = 25;
const MONTHLY_LIMIT = 300;

function startOfUtcDay(date = new Date()) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function startOfUtcMonth(date = new Date()) {
  const d = new Date(date);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function buildScope({ apiKey, ip }) {
  if (apiKey) return { field: "api_key", value: apiKey };
  if (ip) return { field: "ip", value: ip };
  return null;
}

async function checkUsage(apiKey, ip) {
  try {
    const scope = buildScope({ apiKey, ip });
    if (!scope) return 0;

    const today = startOfUtcDay();

    let query = supabase
      .from("usage_log")
      .select("id", { count: "exact", head: true })
      .gte("created_at", today.toISOString())
      .eq(scope.field, scope.value);

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

async function checkMonthlyUsage(apiKey, ip) {
  try {
    const scope = buildScope({ apiKey, ip });
    if (!scope) return 0;

    const start = startOfUtcMonth();
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);

    const { count, error } = await supabase
      .from("usage_log")
      .select("id", { count: "exact", head: true })
      .eq(scope.field, scope.value)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString());

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

async function logUsage(apiKey, ip, endpoint) {
  try {
    const { error } = await supabase.from("usage_log").insert({
      api_key: apiKey || null,
      ip: ip || null,
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
