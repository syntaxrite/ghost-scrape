const {
  normalizeUrl,
  getWordCount,
  cleanMarkdown,
  turndown,
} = require("../../lib/utils");

const { fetchSmart } = require("../../lib/engine");
const { extractContent } = require("../../lib/extractor");
const { checkUsage, logUsage, DAILY_LIMIT } = require("../../lib/usage");
const supabase = require("../../lib/supabase");

const FREE_TRIAL_LIMIT = 3;

// -----------------------------
// IP helper
// -----------------------------
function getIp(req) {
  return (
    req.headers["x-forwarded-for"] ||
    req.socket?.remoteAddress ||
    "unknown"
  )
    .toString()
    .split(",")[0]
    .trim();
}

// -----------------------------
// API key helper
// -----------------------------
function getApiKeyFromHeader(req) {
  const raw = req.headers.authorization || "";
  const value = String(raw).trim();

  if (!value) return null;

  if (/^bearer\s+/i.test(value)) {
    return value.replace(/^bearer\s+/i, "").trim();
  }

  return value;
}

// -----------------------------
// Validate API key
// -----------------------------
async function validateKey(apiKey) {
  if (!apiKey) return null;

  const { data, error } = await supabase
    .from("api_keys")
    .select("key, user_id")
    .eq("key", apiKey)
    .single();

  if (error || !data) return null;
  return data;
}

// -----------------------------
// MAIN HANDLER
// -----------------------------
module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "x-api-key, content-type, authorization"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const ip = getIp(req);
    const apiKey = getApiKeyFromHeader(req);

    let url = req.body?.url || req.query?.url;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "URL is required",
      });
    }

    url = normalizeUrl(url);

    // -----------------------------
    // AUTH CHECK
    // -----------------------------
    let validApiKey = null;

    if (apiKey) {
      const keyRow = await validateKey(apiKey);

      if (!keyRow) {
        return res.status(401).json({
          success: false,
          error: "Invalid API key",
        });
      }

      validApiKey = keyRow.key;
    }

    // -----------------------------
    // USAGE CHECK (IMPORTANT FIX)
    // -----------------------------
    const usage = await checkUsage(validApiKey, ip);

    if (!validApiKey && usage >= FREE_TRIAL_LIMIT) {
      return res.status(429).json({
        success: false,
        error: "Free trial limit reached. Login to continue.",
      });
    }

    if (validApiKey && usage >= DAILY_LIMIT) {
      return res.status(429).json({
        success: false,
        error: `Daily limit reached (${DAILY_LIMIT}/day)`,
      });
    }

    // -----------------------------
    // SCRAPE
    // -----------------------------
    const { html, source, wasBlocked } = await fetchSmart(url);

    if (!html) {
      return res.status(422).json({
        success: false,
        error: "Failed to fetch page",
      });
    }

    const article = extractContent(html, url);

    if (!article?.content) {
      return res.status(422).json({
        success: false,
        error: "Content unreadable",
      });
    }

    let markdown = turndown.turndown(article.content);
    markdown = cleanMarkdown(markdown);

    if (!markdown || markdown.trim().length < 50) {
      return res.status(422).json({
        success: false,
        error: "Extraction too weak or blocked page",
      });
    }

    // -----------------------------
    // LOG USAGE (AFTER SUCCESS ONLY)
    // -----------------------------
    await logUsage(validApiKey, ip);

    // -----------------------------
    // RESPONSE
    // -----------------------------
    return res.status(200).json({
      success: true,
      title: article.title || "Untitled",
      source,
      wasBlocked: !!wasBlocked,
      markdown,
      wordCount: getWordCount(article.text || article.content || ""),
    });
  } catch (err) {
    console.error("DEMO ERROR:", err);

    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};
