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
  const { data, error } = await supabase
    .from("api_keys")
    .select("*")
    .eq("key", key)
    .single();

  if (error || !data) return null;
  return data;
}

// -----------------------------
// Extract Bearer Token Safely
// -----------------------------
function getApiKey(req) {
  const auth =
    req.headers?.authorization ||
    req.headers?.Authorization;

  if (!auth) return null;

  if (auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }

  return auth.trim();
}

// -----------------------------
// MAIN HANDLER (Vercel Serverless)
// -----------------------------
module.exports = async (req, res) => {
  try {
    // 🔍 DEBUG (IMPORTANT - keep for now)
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

    const keyRow = await validateKey(apiKey);

    if (!keyRow) {
      return res.status(403).json({
        success: false,
        error: "Invalid API key"
      });
    }

    const userId = keyRow.user_id;

    if (!userId) {
      return res.status(500).json({
        success: false,
        error: "API key not linked to user"
      });
    }

    // =============================
    // 2. URL INPUT (SERVERLESS SAFE)
    // =============================
    let url =
      req.body?.url ||
      req.query?.url;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "URL required"
      });
    }

    url = normalizeUrl(url);
    const domain = getDomain(url);

    // =============================
    // 3. SCRAPE ENGINE (Browserless safe)
    // =============================
    const { html, source, wasBlocked } = await fetchSmart(url);

    const article = extractContent(html, url);

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
    }).then().catch(console.error);

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
      error: err.message || "Internal server error"
    });
  }
};