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

const axios = require("axios");
const Parser = require("rss-parser");
const parser = new Parser();

const TurndownService = require("turndown");
const { gfm } = require("turndown-plugin-gfm");

// ---------- MARKDOWN ----------
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
}).use(gfm);

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
    .replace(/\[\d+\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function isReddit(domain) {
  return domain.includes("reddit.com");
}

function isMedium(domain) {
  return domain.includes("medium.com");
}

// ---------- REDDIT HANDLER ----------
async function handleReddit(url) {
  const jsonUrl = url.endsWith(".json") ? url : `${url}.json`;

  const res = await axios.get(jsonUrl, {
    headers: { "User-Agent": "GhostScrape/1.0" },
  });

  const data = res.data;

  // subreddit listing
  if (data?.data?.children) {
    const items = data.data.children.map((p) => p.data);

    const markdown = items
      .map(
        (p, i) =>
          `### ${i + 1}. ${p.title}\n- 👍 ${p.ups} upvotes\n- 🔗 ${p.url}\n`
      )
      .join("\n");

    return {
      title: "Reddit Feed",
      content: markdown,
      textContent: markdown,
    };
  }

  // post
  if (Array.isArray(data)) {
    const post = data[0]?.data?.children[0]?.data;

    const content = `# ${post.title}\n\n${post.selftext || ""}`;

    return {
      title: post.title,
      content,
      textContent: content,
    };
  }

  throw new Error("Invalid Reddit format");
}

// ---------- MEDIUM HANDLER (RSS) ----------
function extractMediumUsername(url) {
  const match = url.match(/medium\.com\/@([^\/]+)/);
  return match ? match[1] : null;
}

async function handleMedium(url) {
  const username = extractMediumUsername(url);

  if (!username) {
    throw new Error("Only Medium profile URLs supported");
  }

  const feedUrl = `https://medium.com/feed/@${username}`;
  const feed = await parser.parseURL(feedUrl);

  const markdown = feed.items
    .slice(0, 10)
    .map(
      (item, i) =>
        `### ${i + 1}. ${item.title}\n${item.contentSnippet}\n\n🔗 ${item.link}`
    )
    .join("\n\n");

  return {
    title: `Medium Feed (@${username})`,
    content: markdown,
    textContent: markdown,
  };
}

// ---------- EXTRACT ROUTER ----------
function runExtractor(type, html, url) {
  if (type === "wikipedia") return extractWikipedia(html, url);
  if (type === "news") return extractNews(html, url);
  if (type === "blog") return extractBlog(html, url);

  return extractGeneric(html, url);
}

// ---------- MAIN ----------
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

    // 🔴 REDDIT ROUTE
    if (isReddit(domain)) {
      const article = await handleReddit(url);

      return res.json({
        success: true,
        source: "reddit",
        domain,
        title: article.title,
        wordCount: getWordCount(article.textContent),
        readingTime: "1 min",
        markdown: cleanMarkdown(article.content),
      });
    }

    // 🟠 MEDIUM ROUTE
    if (isMedium(domain)) {
      const article = await handleMedium(url);

      return res.json({
        success: true,
        source: "medium",
        domain,
        title: article.title,
        wordCount: getWordCount(article.textContent),
        readingTime: "1 min",
        markdown: cleanMarkdown(article.content),
      });
    }

    // 🟢 DEFAULT SCRAPER
    const siteType = getSiteType(domain);

    let { html, source } = await fetchSmart(url, {
      forceBrowser: shouldForceBrowser(domain, mode),
    });

    let article = runExtractor(siteType, html, url);

    // retry if weak
    if (shouldRetry(article, source)) {
      const retry = await fetchSmart(url, { forceBrowser: true });

      const retryArticle = runExtractor(siteType, retry.html, url);

      if (
        retryArticle &&
        getWordCount(retryArticle.textContent) >
          getWordCount(article?.textContent)
      ) {
        article = retryArticle;
        source = retry.source;
      }
    }

    if (!article || !article.content) {
      return res.status(422).json({
        success: false,
        error: "Could not extract readable content",
      });
    }

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