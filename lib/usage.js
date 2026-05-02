const supabase = require("./supabase");

const DAILY_LIMIT = 25;
const MONTHLY_LIMIT = 300;

function startOfUtcDay() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function startOfUtcMonth() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function endOfUtcMonth() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
}

function buildScope({ apiKey, ip }) {
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

async function checkUsage(apiKey, ip) {
  try {
    return await countUsage({
      scope: buildScope({ apiKey, ip }),
      from: startOfUtcDay(),
    });
  } catch (err) {
    console.error("DAILY USAGE FATAL:", err);
    return 0;
  }
}

async function checkMonthlyUsage(apiKey, ip) {
  try {
    return await countUsage({
      scope: buildScope({ apiKey, ip }),
      from: startOfUtcMonth(),
      to: endOfUtcMonth(),
    });
  } catch (err) {
    console.error("MONTHLY USAGE FATAL:", err);
    return 0;
  }
}

async function logUsage(apiKey, ip, endpoint) {
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
  checkUsage,
  checkMonthlyUsage,
  logUsage,
  DAILY_LIMIT,
  MONTHLY_LIMIT,
};
