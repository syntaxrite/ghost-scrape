const { normalizeUrl, getWordCount, cleanMarkdown, turndown } = require("../lib/utils");
const { fetchSmart } = require("../lib/engine");
const { extractContent } = require("../lib/extractor");
const { checkUsage, logUsage, DAILY_LIMIT } = require("../lib/usage");
const supabase = require("../lib/supabase");
const rawIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
const ip = rawIp.split(",")[0].trim();

// ⚡ simple in-memory burst protection
const burstCache = {};

const BURST_WINDOW = 5000; // 5 sec
const BURST_LIMIT = 2;

module.exports = async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  const apiKey = req.headers["x-api-key"] || null;

  try {
    // -------------------------
    // 🧠 BASIC INPUT VALIDATION
    // -------------------------
    let { url } = req.query;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "URL is required"
      });
    }

    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({
        success: false,
        error: "Invalid URL format"
      });
    }

    url = normalizeUrl(url);

    // -------------------------
    // 🔐 VALIDATE API KEY
    // -------------------------
    let validApiKey = null;

    if (apiKey) {
      const { data, error } = await supabase
        .from("api_keys")
        .select("key, user_id")
        .eq("key", apiKey)
        .maybeSingle();

      if (error || !data) {
        return res.status(401).json({
          success: false,
          error: "Invalid API key"
        });
      }

      validApiKey = data.key;
    }

    // -------------------------
    // ⚡ BURST PROTECTION
    // -------------------------
    const now = Date.now();
    const identifier = validApiKey || ip;

    if (!burstCache[identifier]) {
      burstCache[identifier] = [];
    }

    // keep only recent timestamps
    burstCache[identifier] = burstCache[identifier].filter(
      (t) => now - t < BURST_WINDOW
    );

    if (burstCache[identifier].length >= BURST_LIMIT) {
      return res.status(429).json({
        success: false,
        error: "Too many requests. Slow down."
      });
    }

    burstCache[identifier].push(now);

    // -------------------------
    // 📊 USAGE LIMITS
    // -------------------------
    const usage = await checkUsage(validApiKey, ip);

    if (!validApiKey && usage >= 1) {
      return res.status(429).json({
        success: false,
        error: "Free limit reached (1 request). Login to continue."
      });
    }

    if (validApiKey && usage >= DAILY_LIMIT) {
      return res.status(429).json({
        success: false,
        error: `Daily limit reached (${DAILY_LIMIT}/day)`
      });
    }

    // -------------------------
    // 🌐 FETCH + EXTRACT
    // -------------------------
    const { html, source, wasBlocked } = await fetchSmart(url);
    const article = extractContent(html, url);

    if (!article || !article.content) {
      return res.status(422).json({
        success: false,
        error: "Could not extract content"
      });
    }

    let markdown = turndown.turndown(article.content);
    markdown = cleanMarkdown(markdown);

    // -------------------------
    // 🧾 LOG USAGE
    // -------------------------
    await logUsage(validApiKey, ip);

    // -------------------------
    // ✅ RESPONSE
    // -------------------------
    return res.status(200).json({
      success: true,
      title: article.title || "Untitled",
      source,
      wasBlocked: !!wasBlocked,
      markdown: markdown.slice(0, 8000),
      wordCount: getWordCount(article.text)
    });

  } catch (err) {
    console.error("DEMO ERROR:", err);

    return res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
};