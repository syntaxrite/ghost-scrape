const axios = require("axios");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const TurndownService = require("turndown");
const { gfm } = require("turndown-plugin-gfm");

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;
const BROWSERLESS_CONTENT_URL =
  process.env.BROWSERLESS_CONTENT_URL || "https://chrome.browserless.io/content";

const http = axios.create({
  timeout: 15000,
  maxContentLength: 8 * 1024 * 1024,
  maxRedirects: 5,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36",
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  },
});

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
}).use(gfm);

turndown.addRule("keep-link-text", {
  filter: "a",
  replacement: (content) => content,
});

turndown.addRule("remove-images", {
  filter: ["img", "picture", "source"],
  replacement: () => "",
});

function normalizeUrl(input) {
  let url = String(input || "").trim();
  if (!url) throw new Error("URL required");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

function domainOf(url) {
  return new URL(url).hostname.replace(/^www\./, "");
}

function isMedium(domain) {
  return domain === "medium.com" || domain.endsWith(".medium.com");
}

function isBBC(domain) {
  return domain === "bbc.com" || domain.endsWith(".bbc.com");
}

function isWikipedia(domain) {
  return domain === "wikipedia.org" || domain.endsWith(".wikipedia.org");
}

function cleanDocument(doc) {
  const selectors = [
    "script",
    "style",
    "iframe",
    "nav",
    "header",
    "footer",
    "aside",
    "form",
    "button",
    "svg",
    "noscript",
    ".ads",
    ".ad",
    ".advertisement",
    ".promo",
    ".popup",
    ".modal",
    ".cookie",
    ".newsletter",
    ".subscribe",
    ".sidebar",
  ];

  selectors.forEach((selector) => {
    doc.querySelectorAll(selector).forEach((el) => el.remove());
  });

  return doc;
}

function extractMedium(doc) {
  const title =
    doc.querySelector("article h1")?.textContent?.trim() ||
    doc.querySelector("h1")?.textContent?.trim() ||
    doc.title?.split("|")[0]?.trim() ||
    "Untitled";

  const article = doc.querySelector("article") || doc.querySelector("main");
  if (!article) return null;

  const clone = article.cloneNode(true);

  clone.querySelectorAll("script,style,svg,button,aside,form,iframe,figure").forEach((el) => el.remove());

  return { title, content: clone.innerHTML };
}

function extractBBC(doc) {
  const title =
    doc.querySelector("h1")?.textContent?.trim() ||
    doc.title?.split(" - ")[0]?.trim() ||
    "Untitled";

  const article = doc.querySelector("article") || doc.querySelector("main");
  if (!article) return null;

  const clone = article.cloneNode(true);

  clone.querySelectorAll(
    '[data-component="text-block"] + *, script,style,svg,button,aside,form,iframe,figure'
  ).forEach((el) => el.remove());

  const textBlocks = [...clone.querySelectorAll('[data-component="text-block"]')];
  if (textBlocks.length > 0) {
    const html = textBlocks
      .map((node) => {
        const p = node.querySelector("p");
        const text = (p?.textContent || node.textContent || "").trim();
        return text ? `<p>${text}</p>` : "";
      })
      .filter(Boolean)
      .join("\n");

    return { title, content: html || clone.innerHTML };
  }

  return { title, content: clone.innerHTML };
}

function extractWikipedia(doc) {
  const title =
    doc.querySelector("#firstHeading")?.textContent?.trim() ||
    doc.title?.replace(/\s*-\s*Wikipedia$/, "")?.trim() ||
    "Untitled";

  const content = doc.querySelector("#mw-content-text .mw-parser-output");
  if (!content) return null;

  const clone = content.cloneNode(true);

  clone
    .querySelectorAll(
      ".mw-editsection, .reference, sup.reference, .mw-jump-link, .toc, .navbox, .hatnote, .infobox, script, style, iframe, svg"
    )
    .forEach((el) => el.remove());

  return { title, content: clone.innerHTML };
}

function extractGeneric(doc) {
  const reader = new Readability(doc);
  const article = reader.parse();
  if (!article || !article.content) return null;
  return {
    title: article.title || doc.title || "Untitled",
    content: article.content,
    textContent: article.textContent || "",
  };
}

async function fetchWithBrowserless(url) {
  if (!BROWSERLESS_TOKEN) {
    throw new Error("BROWSERLESS_TOKEN is missing");
  }

  const endpoint = `${BROWSERLESS_CONTENT_URL}?token=${encodeURIComponent(BROWSERLESS_TOKEN)}`;

  const response = await axios.post(
    endpoint,
    { url },
    {
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
      responseType: "text",
      transformResponse: [(data) => data],
    }
  );

  return response.data;
}

async function fetchHtml(url, preferBrowserless = false) {
  if (preferBrowserless) {
    return { html: await fetchWithBrowserless(url), source: "browserless" };
  }

  try {
    const response = await http.get(url, { responseType: "text" });
    return { html: response.data, source: "axios" };
  } catch (err) {
    const status = err?.response?.status;

    if (status === 403 || status === 429 || status === 503) {
      const html = await fetchWithBrowserless(url);
      return { html, source: "browserless" };
    }

    throw err;
  }
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Use GET" });
  }

  let { url, mode } = req.query;

  try {
    url = normalizeUrl(url);
    const domain = domainOf(url);

    const useBrowserlessFirst = mode === "deep" || isMedium(domain);
    const { html, source } = await fetchHtml(url, useBrowserlessFirst);

    const dom = new JSDOM(html, { url });
    const doc = cleanDocument(dom.window.document);

    let article = null;

    if (isWikipedia(domain)) {
      article = extractWikipedia(doc);
    } else if (isBBC(domain)) {
      article = extractBBC(doc);
    } else if (isMedium(domain)) {
      article = extractMedium(doc);
    }

    if (!article) {
      article = extractGeneric(doc);
    }

    if (!article || !article.content) {
      throw new Error("Could not extract readable content");
    }

    let markdown = turndown.turndown(article.content);

    markdown = markdown
      .replace(/\[\d+\]/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+\n/g, "\n")
      .trim();

    const wordCount = (article.textContent || markdown)
      .split(/\s+/)
      .filter(Boolean).length;

    const readingTime = `${Math.max(1, Math.ceil(wordCount / 200))} min`;

    dom.window.close();

    return res.status(200).json({
      success: true,
      source,
      domain,
      title: article.title || "Untitled",
      wordCount,
      readingTime,
      markdown,
    });
  } catch (error) {
    console.error("SCRAPE ERROR:", error?.response?.status, error?.message);

    return res.status(500).json({
      success: false,
      error: error?.response?.status
        ? `Upstream returned ${error.response.status}`
        : error.message || "Unknown error",
    });
  }
};