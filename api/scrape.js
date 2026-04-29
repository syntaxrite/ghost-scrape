const supabase = require("../lib/supabase");

const {
  normalizeUrl,
  getWordCount,
  cleanMarkdown,
  turndown,
} = require("../lib/utils");

const {
  getDomain,
  fetchSmart,
} = require("../lib/engine");

const {
  extractContent,
} = require("../lib/extractor");

async function validateKey(key) {
  const { data, error } = await supabase
    .from("api_keys")
    .select("*")
    .eq("key", key)
    .single();

  if (error || !data) return null;
  return data;
}

function getApiKeyFromHeader(req) {
  const raw =
    req.headers.authorization ||
    req.headers.Authorization ||
    "";

  const value = String(raw).trim();

  if (!value) return null;

  if (/^bearer\s+/i.test(value)) {
    return value.replace(/^bearer\s+/i, "").trim();
  }

  return value;
}

module.exports = async (req, res) => {
  try {
    const apiKey = getApiKeyFromHeader(req);

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: "API key required",
      });
    }

    const keyRow = await validateKey(apiKey);

    if (!keyRow) {
      return res.status(403).json({
        success: false,
        error: "Invalid API key",
      });
    }

    const userId = keyRow.user_id;
    if (!userId) {
      return res.status(500).json({
        success: false,
        error: "API key is not linked to a user",
      });
    }

    const { data: userRow, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (userError || !userRow) {
      return res.status(403).json({
        success: false,
        error: "User not found",
      });
    }

    const today = new Date().toISOString().split("T")[0];

    if (userRow.last_reset !== today) {
      const { error: resetError } = await supabase
        .from("users")
        .update({
          requests_today: 0,
          last_reset: today,
        })
        .eq("id", userId);

      if (resetError) {
        return res.status(500).json({
          success: false,
          error: "Failed to reset usage",
        });
      }

      userRow.requests_today = 0;
      userRow.last_reset = today;
    }

    const LIMITS = {
      free: 20,
      pro: 1000,
    };

    const plan = String(userRow.plan || "free").toLowerCase();
    const limit = LIMITS[plan] ?? LIMITS.free;

    if ((userRow.requests_today || 0) >= limit) {
      return res.status(429).json({
        success: false,
        error: "Daily limit reached",
      });
    }

    const url = req.body?.url || req.query?.url;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "URL required",
      });
    }

    const normalizedUrl = normalizeUrl(url);
    const domain = getDomain(normalizedUrl);

    const { html, source, wasBlocked } = await fetchSmart(normalizedUrl);

    const article = extractContent(html, normalizedUrl);

    if (!article || !article.content) {
      return res.status(422).json({
        success: false,
        error: "Content unreadable",
      });
    }

    let markdown = turndown.turndown(article.content);
    markdown = cleanMarkdown(markdown);

    const wordCount = getWordCount(article.text || article.content || "");

    const { error: usageError } = await supabase
      .from("usage_logs")
      .insert({
        user_id: userId,
        endpoint: "/api/scrape",
      });

    if (usageError) {
      console.error("Usage log error:", usageError.message);
    }

    const { error: incrementError } = await supabase
      .from("users")
      .update({
        requests_today: (userRow.requests_today || 0) + 1,
      })
      .eq("id", userId);

    if (incrementError) {
      console.error("Usage increment error:", incrementError.message);
    }

    return res.status(200).json({
      success: true,
      title: article.title || "Untitled",
      domain,
      source,
      wasBlocked: !!wasBlocked,
      wordCount,
      markdown,
    });
  } catch (err) {
    console.error("SCRAPE ERROR:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error",
    });
  }
};