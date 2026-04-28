const { normalizeUrl, getWordCount, cleanMarkdown, turndown } = require("../lib/utils");
const { getDomain, getSiteType, fetchSmart, shouldRetry } = require("../lib/engine");
const { extractGeneric } = require("../lib/extractor");

module.exports = async (req, res) => {
  let { url, mode } = req.query;
  
  try {
    url = normalizeUrl(url);
    const domain = getDomain(url);
    const siteType = getSiteType(domain);

    // 1. Initial Fetch
    let { html, source } = await fetchSmart(url, mode === "browser");

    // 2. Extraction
    let article = extractGeneric(html, url);
    let wordCount = getWordCount(article?.textContent);

    // 3. Smart Retry (If content is thin, try Browserless)
    if (shouldRetry(article, source, wordCount)) {
      const retry = await fetchSmart(url, true);
      const retryArticle = extractGeneric(retry.html, url);
      const retryCount = getWordCount(retryArticle?.textContent);

      if (retryCount > wordCount) {
        article = retryArticle;
        source = "browserless-retry";
        wordCount = retryCount;
      }
    }

    if (!article || !article.content) {
      return res.status(422).json({ success: false, error: "Failed to extract content" });
    }

    // 4. Final Formatting for LLM
    const markdown = cleanMarkdown(turndown.turndown(article.content));

    return res.status(200).json({
      success: true,
      title: article.title,
      domain,
      siteType,
      wordCount,
      source,
      markdown
    });

  } catch (err) {
    console.error("Scrape Error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};