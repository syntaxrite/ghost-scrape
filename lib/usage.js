const supabase = require("./supabase");

const DAILY_LIMIT = 25;
const MONTHLY_LIMIT = 300;

// -----------------------------
// TIME HELPERS (UTC SAFE)
// -----------------------------
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

// -----------------------------
// IDENTITY (IMPORTANT DESIGN)
// -----------------------------
function buildScope({ apiKey, ip }) {
  if (apiKey) return { field: "api_key", value: apiKey };
  if (ip) return { field: "ip", value: ip };
  return null;
}

// -----------------------------
// DAILY USAGE
// -----------------------------
async function checkUsage(apiKey, ip) {
  try {
    const scope = buildScope({ apiKey, ip });
    if (!scope) return 0;

    const { count, error } = await supabase
      .from("usage_logs") // ✅ FIXED
      .select("id", { count: "exact", head: true })
      .eq(scope.field, scope.value)
      .gte("created_at", startOfUtcDay());

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
// MONTHLY USAGE
// -----------------------------
async function checkMonthlyUsage(apiKey, ip) {
  try {
    const scope = buildScope({ apiKey, ip });
    if (!scope) return 0;

    const { count, error } = await supabase
      .from("usage_logs") // ✅ FIXED
      .select("id", { count: "exact", head: true })
      .eq(scope.field, scope.value)
      .gte("created_at", startOfUtcMonth())
      .lt("created_at", endOfUtcMonth());

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
// LOG USAGE (NON-BLOCKING SAFE)
// -----------------------------
async function logUsage(apiKey, ip, endpoint) {
  try {
    const { error } = await supabase
      .from("usage_logs") // ✅ FIXED
      .insert({
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
