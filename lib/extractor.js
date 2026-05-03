const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const { escapeHtml, getDomain, isBlockedText } = require("./utils");

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
    .querySelectorAll([
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
      "dialog",
      "picture",
      "video",
      "audio",
      "table[role='presentation']",
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
      "sup.reference",
      "table.infobox",
      "figure",
      "[aria-label*='cookie' i]",
      "[class*='cookie' i]",
      "[id*='cookie' i]",
      "[class*='promo' i]",
      "[style*='display:none' i]",
      "[style*='visibility:hidden' i]",
    ].join(","))
    .forEach((el) => el.remove());

  return root;
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
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
  return isBlockedText(text);
}

function asJsonValueText(value) {
  if (typeof value === "string") {
    const v = normalizeText(value);
    return v || "";
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function findFirstStringValue(input, keys = []) {
  if (!input || typeof input !== "object") return "";
  const queue = [input];
  const seen = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    for (const key of keys) {
      const value = current[key];
      const str = asJsonValueText(value);
      if (str) return str;
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }

  return "";
}

function extractJsonLd(doc) {
  const nodes = [...doc.querySelectorAll('script[type="application/ld+json"]')];

  for (const node of nodes) {
    const raw = node.textContent || "";
    if (!raw.trim()) continue;

    try {
      const parsed = JSON.parse(raw);
      const candidates = Array.isArray(parsed) ? parsed : [parsed];

      for (const candidate of candidates) {
        if (!candidate || typeof candidate !== "object") continue;

        const type = Array.isArray(candidate["@type"])
          ? candidate["@type"].join(" ").toLowerCase()
          : String(candidate["@type"] || "").toLowerCase();

        if (!type.includes("article") && !type.includes("news") && !type.includes("blogposting")) {
          continue;
        }

        const headline = asJsonValueText(candidate.headline) || asJsonValueText(candidate.name) || "";
        const body = asJsonValueText(candidate.articleBody) || asJsonValueText(candidate.text) || asJsonValueText(candidate.description) || "";

        if (!headline && !body) continue;

        return {
          title: headline || "",
          text: body || "",
          author: asJsonValueText(candidate.author?.name) || asJsonValueText(candidate.author) || "",
          publishedAt: asJsonValueText(candidate.datePublished) || asJsonValueText(candidate.dateCreated) || "",
        };
      }
    } catch {
      // ignore invalid JSON-LD
    }
  }

  return null;
}

function extractNextData(doc) {
  const node = doc.querySelector("#__NEXT_DATA__");
  if (!node) return null;

  try {
    const data = JSON.parse(node.textContent || "{}");
    const title = findFirstStringValue(data, ["headline", "title", "name"]) || "";
    const text = findFirstStringValue(data, ["articleBody", "content", "body", "description", "text", "selftext"]) || "";

    if (!title && !text) return null;

    return {
      title,
      text,
      author: findFirstStringValue(data, ["author", "byline"]) || "",
      publishedAt: findFirstStringValue(data, ["datePublished", "publishedAt", "createdAt"]) || "",
    };
  } catch {
    return null;
  }
}

function extractWikipedia(doc, url) {
  const title = (doc.title || getMeta(doc, ["og:title"]) || "Wikipedia page")
    .replace(/\s*-\s*Wikipedia.*$/i, "")
    .trim();

  const main = doc.querySelector("#mw-content-text .mw-parser-output");
  if (!main) return null;

  const cleaned = cleanNode(main.cloneNode(true));
  const text = normalizeText(cleaned.textContent);
  if (!text || text.length < 80) return null;

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

function extractRedditJson(payload, url) {
  const queue = [payload];
  const seen = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    const title = asJsonValueText(current.title) || asJsonValueText(current.headline) || asJsonValueText(current.name);
    const body = asJsonValueText(current.selftext) || asJsonValueText(current.body) || asJsonValueText(current.text) || asJsonValueText(current.content) || asJsonValueText(current.description);

    if (title || body) {
      const author = asJsonValueText(current.author) || asJsonValueText(current.byline) || "";
      const publishedAt = asJsonValueText(current.created_utc) || asJsonValueText(current.datePublished) || asJsonValueText(current.publishedAt) || "";
      const contentParts = [];
      if (title) contentParts.push(`<h2>${escapeHtml(title)}</h2>`);
      if (body) contentParts.push(`<p>${escapeHtml(body).replace(/\n/g, "<br>")}</p>`);
      const content = wrapArticle(title || "Reddit post", contentParts.join(""));
      const text = normalizeText(`${title} ${body}`);

      if (!text || isLikelyProtected(text) || text.length < 20) {
        return { protected: true, reason: "Login wall or protected page" };
      }

      return {
        title: title || "Reddit post",
        content,
        text,
        excerpt: excerptFromText(text),
        author,
        publishedAt,
        headings: collectHeadings(content, url),
        sourceType: "reddit",
      };
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }

  return null;
}

function extractRedditHtml(doc, url) {
  const title = getMeta(doc, ["og:title", "twitter:title"]) || doc.title || "Reddit post";

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
  return {
    title,
    content,
    text,
    excerpt: excerptFromText(text),
    author: getMeta(doc, ["author"]) || getMeta(doc, ["article:author"]) || "",
    publishedAt: getMeta(doc, ["article:published_time", "og:updated_time"]) || "",
    headings: collectHeadings(content, url),
    sourceType: "reddit",
  };
}

function extractMedium(doc, url) {
  const title = getMeta(doc, ["og:title", "twitter:title"]) || doc.title || "Medium article";

  const jsonLd = extractJsonLd(doc);
  if (jsonLd && jsonLd.text && jsonLd.text.length >= 80) {
    const content = wrapArticle(
      jsonLd.title || title,
      `<p>${escapeHtml(jsonLd.text).replace(/\n/g, "<br>")}</p>`
    );

    return {
      title: jsonLd.title || title,
      content,
      text: jsonLd.text,
      excerpt: excerptFromText(jsonLd.text),
      author: jsonLd.author || getMeta(doc, ["author", "article:author"]) || "",
      publishedAt: jsonLd.publishedAt || getMeta(doc, ["article:published_time", "og:published_time"]) || "",
      headings: collectHeadings(content, url),
      sourceType: "medium",
    };
  }

  const selectors = ["article", "main article", "main"];
  let node = null;
  for (const selector of selectors) {
    node = doc.querySelector(selector);
    if (node) break;
  }

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
        publishedAt: getMeta(doc, ["article:published_time", "og:published_time"]) || "",
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
  return {
    title,
    content,
    text,
    excerpt: excerptFromText(text),
    author: getMeta(doc, ["author", "article:author"]) || "",
    publishedAt: getMeta(doc, ["article:published_time", "og:published_time"]) || "",
    headings: collectHeadings(content, url),
    sourceType: "medium",
  };
}

function extractGeneric(doc, url) {
  const title = getMeta(doc, ["og:title", "twitter:title", "title"]) || doc.title || "Untitled";

  const jsonLd = extractJsonLd(doc);
  if (jsonLd && (jsonLd.text || jsonLd.title)) {
    const text = normalizeText(jsonLd.text);
    if (text && !isLikelyProtected(text) && text.length >= 40) {
      const content = wrapArticle(
        jsonLd.title || title,
        `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`
      );
      return {
        title: jsonLd.title || title,
        content,
        text,
        excerpt: excerptFromText(text),
        author: jsonLd.author || getMeta(doc, ["author", "article:author"]) || "",
        publishedAt: jsonLd.publishedAt || getMeta(doc, ["article:published_time", "og:published_time"]) || "",
        headings: collectHeadings(content, url),
        sourceType: "generic",
      };
    }
  }

  const nextData = extractNextData(doc);
  if (nextData && (nextData.text || nextData.title)) {
    const text = normalizeText(nextData.text);
    if (text && !isLikelyProtected(text) && text.length >= 40) {
      const content = wrapArticle(
        nextData.title || title,
        `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`
      );
      return {
        title: nextData.title || title,
        content,
        text,
        excerpt: excerptFromText(text),
        author: nextData.author || getMeta(doc, ["author", "article:author"]) || "",
        publishedAt: nextData.publishedAt || getMeta(doc, ["article:published_time", "og:published_time"]) || "",
        headings: collectHeadings(content, url),
        sourceType: "generic",
      };
    }
  }

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
      author: getMeta(doc, ["author", "article:author"]) || article.byline || "",
      publishedAt: getMeta(doc, ["article:published_time", "og:published_time"]) || "",
      headings: collectHeadings(content, url),
      sourceType: "generic",
    };
  }

  const fallbackSelectors = [
    "article",
    "main",
    "#content",
    "#main",
    "[role='main']",
    "[itemprop='articleBody']",
  ];

  let node = null;
  for (const selector of fallbackSelectors) {
    node = doc.querySelector(selector);
    if (node) break;
  }

  if (!node) {
    const bodyText = normalizeText(doc.body?.textContent || "");
    if (bodyText && !isLikelyProtected(bodyText) && bodyText.length >= 120) {
      const content = wrapArticle(title, `<p>${escapeHtml(bodyText).replace(/\n/g, "<br>")}</p>`);
      return {
        title,
        content,
        text: bodyText,
        excerpt: excerptFromText(bodyText),
        author: getMeta(doc, ["author", "article:author"]) || "",
        publishedAt: getMeta(doc, ["article:published_time", "og:published_time"]) || "",
        headings: collectHeadings(content, url),
        sourceType: "generic",
      };
    }

    return null;
  }

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
    publishedAt: getMeta(doc, ["article:published_time", "og:published_time"]) || "",
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

  if (meta?.payload && domain.includes("reddit.com")) {
    const redditJson = extractRedditJson(meta.payload, url);
    if (redditJson) return { ...redditJson, sourceType: meta.sourceType || "reddit" };
  }

  if (domain.includes("wikipedia.org")) {
    const wiki = extractWikipedia(doc, url);
    if (wiki) return { ...wiki, sourceType: meta.sourceType || "wikipedia" };
  }

  if (domain.includes("reddit.com")) {
    const reddit = extractRedditHtml(doc, url);
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
