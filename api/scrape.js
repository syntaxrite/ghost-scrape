const supabase = require("../lib/supabase");
const {
  validatePublicUrl,
  getWordCount,
  cleanMarkdown,
  turndown,
} = require("../lib/utils");

const { getDomain, fetchSmart } = require("../lib/engine");
const { extractContent } = require("../lib/extractor");
const {
  logUsage,
  checkUsage,
  checkMonthlyUsage,
  DAILY_LIMIT,
  MONTHLY_LIMIT,
} = require("../lib/usage");
const { validateKey } = require("../lib/auth");

function getApiKey(req) {
  const auth =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    req.headers?.["x-api-key"];

  if (!auth || typeof auth !== "string") return null;

  if (/^bearer\s+/i.test(auth)) {
    return auth.slice(7).trim();
  }

  return auth.trim();
}

function getIp(req) {
  const raw =
    req.headers["x-forwarded-for"] ||
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "unknown";

  return String(raw).split(",")[0].trim();
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
const BURST_LIMIT = 3;

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
  const startTime = Date.now();

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Headers", "x-api-key, content-type, authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed",
    });
  }

  let apiKey = null;
  let ip = "unknown";
  let normalized = "";
  let domain = "";

  try {
    apiKey = getApiKey(req);
    ip = getIp(req);

    const identifier = burstKey(apiKey, ip);
    if (hitBurstLimit(identifier)) {
      return res.status(429).json({
        success: false,
        error: "Too many requests. Slow down.",
      });
    }

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: "API key required",
      });
    }

    const user = await validateKey(apiKey);
    if (!user) {
      return res.status(403).json({
        success: false,
        error: "Invalid API key",
      });
    }

    const dailyUsed = await checkUsage(apiKey, ip);
    if (dailyUsed >= DAILY_LIMIT) {
      return res.status(429).json({
        success: false,
        error: `Daily limit reached (${DAILY_LIMIT}/day)`,
      });
    }

    const monthlyUsed = await checkMonthlyUsage(apiKey, ip);
    if (monthlyUsed >= MONTHLY_LIMIT) {
      return res.status(429).json({
        success: false,
        error: `Monthly limit reached (${MONTHLY_LIMIT}/month)`,
      });
    }

    const contentType = String(req.headers["content-type"] || "");
    if (!contentType.toLowerCase().includes("application/json")) {
      return res.status(415).json({
        success: false,
        error: "Content-Type must be application/json",
      });
    }

    const body = parseBody(req);
    if (!body.url) {
      return res.status(400).json({
        success: false,
        error: "URL required",
      });
    }

    normalized = await validatePublicUrl(body.url);
    domain = getDomain(normalized);

    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Scrape timeout")), 20000);
    });

    let fetchResult;
    try {
      fetchResult = await Promise.race([fetchSmart(normalized), timeout]);
    } catch (err) {
      console.error("FETCH ERROR:", err);
      return res.status(502).json({
        success: false,
        error: err.message || "Failed to fetch page",
      });
    }

    const html = fetchResult?.html || "";
    if (!html) {
      return res.status(422).json({
        success: false,
        error: "No HTML returned",
      });
    }

    const article = extractContent(html, normalized, fetchResult);
    if (!article) {
      return res.status(422).json({
        success: false,
        error: "Content unreadable",
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

    logUsage(apiKey, ip, "/api/scrape").catch((err) => {
      console.error("USAGE LOG FAILED:", err);
    });

    return res.status(200).json({
      success: true,
      title: article.title || "Untitled",
      domain,
      canonicalUrl: fetchResult.canonicalUrl || normalized,
      source: fetchResult.source || "unknown",
      sourceType: article.sourceType || fetchResult.sourceType || "generic",
      wasBlocked: !!fetchResult.wasBlocked,
      wordCount: getWordCount(article.text || ""),
      excerpt: article.excerpt || "",
      headings: article.headings || [],
      author: article.author || "",
      publishedAt: article.publishedAt || "",
      duration_ms: Date.now() - startTime,
      markdown,
    });
  } catch (err) {
    console.error("SCRAPE ERROR FULL:", {
      message: err.message,
      stack: err.stack,
      url: normalized,
      domain,
    });

    return res.status(500).json({
      success: false,
      error: err.message || "Server error",
    });
  }
};
