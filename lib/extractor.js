const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const {
  escapeHtml,
  getDomain,
  isBlockedText,
} = require("./utils");

function getMeta(doc, names = []) {
  for (const name of names) {
    const el =
      doc.querySelector(`meta[property="${name}"]`) ||
      doc.querySelector(`meta[name="${name}"]`);
    const value = el?.getAttribute("content")?.trim();
    if (value) return value;
  }
  return "";
}

function cleanNode(root) {
  if (!root) return root;

  root
    .querySelectorAll(
      [
        "script",
        "style",
        "noscript",
        "iframe",
        "svg",
        "canvas",
        "form",
        "button",
        "input",
        "select",
        "textarea",
        "nav",
        "header",
        "footer",
        "aside",
        ".ads",
        ".ad",
        ".advert",
        ".comments",
        ".sidebar",
        ".cookie",
        ".banner",
        ".promo",
        ".share",
        ".social",
        ".overlay",
        ".modal",
        ".infobox",
        ".navbox",
        ".reflist",
        ".reference",
        ".mw-editsection",
        "[aria-label*='cookie' i]",
        "[class*='cookie' i]",
        "[id*='cookie' i]",
        "[class*='promo' i]",
      ].join(",")
    )
    .forEach((el) => el.remove());

  return root;
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function collectHeadings(html, url) {
  const dom = new JSDOM(html, { url });
  return [...dom.window.document.querySelectorAll("h1, h2, h3")]
    .map((h) => normalizeText(h.textContent))
    .filter(Boolean)
    .slice(0, 30);
}

function wrapArticle(title, bodyHtml) {
  return `<article><header><h1>${escapeHtml(title || "Untitled")}</h1></header>${bodyHtml || ""}</article>`;
}

function excerptFromText(text, max = 280) {
  const clean = normalizeText(text);
  if (!clean) return "";
  return clean.length <= max ? clean : `${clean.slice(0, max).trim()}…`;
}

function isLikelyProtected(text) {
  const s = normalizeText(text).toLowerCase();

  return [
    "sign in to continue",
    "log in to continue",
    "login to continue",
    "member-only",
    "members only",
    "subscribe to continue",
    "blocked by network security",
    "access denied",
    "forbidden",
    "captcha",
    "cloudflare",
    "verify you are human",
    "are you a robot",
  ].some((term) => s.includes(term));
}

function extractWikipedia(doc, url) {
  const title = (doc.title || getMeta(doc, ["og:title"]) || "Wikipedia page")
    .replace(/\s*-\s*Wikipedia.*$/i, "")
    .trim();

  const main = doc.querySelector("#mw-content-text .mw-parser-output");
  if (!main) return null;

  const cleaned = cleanNode(main.cloneNode(true));
  const text = normalizeText(cleaned.textContent);
  const content = wrapArticle(title, cleaned.innerHTML);

  return {
    title,
    content,
    text,
    excerpt: excerptFromText(text),
    author: "",
    publishedAt: "",
    headings: collectHeadings(content, url),
    sourceType: "wikipedia",
  };
}

function extractReddit(doc, url) {
  const title =
    getMeta(doc, ["og:title", "twitter:title"]) ||
    doc.title ||
    "Reddit post";

  const selectors = [
    '[data-click-id="text"]',
    '[data-testid="post-content"]',
    'div[data-testid="post-container"]',
    "shreddit-post",
    "article",
    "main",
    ".thing",
    ".Post",
    ".usertext-body .md",
    ".entry",
  ];

  let bodyNode = null;
  for (const selector of selectors) {
    bodyNode = doc.querySelector(selector);
    if (bodyNode) break;
  }

  if (!bodyNode) return null;

  const cleaned = cleanNode(bodyNode.cloneNode(true));
  const text = normalizeText(cleaned.textContent);

  if (!text || isLikelyProtected(text) || text.length < 20) {
    return { protected: true, reason: "Login wall or protected page" };
  }

  const content = wrapArticle(title, cleaned.innerHTML);
  const author =
    getMeta(doc, ["author"]) ||
    getMeta(doc, ["article:author"]) ||
    "";

  const publishedAt =
    getMeta(doc, ["article:published_time", "og:updated_time"]) || "";

  return {
    title,
    content,
    text,
    excerpt: excerptFromText(text),
    author,
    publishedAt,
    headings: collectHeadings(content, url),
    sourceType: "reddit",
  };
}

function extractMedium(doc, url) {
  const title =
    getMeta(doc, ["og:title", "twitter:title"]) ||
    doc.title ||
    "Medium article";

  const selectors = [
    "article",
    "main article",
    "main",
  ];

  let node = null;
  for (const selector of selectors) {
    node = doc.querySelector(selector);
    if (node) break;
  }

  // If article/main is absent, let Readability try first.
  if (!node) {
    const reader = new Readability(doc);
    const article = reader.parse();
    if (article && article.content) {
      const articleText = normalizeText(article.textContent);
      if (articleText.length < 80 || isLikelyProtected(articleText)) {
        return { protected: true, reason: "Medium member-only or login wall" };
      }

      const content = wrapArticle(article.title || title, article.content || "");
      return {
        title: article.title || title,
        content,
        text: article.textContent || "",
        excerpt: excerptFromText(article.textContent || ""),
        author: article.byline || getMeta(doc, ["author", "article:author"]) || "",
        publishedAt:
          getMeta(doc, ["article:published_time", "og:published_time"]) || "",
        headings: collectHeadings(content, url),
        sourceType: "medium",
      };
    }

    return null;
  }

  const cleaned = cleanNode(node.cloneNode(true));
  const text = normalizeText(cleaned.textContent);

  if (!text || isLikelyProtected(text) || text.length < 80) {
    return { protected: true, reason: "Medium member-only or login wall" };
  }

  const content = wrapArticle(title, cleaned.innerHTML);
  const author =
    getMeta(doc, ["author", "article:author"]) || "";

  const publishedAt =
    getMeta(doc, ["article:published_time", "og:published_time"]) || "";

  return {
    title,
    content,
    text,
    excerpt: excerptFromText(text),
    author,
    publishedAt,
    headings: collectHeadings(content, url),
    sourceType: "medium",
  };
}

function extractGeneric(doc, url) {
  const title =
    getMeta(doc, ["og:title", "twitter:title", "title"]) ||
    doc.title ||
    "Untitled";

  // First try Readability.
  const reader = new Readability(doc);
  const article = reader.parse();

  if (article) {
    const articleText = normalizeText(article.textContent);

    if (!articleText || isLikelyProtected(articleText)) {
      return { protected: true, reason: "Login wall or protected page" };
    }

    const content = wrapArticle(article.title || title, article.content || "");
    return {
      title: article.title || title,
      content,
      text: article.textContent || "",
      excerpt: excerptFromText(article.textContent || ""),
      author:
        getMeta(doc, ["author", "article:author"]) ||
        article.byline ||
        "",
      publishedAt:
        getMeta(doc, ["article:published_time", "og:published_time"]) ||
        "",
      headings: collectHeadings(content, url),
      sourceType: "generic",
    };
  }

  // Fallback: use obvious content containers.
  const fallbackSelectors = [
    "article",
    "main",
    "#content",
    "#main",
    "[role='main']",
  ];

  let node = null;
  for (const selector of fallbackSelectors) {
    node = doc.querySelector(selector);
    if (node) break;
  }

  if (!node) return null;

  const cleaned = cleanNode(node.cloneNode(true));
  const text = normalizeText(cleaned.textContent);

  if (!text || isLikelyProtected(text) || text.length < 80) {
    return { protected: true, reason: "Login wall or protected page" };
  }

  const content = wrapArticle(title, cleaned.innerHTML);

  return {
    title,
    content,
    text,
    excerpt: excerptFromText(text),
    author: getMeta(doc, ["author", "article:author"]) || "",
    publishedAt:
      getMeta(doc, ["article:published_time", "og:published_time"]) ||
      "",
    headings: collectHeadings(content, url),
    sourceType: "generic",
  };
}

function extractContent(html, url, meta = {}) {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;
  const domain = getDomain(url);

  if (!doc || !doc.body) return null;

  cleanNode(doc.body);

  if (domain.includes("wikipedia.org")) {
    const wiki = extractWikipedia(doc, url);
    if (wiki) return { ...wiki, sourceType: meta.sourceType || "wikipedia" };
  }

  if (domain.includes("reddit.com")) {
    const reddit = extractReddit(doc, url);
    if (reddit) return { ...reddit, sourceType: meta.sourceType || "reddit" };
  }

  if (domain.includes("medium.com")) {
    const medium = extractMedium(doc, url);
    if (medium) return { ...medium, sourceType: meta.sourceType || "medium" };
  }

  const generic = extractGeneric(doc, url);
  if (generic) {
    return {
      ...generic,
      sourceType: meta.sourceType || generic.sourceType || "generic",
    };
  }

  return null;
}

module.exports = {
  extractContent,
};
