const {
  normalizeUrl,
  getWordCount,
  cleanMarkdown,
  turndown,
} = require("../../lib/utils");

const { fetchSmart } = require("../../lib/engine");
const { extractContent } = require("../../lib/extractor");
const { checkUsage, logUsage } = require("../../lib/usage");

const FREE_TRIAL_LIMIT = 4;

function getIp(req) {
  const raw =
    req.headers["x-forwarded-for"] ||
    req.socket?.remoteAddress ||
    "unknown";

  return String(raw).split(",")[0].trim();
}

function getDemoId(req) {
  const raw = req.headers["x-demo-id"];
  return raw ? String(raw).trim() : null;
}

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }

  return null;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "x-api-key, x-demo-id, content-type, authorization"
  );
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

  try {
    const contentType = String(req.headers["content-type"] || "");
    if (!contentType.toLowerCase().includes("application/json")) {
      return res.status(415).json({
        success: false,
        error: "Content-Type must be application/json",
      });
    }

    const body = parseBody(req);
    if (!body) {
      return res.status(400).json({
        success: false,
        error: "Invalid JSON body",
      });
    }

    const url = body.url;
    if (!url || typeof url !== "string") {
      return res.status(400).json({
        success: false,
        error: "URL is required",
      });
    }

    const demoId = getDemoId(req);
    const ip = getIp(req);

    const usage = await checkUsage(null, ip, demoId);

    if (usage >= FREE_TRIAL_LIMIT) {
      return res.status(429).json({
        success: false,
        error: "Free trial limit reached. Login to continue.",
      });
    }

    const normalized = normalizeUrl(url);

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Scrape timeout")), 10000)
    );

    let fetchResult;
    try {
      fetchResult = await Promise.race([fetchSmart(normalized), timeout]);
    } catch (err) {
      console.error("FETCH ERROR:", err);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch page",
      });
    }

    const html = fetchResult?.html || "";
    const source = fetchResult?.source || "unknown";
    const wasBlocked = !!fetchResult?.wasBlocked;

    if (!html) {
      return res.status(422).json({
        success: false,
        error: "No HTML returned",
      });
    }

    let article;
    try {
      article = extractContent(html, normalized);
    } catch (err) {
      console.error("EXTRACT ERROR:", err);
      return res.status(500).json({
        success: false,
        error: "Extraction failed",
      });
    }

    if (!article?.content) {
      return res.status(422).json({
        success: false,
        error: "Content unreadable",
      });
    }

    let markdown;
    try {
      markdown = turndown.turndown(article.content);
      markdown = cleanMarkdown(markdown);
    } catch (err) {
      console.error("MARKDOWN ERROR:", err);
      return res.status(500).json({
        success: false,
        error: "Markdown conversion failed",
      });
    }

    if (!markdown || markdown.trim().length < 50) {
      return res.status(422).json({
        success: false,
        error: "Extraction too weak or blocked page",
      });
    }

    await logUsage(null, ip, "/api/demo", demoId);

    return res.status(200).json({
      success: true,
      title: article.title || "Untitled",
      source,
      wasBlocked,
      wordCount: getWordCount(article.text || article.content || ""),
      markdown,
    });
  } catch (err) {
    console.error("DEMO FATAL ERROR:", err);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};
