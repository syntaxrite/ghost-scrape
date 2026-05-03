import { supabaseAdmin } from "./supabase";

// Validate API key and return its user data
export async function validateKey(apiKey) {
  if (!apiKey) return null;
  const { data, error } = await supabaseAdmin
    .from("api_keys")
    .select("key, user_id")
    .eq("key", apiKey.trim())
    .maybeSingle();
  if (error || !data) return null;
  return data; // { key, user_id }
}
