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
// MAIN HANDLER
// -----------------------------
module.exports = async (req, res) => {
  try {

    // =============================
    // 1. AUTH (FIXED + ROBUST)
    // =============================
    const authHeader =
      req.headers.authorization || req.headers.Authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        error: "API key required"
      });
    }

    const apiKey = authHeader.replace("Bearer ", "").trim();

    const user = await validateKey(apiKey);

    if (!user) {
      return res.status(403).json({
        success: false,
        error: "Invalid API key"
      });
    }

    // =============================
    // 2. RATE LIMIT / USAGE LOG
    // =============================
    await supabase.from("usage_logs").insert({
      user_id: user.user_id,
      endpoint: "/api/scrape"
    });

    // =============================
    // 3. DAILY LIMIT RESET
    // =============================
    const today = new Date().toISOString().split("T")[0];

    if (user.last_reset !== today) {
      await supabase
        .from("users")
        .update({
          requests_today: 0,
          last_reset: today
        })
        .eq("id", user.user_id);
    }

    const { data: freshUser } = await supabase
      .from("users")
      .select("*")
      .eq("id", user.user_id)
      .single();

    const LIMITS = {
      free: 20,
      pro: 1000
    };

    const limit = LIMITS[freshUser.plan] || 20;

    if (freshUser.requests_today >= limit) {
      return res.status(429).json({
        success: false,
        error: "Daily limit reached"
      });
    }

    // =============================
    // 4. URL INPUT (FIXED)
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

    // =============================
    // 5. SCRAPE ENGINE
    // =============================
    url = normalizeUrl(url);
    const domain = getDomain(url);

    const { html, source, wasBlocked } = await fetchSmart(url);

    const article = extractContent(html, url);

    if (!article) {
      return res.status(422).json({
        success: false,
        error: "Content unreadable"
      });
    }

    let markdown = turndown.turndown(article.content);
    markdown = cleanMarkdown(markdown);

    const wordCount = getWordCount(article.text);

    // =============================
    // 6. INCREMENT USAGE
    // =============================
    await supabase
      .from("users")
      .update({
        requests_today: freshUser.requests_today + 1
      })
      .eq("id", user.user_id);

    // =============================
    // 7. RESPONSE
    // =============================
    return res.status(200).json({
      success: true,
      title: article.title,
      domain,
      source,
      wasBlocked,
      wordCount,
      markdown
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
};