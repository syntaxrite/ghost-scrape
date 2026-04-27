const {
  fetchSmart,
  getDomain,
  getSiteType,
  shouldForceBrowser,
  isHomepage,
  shouldRetry,
  getWordCount,
} = require("../lib/core");

const {
  extractWikipedia,
  extractNews,
  extractBlog,
  extractGeneric,
} = require("../lib/extractors");

const TurndownService = require("turndown");
const { gfm } = require("turndown-plugin-gfm");

// ---------- MARKDOWN SETUP ----------
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
}).use(gfm);

// clean output rules
turndown.addRule("remove-images", {
  filter: ["img", "picture", "source"],
  replacement: () => "",
});

turndown.addRule("keep-text-links", {
  filter: "a",
  replacement: (content) => content,
});

// ---------- HELPERS ----------
function normalizeUrl(input) {
  let url = String(input || "").trim();
  if (!url) throw new Error("URL required");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

function cleanMarkdown(md) {
  return md
    .replace(/\[\d+\]/g, "")          // remove [1][2]
    .replace(/\n{3,}/g, "\n\n")       // collapse spacing
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

// ---------- EXTRACT ROUTER ----------
function runExtractor(type, html, url) {
  if (type === "wikipedia") return extractWikipedia(html, url);
  if (type === "news") return extractNews(html, url);
  if (type === "blog") return extractBlog(html, url);

  return extractGeneric(html, url);
}

// ---------- MAIN HANDLER ----------
module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Use GET" });
  }

  let { url, mode } = req.query;

  try {
    url = normalizeUrl(url);

    if (isHomepage(url)) {
      return res.status(400).json({
        success: false,
        error: "Homepage not supported. Use an article URL.",
      });
    }

    const domain = getDomain(url);
    const siteType = getSiteType(domain);

    // ---------- FIRST FETCH ----------
    let { html, source } = await fetchSmart(url, {
      forceBrowser: shouldForceBrowser(domain, mode),
    });

    let article = runExtractor(siteType, html, url);

    // ---------- RETRY LOGIC ----------
    if (shouldRetry(article, source)) {
      const retry = await fetchSmart(url, { forceBrowser: true });

      const retryArticle = runExtractor(siteType, retry.html, url);

      if (retryArticle && getWordCount(retryArticle.textContent) >
        getWordCount(article?.textContent)) {
        article = retryArticle;
        source = retry.source;
      }
    }

    // ---------- VALIDATION ----------
    if (!article || !article.content) {
      return res.status(422).json({
        success: false,
        error: "Could not extract readable content",
      });
    }

    // ---------- MARKDOWN ----------
    let markdown = turndown.turndown(article.content);
    markdown = cleanMarkdown(markdown);

    const wordCount = getWordCount(article.textContent);
    const readingTime = `${Math.max(1, Math.ceil(wordCount / 200))} min`;

    return res.status(200).json({
      success: true,
      domain,
      siteType,
      source,
      title: article.title || "Untitled",
      wordCount,
      readingTime,
      markdown,
    });

  } catch (err) {
    console.error("SCRAPE ERROR:", err?.message);

    return res.status(500).json({
      success: false,
      error: err.message || "Internal error",
    });
  }
  
};