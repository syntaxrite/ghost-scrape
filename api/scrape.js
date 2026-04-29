console.log("SCRAPE START");
console.log("ENV CHECK:", {
  SUPABASE: !!process.env.SUPABASE_URL,
  KEY: !!process.env.SUPABASE_KEY,
  BROWSERLESS: !!process.env.BROWSERLESS_TOKEN
});

const supabase = require("../lib/supabase");

const {
  normalizeUrl,
  getWordCount,
  cleanMarkdown,
  turndown
} = require("../lib/utils");

const {
  getDomain,
  fetchSmart
} = require("../lib/engine");

const {
  extractContent
} = require("../lib/extractor");

// -----------------------------
// Validate API Key
// -----------------------------
async function validateKey(key) {
  if (!key) return null;

  const { data, error } = await supabase
    .from("api_keys")
    .select("*")
    .eq("key", key)
    .single();

  if (error || !data) return null;
  return data;
}

// -----------------------------
// Extract API key safely
// -----------------------------
function getApiKey(req) {
  const auth =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    req.headers?.["x-api-key"];

  if (!auth) return null;

  if (auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }

  return auth.trim();
}

// -----------------------------
// MAIN HANDLER
// -----------------------------
module.exports = async (req, res) => {
  try {
    // DEBUG (keep for now)
    console.log("HEADERS:", req.headers);

    // =============================
    // 1. AUTH
    // =============================
    const apiKey = getApiKey(req);

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: "API key required"
      });
    }

    const user = await validateKey(apiKey);

    if (!user) {
      return res.status(403).json({
        success: false,
        error: "Invalid API key"
      });
    }

    const userId = user.user_id;

    if (!userId) {
      return res.status(500).json({
        success: false,
        error: "User not linked to API key"
      });
    }

    // =============================
    // 2. INPUT URL
    // =============================
    const url = req.body?.url || req.query?.url;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "URL required"
      });
    }

    const normalized = normalizeUrl(url);
    const domain = getDomain(normalized);

    // =============================
    // 3. SCRAPE
    // =============================
    const { html, source, wasBlocked } = await fetchSmart(normalized);

    const article = extractContent(html, normalized);

    if (!article?.content) {
      return res.status(422).json({
        success: false,
        error: "Content unreadable"
      });
    }

    let markdown = turndown.turndown(article.content);
    markdown = cleanMarkdown(markdown);

    const wordCount = getWordCount(article.text || article.content);

    // =============================
    // 4. LOG USAGE (non-blocking)
    // =============================
    supabase.from("usage_logs").insert({
      user_id: userId,
      endpoint: "/api/scrape"
    }).catch(() => {});

    // =============================
    // 5. RESPONSE
    // =============================
    return res.status(200).json({
      success: true,
      title: article.title || "Untitled",
      domain,
      source,
      wasBlocked: !!wasBlocked,
      wordCount,
      markdown
    });

  } catch (err) {
    console.error("SCRAPE ERROR:", err);

    return res.status(500).json({
      success: false,
      error: err.message || "Server error"
    });
  }
};
