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
      ].join(",")
    )
    .forEach((el) => el.remove());

  return root;
}

function collectHeadings(html, url) {
  const dom = new JSDOM(html, { url });
  return [...dom.window.document.querySelectorAll("h1, h2, h3")]
    .map((h) => h.textContent.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 30);
}

function wrapArticle(title, bodyHtml) {
  return `<article><header><h1>${escapeHtml(title || "Untitled")}</h1></header>${bodyHtml || ""}</article>`;
}

function excerptFromText(text, max = 280) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length <= max ? clean : `${clean.slice(0, max).trim()}…`;
}

function extractWikipedia(doc, url) {
  const title = (doc.title || getMeta(doc, ["og:title"]) || "Wikipedia page")
    .replace(/\s*-\s*Wikipedia.*$/i, "")
    .trim();

  const main = doc.querySelector("#mw-content-text .mw-parser-output");
  if (!main) return null;

  const cleaned = cleanNode(main.cloneNode(true));
  const text = cleaned.textContent.replace(/\s+/g, " ").trim();
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

  const bodyNode =
    doc.querySelector('[data-click-id="text"]') ||
    doc.querySelector('[data-testid="post-content"]') ||
    doc.querySelector("shreddit-post") ||
    doc.querySelector("article") ||
    doc.querySelector("main") ||
    doc.body;

  if (!bodyNode) return null;

  const cleaned = cleanNode(bodyNode.cloneNode(true));
  const text = cleaned.textContent.replace(/\s+/g, " ").trim();

  if (!text || isBlockedText(text)) return { protected: true, reason: "Login wall or protected page" };

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

function extractGeneric(doc, url) {
  const title =
    getMeta(doc, ["og:title", "twitter:title", "title"]) ||
    doc.title ||
    "Untitled";

  const reader = new Readability(doc);
  const article = reader.parse();

  if (!article) return null;

  const articleText = String(article.textContent || "").replace(/\s+/g, " ").trim();
  if (!articleText || isBlockedText(articleText)) {
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

function extractContent(html, url, meta = {}) {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;
  const domain = getDomain(url);

  if (!doc || !doc.body) return null;

  // Remove obvious clutter globally before specialized extraction
  cleanNode(doc.body);

  if (domain.includes("wikipedia.org")) {
    const wiki = extractWikipedia(doc, url);
    if (wiki) return { ...wiki, sourceType: meta.sourceType || "wikipedia" };
  }

  if (domain.includes("reddit.com")) {
    const reddit = extractReddit(doc, url);
    if (reddit) return { ...reddit, sourceType: meta.sourceType || "reddit" };
    if (reddit?.protected) return reddit;
  }

  // Medium, Quora, and most public pages
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