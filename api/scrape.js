const supabase = require("../lib/supabase");

const { normalizeUrl, getWordCount, cleanMarkdown, turndown } = require("../lib/utils");
const { getDomain, fetchSmart } = require("../lib/engine");
const { extractContent } = require("../lib/extractor");

async function validateKey(key) {
  const { data, error } = await supabase
    .from("api_keys")
    .select("*")
    .eq("key", key)
    .single();

  if (error) return null;
  return data;
}

module.exports = async (req, res) => {
  try {
    // -----------------------------
    // 1. GET API KEY
    // -----------------------------
    const apiKey = req.headers["x-api-key"];

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: "API key required"
      });
    }

    const user = await validateKey(apiKey);

    if (!user) {
      return res.status(403).json({
        success: false,
        error: "Invalid API key"
      });
    }

    // -----------------------------
    // Log usage after API key validation
    await supabase.from("usage_logs").insert({
      user_id: user.user_id,
      endpoint: "/api/scrape"
    });

    // 2. GET URL
    // -----------------------------
    let { url } = req.query;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "URL required"
      });
    }

    // -----------------------------
    // 3. PROCESS URL
    // -----------------------------
    url = normalizeUrl(url);
    const domain = getDomain(url);

    const { html, source, wasBlocked } = await fetchSmart(url);

    const article = extractContent(html, url);

    if (!article) {
      return res.status(422).json({
        success: false,
        error: "Content unreadable"
      });
    }

    let markdown = turndown.turndown(article.content);
    markdown = cleanMarkdown(markdown);

    const wordCount = getWordCount(article.text);

    // -----------------------------
    // 4. RESPONSE
    // -----------------------------
    return res.status(200).json({
      success: true,
      title: article.title,
      domain,
      source,
      wasBlocked,
      wordCount,
      markdown
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
};