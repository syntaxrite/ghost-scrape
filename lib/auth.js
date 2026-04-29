const supabase = require("./supabase");

async function validateKey(apiKey) {
  if (!apiKey) return null;

  const { data } = await supabase
    .from("api_keys")
    .select("*")
    .eq("key", apiKey)
    .single();

  return data || null;
}

module.exports = { validateKey };