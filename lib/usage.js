const supabase = require("./supabase");

const DAILY_LIMIT = 10;

async function checkUsage(apiKey, ip, demoId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let query = supabase
    .from("usage_logs")
    .select("*", { count: "exact", head: true })
    .gte("created_at", today.toISOString());

  if (apiKey) {
    query = query.eq("api_key", apiKey);
  } else if (demoId) {
    query = query.eq("demo_id", demoId);
  } else if (ip) {
    query = query.eq("ip", ip);
  }

  const { count, error } = await query;

  if (error) {
    console.error("USAGE CHECK ERROR:", error);
    return 0;
  }

  return count || 0;
}

async function logUsage(apiKey, ip, endpoint, demoId) {
  const { error } = await supabase.from("usage_logs").insert({
    api_key: apiKey || null,
    ip: ip || null,
    demo_id: demoId || null,
    endpoint: endpoint || null,
  });

  if (error) {
    console.error("USAGE LOG ERROR:", error);
  }
}

module.exports = { checkUsage, logUsage, DAILY_LIMIT };
