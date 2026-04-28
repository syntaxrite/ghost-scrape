const { normalizeUrl, getWordCount, cleanMarkdown, turndown } = require("../lib/utils");
const { fetchSmart } = require("../lib/engine");
const { extractContent } = require("../lib/extractor");
const supabase = require("../lib/supabase");

let lastRequestTime = {};

module.exports = async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  const now = Date.now();

  const apiKey = req.headers["x-api-key"];

  try {
    let user = null;

    // =========================
    // 🔑 AUTH FLOW (if API key exists)
    // =========================
    if (apiKey) {
      const { data: keyData, error: keyError } = await supabase
        .from("api_keys")
        .select("user_id")
        .eq("key", apiKey)
        .single();

      if (keyError || !keyData) {
        return res.status(401).json({
          success: false,
          error: "Invalid API key"
        });
      }

      const { data: userData } = await supabase
        .from("users")
        .select("*")
        .eq("id", keyData.user_id)
        .single();

      user = userData;

      // 💳 CREDIT CHECK
      if (!user || user.credits <= 0) {
        return res.status(403).json({
          success: false,
          error: "No credits left"
        });
      }
    }

    // =========================
    // 🚫 DEMO RATE LIMIT (only if NO API key)
    // =========================
    if (!apiKey) {
      if (lastRequestTime[ip] && now - lastRequestTime[ip] < 60000) {
        return res.status(429).json({
          success: false,
          error: "Demo limit: 1 request per minute"
        });
      }

      lastRequestTime[ip] = now;
    }

    // =========================
    // 🌐 SCRAPING LOGIC (unchanged)
    // =========================
    let { url } = req.query;
    url = normalizeUrl(url);

    const { html, source, wasBlocked } = await fetchSmart(url);
    const article = extractContent(html, url);

    if (!article) {
      return res.status(422).json({ success: false });
    }

    let markdown = turndown.turndown(article.content);
    markdown = cleanMarkdown(markdown);

    // =========================
    // 💸 DEDUCT CREDIT (only for API users)
    // =========================
    if (apiKey && user) {
      await supabase
        .from("users")
        .update({ credits: user.credits - 1 })
        .eq("id", user.id);
    }

    return res.status(200).json({
      success: true,
      title: article.title,
      source,
      markdown: markdown.slice(0, 8000),
      wordCount: getWordCount(article.text),
      creditsLeft: user ? user.credits - 1 : null
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
};