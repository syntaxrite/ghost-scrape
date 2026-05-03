import { supabaseAdmin } from "./supabase";

export const MONTHLY_LIMIT = 300;

// Get ISO start/end of current month
function monthWindow(date = new Date()) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

// Determine query filter by api_key or IP
function scopeFilter({ apiKey, ip }) {
  const key = apiKey?.trim();
  if (key) return { field: "api_key", value: key };
  const addr = ip?.trim();
  if (addr) return { field: "ip", value: addr };
  return null;
}

// Count rows in usage_logs for given scope and time range
async function countUsage({ scope, from, to }) {
  if (!scope) return 0;
  let query = supabaseAdmin
    .from("usage_logs")
    .select("id", { count: "exact", head: true })
    .eq(scope.field, scope.value)
    .gte("created_at", from);
  if (to) query = query.lt("created_at", to);
  const { count, error } = await query;
  if (error) {
    console.error("Usage count error:", error);
    return 0;
  }
  return count || 0;
}

// Check how many requests have been used in the current month
export async function checkMonthlyUsage(apiKey, ip) {
  try {
    const scope = scopeFilter({ apiKey, ip });
    const { start, end } = monthWindow();
    return await countUsage({ scope, from: start, to: end });
  } catch (err) {
    console.error("Monthly usage check error:", err);
    return 0;
  }
}

// Log a usage event
export async function logUsage(apiKey, ip, endpoint) {
  try {
    await supabaseAdmin.from("usage_logs").insert({
      api_key: apiKey || null,
      ip: ip || null,
      endpoint: endpoint || null,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Usage log error:", err);
  }
}
