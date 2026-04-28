const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    throw new Error("Supabase env vars missing");
}

module.exports = supabase;