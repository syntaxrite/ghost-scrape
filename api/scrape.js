const axios = require("axios");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const TurndownService = require("turndown");
const { gfm } = require("turndown-plugin-gfm");

// ---------- CONFIG ----------
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;
const BROWSERLESS_URL =
  process.env.BROWSERLESS_CONTENT_URL || "https://chrome.browserless.io/content";

const http = axios.create({
  timeout: 15000,
  maxRedirects: 5,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36",
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
  },
});

// ---------- MARKDOWN ----------
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
}).use(gfm);

turndown.addRule("remove-images", {
  filter: ["img", "picture"],
  replacement: () => "",
});

turndown.addRule("keep-link-text", {
  filter: "a",
  replacement: (content) => content,
});

// ---------- HELPERS ----------
function normalizeUrl(url) {
  if (!url) throw new Error("URL required");
  if (!/^https?:\/\//i.test(url)) return "https://" + url;
  return url;
}

function getDomain(url) {
  return new URL(url).hostname;
}

function isMedium(d) {
  return d.includes("medium.com");
}
function isBBC(d) {
  return d.includes("bbc.com");
}
function isWikipedia(d) {
  return d.includes("wikipedia.org");
}

// ---------- FETCH ----------
async function fetchBrowserless(url) {
  if (!BROWSERLESS_TOKEN) throw new Error("Missing BROWSERLESS_TOKEN");

  const res = await axios.post(
    `${BROWSERLESS_URL}?token=${encodeURIComponent(BROWSERLESS_TOKEN)}`,
    { url },
    { timeout: 30000 }
  );
  return res.data;
}

async function fetchSmart(url, domain, mode) {
  // Force browser for Medium or deep mode
  if (isMedium(domain) || mode === "deep") {
    return { html: await fetchBrowserless(url), source: "browserless" };
  }

  try {
    const res = await http.get(url, { responseType: "text" });
    return { html: res.data, source: "axios" };
  } catch (err) {
    const status = err?.response?.status;
    if (status === 403 || status === 429 || status === 503) {
      return { html: await fetchBrowserless(url), source: "browserless" };
    }
    throw err;
  }
}

// ---------- CLEAN ----------
function cleanDoc(doc) {
  doc.querySelectorAll(`
    script, style, iframe, nav, footer, header, aside,
    .ads, .popup, .modal, .banner, .cookie, .newsletter
  `).forEach(el => el.remove());
  return doc;
}

// ---------- EXTRACTORS ----------
function extractWikipedia(doc) {
  const content = doc.querySelector("#mw-content-text .mw-parser-output");
  if (!content) return null;

  content.querySelectorAll(".reference, sup.reference, .mw-editsection")
    .forEach(el => el.remove());

  return {
    title: doc.querySelector("#firstHeading")?.textContent,
    content: content.innerHTML,
    textContent: content.textContent,
  };
}

function extractBBC(doc) {
  const blocks = [...doc.querySelectorAll('[data-component="text-block"]')];

  if (blocks.length > 0) {
    const html = blocks
      .map(b => `<p>${b.textContent.trim()}</p>`)
      .join("\n");

    return {
      title: doc.querySelector("h1")?.textContent,
      content: html,
      textContent: blocks.map(b => b.textContent).join(" "),
    };
  }

  return null;
}

function extractGeneric(doc) {
  // 1. Readability
  const reader = new Readability(doc);
  const article = reader.parse();

  if (article && article.content) {
    return {
      title: article.title,
      content: article.content,
      textContent: article.textContent,
    };
  }

  // 2. fallback
  const fallback = doc.querySelector("article, main");
  if (!fallback) return null;

  return {
    title: doc.title,
    content: fallback.innerHTML,
    textContent: fallback.textContent,
  };
}

// ---------- VALIDATION ----------
function isWeak(text) {
  if (!text) return true;
  return text.split(/\s+/).length < 100;
}

// ---------- MAIN ----------
module.exports = async (req, res) => {
  try {
    let { url, mode } = req.query;

    url = normalizeUrl(url);
    const domain = getDomain(url);

    let { html, source } = await fetchSmart(url, domain, mode);

    let dom = new JSDOM(html, { url });
    let doc = cleanDoc(dom.window.document);

    let article =
      (isWikipedia(domain) && extractWikipedia(doc)) ||
      (isBBC(domain) && extractBBC(doc)) ||
      extractGeneric(doc);

    // 🔁 retry if weak
    if (!article || isWeak(article.textContent)) {
      html = await fetchBrowserless(url);
      source = "browserless-retry";

      dom = new JSDOM(html, { url });
      doc = cleanDoc(dom.window.document);

      article =
        extractWikipedia(doc) ||
        extractBBC(doc) ||
        extractGeneric(doc);
    }

    if (!article || !article.content) {
      throw new Error("Extraction failed");
    }

    let markdown = turndown.turndown(article.content);

    markdown = markdown
      .replace(/\[\d+\]/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    const wordCount = article.textContent.split(/\s+/).length;

    return res.status(200).json({
      success: true,
      source,
      domain,
      title: article.title || "Untitled",
      wordCount,
      readingTime: Math.ceil(wordCount / 200) + " min",
      markdown,
    });

  } catch (err) {
    console.error("SCRAPE ERROR:", err.message);

    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};