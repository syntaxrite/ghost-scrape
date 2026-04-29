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

const burstCache = Object.create(null);

const BURST_WINDOW = 5000;
const BURST_LIMIT = 2;
const FREE_TRIAL_LIMIT = 3;

function getIp(req) {
  const raw =
    req.headers["x-forwarded-for"] ||
    req.socket?.remoteAddress ||
    "unknown";

  return String(raw).split(",")[0].trim();
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

async function validateKey(apiKey) {
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
  // CORS (MUST BE INSIDE)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "x-api-key, content-type, authorization");
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
    // RATE LIMIT (BURST)
    // -----------------------------
    const now = Date.now();
    const identifier = validApiKey || ip;

    if (!burstCache[identifier]) {
      burstCache[identifier] = [];
    }

    burstCache[identifier] = burstCache[identifier].filter(
      (t) => now - t < BURST_WINDOW
    );

    if (burstCache[identifier].length >= BURST_LIMIT) {
      return res.status(429).json({
        success: false,
        error: "Too many requests. Slow down.",
      });
    }

    burstCache[identifier].push(now);

    // -----------------------------
    // USAGE LIMITS
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
    const article = extractContent(html, url);

    if (!article || !article.content) {
      return res.status(422).json({
        success: false,
        error: "Could not extract content",
      });
    }

    let markdown = turndown.turndown(article.content);
    markdown = cleanMarkdown(markdown);

    // -----------------------------
    // LOG USAGE
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
      markdown: markdown.slice(0, 8000),
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
