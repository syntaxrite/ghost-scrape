const {
  validatePublicUrl,
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
const { validateKey } = require("../lib/auth");

const FREE_TRIAL_LIMIT = 3;

function getIp(req) {
  const raw =
    req.headers["x-forwarded-for"] ||
    req.headers["x-real-ip"] ||
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

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return {};
}

const burstCache = Object.create(null);
const BURST_WINDOW = 5000;
const BURST_LIMIT = 2;

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
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "x-api-key, content-type, authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({
      success: false,
      error: "Method not allowed",
    });
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

    const body = parseBody(req);
    const url = body.url || req.query?.url;
    if (!url) {
      return res.status(400).json({
        success: false,
        error: "URL is required",
      });
    }

    const normalized = await validatePublicUrl(url);

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

    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Scrape timeout")), 20000);
    });

    let fetchResult;
    try {
      fetchResult = await Promise.race([fetchSmart(normalized), timeout]);
    } catch (err) {
      return res.status(502).json({
        success: false,
        error: err.message || "Failed to fetch page",
      });
    }

    const html = fetchResult?.html || "";
    const article = extractContent(html, normalized, fetchResult);

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

    let markdown = turndown.turndown(article.content || "");
    markdown = cleanMarkdown(markdown);

    logUsage(validApiKey, ip, "/api/demo").catch((err) => {
      console.error("USAGE LOG (non-blocking) failed:", err);
    });

    return res.status(200).json({
      success: true,
      title: article.title || "Untitled",
      source: fetchResult.source || "unknown",
      sourceType: article.sourceType || fetchResult.sourceType || "generic",
      canonicalUrl: fetchResult.canonicalUrl || normalized,
      wasBlocked: !!fetchResult.wasBlocked,
      markdown: markdown.slice(0, 12000),
      wordCount: getWordCount(article.text || article.content || ""),
      excerpt: article.excerpt || "",
      headings: article.headings || [],
      author: article.author || "",
      publishedAt: article.publishedAt || "",
    });
  } catch (err) {
    console.error("DEMO ERROR FULL:", {
      message: err.message,
      stack: err.stack,
      response: err.response?.data,
    });

    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};
