const { fetchSmart, getDomain, getSiteType, isHomepage, shouldRetry, getWordCount } = require("../lib/engine");
const { runExtractor } = require("../lib/extractors");
const { cleanMarkdown } = require("../lib/utils"); // Added this
// ... rest of the code
const TurndownService = require("turndown");
const { gfm } = require("turndown-plugin-gfm");

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" }).use(gfm);

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  let { url } = req.query;
  if (!url) return res.status(400).json({ error: "URL required" });

  try {
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    if (isHomepage(url)) return res.status(400).json({ error: "Homepages not supported" });

    const domain = getDomain(url);
    const siteType = getSiteType(domain);

    // Initial Fetch
    let { html, source } = await fetchSmart(url);
    let article = runExtractor(siteType, html, url);

    // Smart Retry
    if (shouldRetry(article, source)) {
      const retry = await fetchSmart(url, { forceBrowser: true });
      const retryArticle = runExtractor(siteType, retry.html, url);
      
      if (getWordCount(retryArticle?.textContent) > getWordCount(article?.textContent)) {
        article = retryArticle;
        source = retry.source;
      }
    }

    if (!article) return res.status(422).json({ error: "Extraction failed" });

    const markdown = turndown.turndown(article.content);

    return res.status(200).json({
      success: true,
      title: article.title,
      domain,
      source,
      wordCount: getWordCount(article.textContent),
      markdown: markdown.trim()
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};