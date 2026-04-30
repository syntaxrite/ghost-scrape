const supabase = require("./supabase");

const DAILY_LIMIT = 10;

async function checkUsage(apiKey, ip) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Count today's usage
  let query = supabase
    .from("usage_log")
    .select("*", { count: "exact", head: true })
    .gte("created_at", today.toISOString());

  if (apiKey) {
    query = query.eq("api_key", apiKey);
  } else {
    query = query.eq("ip", ip);
  }

  const { count } = await query;

  return count || 0;
}

async function logUsage(apiKey, ip, endpoint) {
  await supabase.from("usage_log").insert({
    api_key: apiKey || null,
    ip,
    endpoint: endpoint || null,
  });
}

module.exports = { checkUsage, logUsage, DAILY_LIMIT };
