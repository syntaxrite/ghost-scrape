const {
  normalizeUrl,
  getWordCount,
  cleanMarkdown,
  turndown,
} = require("../lib/utils");

const { fetchSmart } = require("../lib/engine");
const { extractContent } = require("../lib/extractor");
const {
  checkUsage,
  checkMonthlyUsage,
  logUsage,
  DAILY_LIMIT,
  MONTHLY_LIMIT,
} = require("../lib/usage");

const supabase = require("../lib/supabase");

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
  const raw = req.headers.authorization || req.headers.Authorization || "";
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
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

function burstKey(apiKey, ip) {
  return apiKey || ip || "unknown";
}

function hitBurstLimit(identifier) {
  const now = Date.now();
  if (!burstCache[identifier]) burstCache[identifier] = [];

  burstCache[identifier] = burstCache[identifier].filter((t) => now - t < BURST_WINDOW);

  if (burstCache[identifier].length >= BURST_LIMIT) return true;

  burstCache[identifier].push(now);
  return false;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "x-api-key, content-type, authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const ip = getIp(req);
    const apiKey = getApiKeyFromHeader(req);

    const identifier = burstKey(apiKey, ip);
    if (hitBurstLimit(identifier)) {
      return res.status(429).json({
        success: false,
        error: "Too many requests. Slow down.",
      });
    }

    let url = req.body?.url || req.query?.url;
    if (!url) {
      return res.status(400).json({
        success: false,
        error: "URL is required",
      });
    }

    url = normalizeUrl(url);

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

    // Free trial or authenticated usage
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

    const monthlyUsage = validApiKey ? await checkMonthlyUsage(validApiKey, ip) : 0;
    if (validApiKey && monthlyUsage >= MONTHLY_LIMIT) {
      return res.status(429).json({
        success: false,
        error: `Monthly limit reached (${MONTHLY_LIMIT}/month)`,
      });
    }

    // Count the attempt after passing limits
    await logUsage(validApiKey, ip, "/api/demo");

    const { html, source, wasBlocked, sourceType, canonicalUrl } = await fetchSmart(url);
    const article = extractContent(html, url, { sourceType, canonicalUrl });

    if (!article) {
      return res.status(422).json({
        success: false,
        error: "Could not extract content",
      });
    }

    if (article.protected) {
      return res.status(422).json({
        success: false,
        error: article.reason || "Protected or login wall",
      });
    }

    let markdown = turndown.turndown(article.content);
    markdown = cleanMarkdown(markdown);

    return res.status(200).json({
      success: true,
      title: article.title || "Untitled",
      source,
      sourceType: article.sourceType || sourceType || "generic",
      canonicalUrl: canonicalUrl || url,
      wasBlocked: !!wasBlocked,
      markdown: markdown.slice(0, 12000),
      wordCount: getWordCount(article.text || article.content || ""),
      excerpt: article.excerpt || "",
      headings: article.headings || [],
      author: article.author || "",
      publishedAt: article.publishedAt || "",
    });
  } catch (err) {
    console.error("DEMO ERROR:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error",
    });
  }
};
