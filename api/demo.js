const { normalizeUrl, getWordCount, cleanMarkdown, turndown } = require("../lib/utils");
const { getDomain, fetchSmart } = require("../lib/engine");
const { extractContent } = require("../lib/extractor");

let lastRequestTime = {};

module.exports = async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || "unknown";
  const now = Date.now();

  // RATE LIMIT (1 request per 60 seconds per IP)
  if (lastRequestTime[ip] && now - lastRequestTime[ip] < 60000) {
    return res.status(429).json({
      success: false,
      error: "Demo limit: 1 request per minute"
    });
  }

  lastRequestTime[ip] = now;

  let { url } = req.query;

  try {
    url = normalizeUrl(url);

    const { html, source, wasBlocked } = await fetchSmart(url);
    const article = extractContent(html, url);

    if (!article) {
      return res.status(422).json({ success: false });
    }

    let markdown = turndown.turndown(article.content);
    markdown = cleanMarkdown(markdown);

    return res.status(200).json({
      success: true,
      title: article.title,
      source,
      markdown: markdown.slice(0, 8000), // IMPORTANT LIMIT
      wordCount: getWordCount(article.text)
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};