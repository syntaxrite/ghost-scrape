const axios = require("axios");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const TurndownService = require("turndown");
const { gfm } = require("turndown-plugin-gfm");

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;
const BROWSERLESS_URL = "https://chrome.browserless.io/content";

const http = axios.create({
  timeout: 15000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36",
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
  },
});

const turndown = new TurndownService().use(gfm);

turndown.addRule("remove-images", {
  filter: ["img", "picture"],
  replacement: () => "",
});

// ---------- HELPERS ----------

function normalizeUrl(url) {
  if (!/^https?:\/\//i.test(url)) return "https://" + url;
  return url;
}

function getDomain(url) {
  return new URL(url).hostname;
}

function isMedium(domain) {
  return domain.includes("medium.com");
}

function isBBC(domain) {
  return domain.includes("bbc.com");
}

function isWikipedia(domain) {
  return domain.includes("wikipedia.org");
}

// ---------- FETCH ----------

async function fetchBrowserless(url) {
  const res = await axios.post(
    `${BROWSERLESS_URL}?token=${BROWSERLESS_TOKEN}`,
    { url },
    { timeout: 30000 }
  );
  return res.data;
}

async function fetchSmart(url, domain) {
  // Force browser for Medium
  if (isMedium(domain)) {
    return { html: await fetchBrowserless(url), source: "browserless" };
  }

  try {
    const res = await http.get(url);
    return { html: res.data, source: "axios" };
  } catch (err) {
    const status = err?.response?.status;
    if (status === 403 || status === 429) {
      return { html: await fetchBrowserless(url), source: "browserless" };
    }
    throw err;
  }
}

// ---------- CLEAN ----------

function cleanDoc(doc) {
  doc.querySelectorAll(`
    script, style, iframe, nav, footer, header, aside,
    .ads, .popup, .modal, .banner
  `).forEach(el => el.remove());
  return doc;
}

// ---------- EXTRACTORS ----------

function extractWikipedia(doc) {
  const content = doc.querySelector("#mw-content-text .mw-parser-output");
  if (!content) return null;

  return {
    title: doc.querySelector("#firstHeading")?.textContent,
    content: content.innerHTML,
    textContent: content.textContent
  };
}

function extractBBC(doc) {
  const blocks = [...doc.querySelectorAll('[data-component="text-block"]')];

  if (blocks.length > 0) {
    const html = blocks.map(b => `<p>${b.textContent.trim()}</p>`).join("\n");
    return {
      title: doc.querySelector("h1")?.textContent,
      content: html,
      textContent: blocks.map(b => b.textContent).join(" ")
    };
  }

  return null;
}

function extractGeneric(doc) {
  const reader = new Readability(doc);
  const article = reader.parse();

  if (article && article.content) {
    return {
      title: article.title,
      content: article.content,
      textContent: article.textContent
    };
  }

  // fallback
  const fallback = doc.querySelector("article, main");
  if (!fallback) return null;

  return {
    title: doc.title,
    content: fallback.innerHTML,
    textContent: fallback.textContent
  };
}

// ---------- VALIDATION ----------

function isBadContent(text) {
  if (!text) return true;
  const words = text.split(/\s+/).length;
  return words < 100; // too small = bad scrape
}

// ---------- MAIN ----------

module.exports = async (req, res) => {
  try {
    let { url } = req.query;
    url = normalizeUrl(url);

    const domain = getDomain(url);

    let { html, source } = await fetchSmart(url, domain);

    let dom = new JSDOM(html, { url });
    let doc = cleanDoc(dom.window.document);

    let article = null;

    if (isWikipedia(domain)) article = extractWikipedia(doc);
    else if (isBBC(domain)) article = extractBBC(doc);

    if (!article) article = extractGeneric(doc);

    // 🔥 Smart retry if content is weak
    if (!article || isBadContent(article.textContent)) {
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

    return res.json({
      success: true,
      source,
      domain,
      title: article.title || "Untitled",
      wordCount,
      readingTime: Math.ceil(wordCount / 200) + " min",
      markdown
    });

  } catch (err) {
    console.error(err.message);

    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};