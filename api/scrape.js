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

// -----------------------------
// Validate API Key
// -----------------------------
async function validateKey(key) {
  if (!key) return null;

  const { data, error } = await supabase
    .from("api_keys")
    .select("*")
    .eq("key", key)
    .maybeSingle();

  if (error) {
    console.error("API KEY ERROR:", error);
    return null;
  }

  return data || null;
}

// -----------------------------
// Extract API key safely
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

// -----------------------------
// Parse request body safely
// -----------------------------
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

// -----------------------------
// MAIN HANDLER
// -----------------------------
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "x-api-key, content-type, authorization"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    console.log({
      event: "SCRAPE_START",
      method: req.method,
      origin: req.headers.origin || null,
    });

    // -----------------------------
    // 1. AUTH
    // -----------------------------
    const apiKey = getApiKey(req);

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

    const userId = user.user_id;

    if (!userId) {
      return res.status(500).json({
        success: false,
        error: "User not linked to API key",
      });
    }

    // -----------------------------
    // 2. INPUT URL
    // -----------------------------
    const body = parseBody(req);
    const url = body.url || req.query?.url;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "URL required",
      });
    }

    const normalized = normalizeUrl(url);
    const domain = getDomain(normalized);

    // -----------------------------
    // 3. SCRAPE WITH TIMEOUT
    // -----------------------------
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Scrape timeout")), 10000);
    });

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

    if (!html) {
      return res.status(422).json({
        success: false,
        error: "No HTML returned",
      });
    }

    // -----------------------------
    // 4. EXTRACT CONTENT
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
    // 5. CONVERT TO MARKDOWN
    // -----------------------------
    let markdown = turndown.turndown(article.content);
    markdown = cleanMarkdown(markdown);

    const wordCount = getWordCount(
      article?.text || article?.content || ""
    );

    // -----------------------------
    // 6. LOG USAGE (NON-BLOCKING)
    // -----------------------------
    try {
      const { error: usageError } = await supabase
        .from("usage_log")
        .insert({
          user_id: userId,
          endpoint: "/api/scrape",
        });

      if (usageError) {
        console.error("USAGE LOG ERROR:", usageError);
      }
    } catch (err) {
      console.error("USAGE LOG EXCEPTION:", err);
    }

    // -----------------------------
    // 7. RESPONSE
    // -----------------------------
    return res.status(200).json({
      success: true,
      title: article.title || "Untitled",
      domain,
      source,
      wasBlocked,
      wordCount,
      markdown,
    });
  } catch (err) {
    console.error("SCRAPE ERROR:", err);

    return res.status(500).json({
      success: false,
      error: err.message || "Server error",
    });
  }
};