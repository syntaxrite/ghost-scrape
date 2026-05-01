const supabase = require("../lib/supabase");

const {
  normalizeUrl,
  getWordCount,
  cleanMarkdown,
  turndown,
} = require("../lib/utils");

const { getDomain, fetchSmart } = require("../lib/engine");
const { extractContent } = require("../lib/extractor");

const {
  checkUsage,
  checkMonthlyUsage,
  logUsage,
  DAILY_LIMIT,
  MONTHLY_LIMIT,
} = require("../lib/usage");

// -----------------------------
// HELPERS
// -----------------------------
function getApiKey(req) {
  const auth =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    req.headers?.["x-api-key"];

  if (!auth || typeof auth !== "string") return null;

  if (auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }

  return auth.trim();
}

function getIp(req) {
  const raw =
    req.headers["x-forwarded-for"] ||
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
      return null;
    }
  }

  return null;
}

// -----------------------------
// FIXED VALIDATE KEY
// -----------------------------
async function validateKey(apiKey) {
  if (!apiKey) return null;

  const cleanKey = apiKey.trim();

  console.log("API KEY RECEIVED:", cleanKey);

  const { data, error } = await supabase
    .from("api_keys")
    .select("*")
    .eq("key", cleanKey)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("API KEY ERROR:", error);
    return null;
  }

  if (!data) {
    console.log("API KEY NOT FOUND:", cleanKey);
  } else {
    console.log("API KEY VALID:", cleanKey);
  }

  return data || null;
}

// -----------------------------
// MAIN HANDLER
// -----------------------------
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "x-api-key, content-type, authorization"
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
    console.log("SCRAPE START");

    // -----------------------------
    // AUTH
    // -----------------------------
    const apiKey = getApiKey(req);

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
        error: "User not linked to API key",
      });
    }

    const ip = getIp(req);

    // -----------------------------
    // USAGE LIMITS (SAFE)
    // -----------------------------
    let dailyUsage = 0;
    let monthlyUsage = 0;

    try {
      dailyUsage = await checkUsage(apiKey, ip, null);
      monthlyUsage = await checkMonthlyUsage(apiKey);
    } catch (err) {
      console.error("USAGE SYSTEM ERROR:", err);
    }

    if (dailyUsage >= DAILY_LIMIT) {
      return res.status(429).json({
        success: false,
        error: `Daily limit reached (${DAILY_LIMIT}/day)`,
      });
    }

    if (monthlyUsage >= MONTHLY_LIMIT) {
      return res.status(429).json({
        success: false,
        error: `Monthly limit reached (${MONTHLY_LIMIT}/month)`,
      });
    }

    // -----------------------------
    // INPUT
    // -----------------------------
    const contentType = String(req.headers["content-type"] || "");
    if (!contentType.toLowerCase().includes("application/json")) {
      return res.status(415).json({
        success: false,
        error: "Content-Type must be application/json",
      });
    }

    const body = parseBody(req);
    console.log("BODY:", body);

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
        error: "Valid URL required",
      });
    }

    const normalized = normalizeUrl(url);
    const domain = getDomain(normalized);

    console.log("SCRAPING URL:", normalized);

    // -----------------------------
    // FETCH
    // -----------------------------
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Scrape timeout")), 10000)
    );

    let fetchResult;

    try {
      fetchResult = await Promise.race([
        fetchSmart(normalized),
        timeout,
      ]);
    } catch (err) {
      console.error("FETCH ERROR:", err);
      return res.status(500).json({
        success: false,
        error: err.message || "Failed to fetch page",
      });
    }

    const html = fetchResult?.html || "";
    const source = fetchResult?.source || "unknown";
    const wasBlocked = !!fetchResult?.wasBlocked;

    console.log("FETCH RESULT:", {
      htmlLength: html.length,
      source,
      wasBlocked,
    });

    if (!html) {
      return res.status(422).json({
        success: false,
        error: "No HTML returned",
      });
    }

    // -----------------------------
    // EXTRACT
    // -----------------------------
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

    // -----------------------------
    // MARKDOWN
    // -----------------------------
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

    // -----------------------------
    // LOG USAGE
    // -----------------------------
    try {
      await logUsage(apiKey, ip, "/api/scrape", null);
    } catch (err) {
      console.error("LOG USAGE ERROR:", err);
    }

    // -----------------------------
    // RESPONSE
    // -----------------------------
    return res.status(200).json({
      success: true,
      title: article.title || "Untitled",
      domain,
      source,
      wasBlocked,
      wordCount: getWordCount(article.text || article.content || ""),
      markdown,
    });

  } catch (err) {
    console.error("SCRAPE FATAL ERROR:", err);

    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error",
    });
  }
};
