const supabase = require("./supabase");

async function validateKey(apiKey) {
  const key = String(apiKey || "").trim();
  if (!key) return null;

  const { data, error } = await supabase
    .from("api_keys")
    .select("key, user_id")
    .eq("key", key)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

module.exports = { validateKey };
