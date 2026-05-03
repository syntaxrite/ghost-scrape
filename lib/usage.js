const supabase = require("./supabase");

const MONTHLY_LIMIT = 300;

function monthWindow(date = new Date()) {
  const start = new Date(date);
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function scopeFilter({ apiKey, ip }) {
  const key = String(apiKey || "").trim();
  const addr = String(ip || "").trim();

  if (key) return { field: "api_key", value: key };
  if (addr) return { field: "ip", value: addr };
  return null;
}

async function countUsage({ scope, from, to }) {
  if (!scope) return 0;

  let query = supabase
    .from("usage_logs")
    .select("id", { count: "exact", head: true })
    .eq(scope.field, scope.value)
    .gte("created_at", from);

  if (to) {
    query = query.lt("created_at", to);
  }

  const { count, error } = await query;
  if (error) {
    console.error("USAGE COUNT ERROR:", error);
    return 0;
  }

  return count || 0;
}

async function checkMonthlyUsage(apiKey, ip) {
  try {
    const scope = scopeFilter({ apiKey, ip });
    const { start, end } = monthWindow();
    return await countUsage({ scope, from: start, to: end });
  } catch (err) {
    console.error("MONTHLY USAGE FATAL:", err);
    return 0;
  }
}

async function checkUsage(apiKey, ip) {
  return checkMonthlyUsage(apiKey, ip);
}

async function logUsage(apiKey, ip, endpoint, meta = {}) {
  try {
    const { error } = await supabase.from("usage_logs").insert({
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
  MONTHLY_LIMIT,
  monthWindow,
  checkUsage,
  checkMonthlyUsage,
  logUsage,
};
