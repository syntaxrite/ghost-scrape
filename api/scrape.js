const { getDomain, fetchSmart } = require("../lib/engine");
const { extractContent } = require("../lib/extractor");
const { getWordCount, cleanMarkdown, turndown, validatePublicUrl } = require("../lib/utils");
const { MONTHLY_LIMIT, checkMonthlyUsage, logUsage } = require("../lib/usage");
const { validateKey } = require("../lib/auth");
const { getApiKey, getClientIp, parseJsonBody } = require("../lib/request");

const BURST_WINDOW = 5000;
const BURST_LIMIT = 3;
const burstCache = Object.create(null);

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

async function parseUrlFromRequest(req) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return null;
  }

  const body = parseJsonBody(req);
  return typeof body?.url === "string" ? body.url.trim() : "";
}

module.exports = async (req, res) => {
  const startTime = Date.now();
  let shouldCount = false;
  let apiKey = null;
  let ip = "unknown";
  let normalized = "";
  let domain = "";
  let record = null;

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Headers", "x-api-key, content-type, authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    apiKey = getApiKey(req);
    ip = getClientIp(req);

    if (hitBurstLimit(burstKey(apiKey, ip))) {
      return res.status(429).json({ success: false, error: "Too many requests. Slow down." });
    }

    if (!apiKey) {
      return res.status(401).json({ success: false, error: "API key required" });
    }

    const keyRow = await validateKey(apiKey);
    if (!keyRow) {
      return res.status(403).json({ success: false, error: "Invalid API key" });
    }

    const monthlyUsed = await checkMonthlyUsage(apiKey, ip);
    if (monthlyUsed >= MONTHLY_LIMIT) {
      return res.status(429).json({ success: false, error: `Monthly limit reached (${MONTHLY_LIMIT}/month)` });
    }

    const url = await parseUrlFromRequest(req);
    if (!url) {
      return res.status(400).json({ success: false, error: "URL is required" });
    }

    normalized = await validatePublicUrl(url);
    domain = getDomain(normalized);
    shouldCount = true;

    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Scrape timeout")), 25000);
    });

    let fetchResult;
    try {
      fetchResult = await Promise.race([fetchSmart(normalized), timeout]);
    } catch (err) {
      return res.status(502).json({ success: false, error: err.message || "Failed to fetch page" });
    }

    const html = fetchResult?.html || "";
    if (!html) {
      return res.status(422).json({ success: false, error: "No HTML returned" });
    }

    record = extractContent(html, normalized, fetchResult);
    if (!record) {
      return res.status(422).json({ success: false, error: "Could not extract content" });
    }

    if (record.protected) {
      return res.status(422).json({ success: false, error: record.reason || "Protected or login wall" });
    }

    let markdown = turndown.turndown(record.content || "");
    markdown = cleanMarkdown(markdown).slice(0, 20000);

    return res.status(200).json({
      success: true,
      title: record.title || "Untitled",
      domain,
      canonicalUrl: fetchResult.canonicalUrl || normalized,
      source: fetchResult.source || "unknown",
      sourceType: record.sourceType || fetchResult.sourceType || "generic",
      wasBlocked: !!fetchResult.wasBlocked,
      wordCount: getWordCount(record.text || markdown),
      excerpt: record.excerpt || "",
      headings: record.headings || [],
      author: record.author || "",
      publishedAt: record.publishedAt || "",
      duration_ms: Date.now() - startTime,
      monthlyLimit: MONTHLY_LIMIT,
      markdown,
    });
  } catch (err) {
    console.error("SCRAPE ERROR FULL:", {
      message: err.message,
      stack: err.stack,
      url: normalized,
      domain,
    });

    return res.status(500).json({ success: false, error: err.message || "Server error" });
  } finally {
    if (shouldCount && apiKey) {
      logUsage(apiKey, ip, "/api/scrape", { url: normalized, domain, source: record?.sourceType || null }).catch((err) => {
        console.error("USAGE LOG FAILED:", err);
      });
    }
  }
};
