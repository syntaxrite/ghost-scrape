const { normalizeUrl, getWordCount, cleanMarkdown, turndown } = require("../lib/utils");
const { getDomain, fetchSmart } = require("../lib/engine");
const { extractContent } = require("../lib/extractor");

module.exports = async (req, res) => {
  let { url } = req.query;

  try {
    // 1. Prepare
    url = normalizeUrl(url);
    const domain = getDomain(url);

    // 2. Smart Fetch
    const { html, source, wasBlocked } = await fetchSmart(url);

    // 3. Extract Core Content
    const article = extractContent(html, url);
    if (!article) return res.status(422).json({ success: false, error: "Content unreadable" });

    // 4. Convert to LLM-ready Markdown
    let markdown = turndown.turndown(article.content);
    markdown = cleanMarkdown(markdown);

    const wordCount = getWordCount(article.text);

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
    return res.status(500).json({ success: false, error: err.message });
  }
};