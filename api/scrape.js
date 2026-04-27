const axios = require("axios");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const TurndownService = require("turndown");
const { gfm } = require("turndown-plugin-gfm");

const preferBrowserless = isMedium(domain) || mode === "deep";

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
    Accept:
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

function isWikipedia(domain) {
  return domain === "wikipedia.org" || domain.endsWith(".wikipedia.org");
}

function isBBC(domain) {
  return domain === "bbc.com" || domain.endsWith(".bbc.com");
}

function isMedium(domain) {
  return domain === "medium.com" || domain.endsWith(".medium.com");
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cleanCommon(doc) {
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

function cleanWikipedia(doc) {
  const content = doc.querySelector("#mw-content-text .mw-parser-output");
  if (!content) return null;

  const clone = content.cloneNode(true);
  clone
    .querySelectorAll(
      ".reference, sup.reference, .mw-editsection, .hatnote, .toc, .navbox, .vertical-navbox, .ambox, .sidebar, .infobox, script, style, iframe, svg"
    )
    .forEach((el) => el.remove());

  const title =
    doc.querySelector("#firstHeading")?.textContent?.trim() ||
    doc.title?.replace(/\s*-\s*Wikipedia$/, "").trim() ||
    "Untitled";

  return {
    title,
    content: clone.innerHTML,
    textContent: clone.textContent || "",
  };
}

function cleanBBC(doc) {
  const title =
    doc.querySelector("h1")?.textContent?.trim() ||
    doc.title?.split(" - ")[0]?.trim() ||
    "Untitled";

  const blocks = [...doc.querySelectorAll('[data-component="text-block"]')];
  if (blocks.length > 0) {
    const html = blocks
      .map((block) => {
        const text = (block.textContent || "").trim();
        return text ? `<p>${escapeHtml(text)}</p>` : "";
      })
      .filter(Boolean)
      .join("\n");

    if (html) {
      return {
        title,
        content: html,
        textContent: blocks.map((b) => b.textContent || "").join(" "),
      };
    }
  }

  const article = doc.querySelector("article, main");
  if (!article) return null;

  const clone = article.cloneNode(true);
  clone
    .querySelectorAll("script, style, iframe, figure, aside, form, button, svg, noscript")
    .forEach((el) => el.remove());

  return {
    title,
    content: clone.innerHTML,
    textContent: clone.textContent || "",
  };
}

function cleanMedium(doc) {
  const article = doc.querySelector("article");

  if (!article) return null;

  const clone = article.cloneNode(true);

  clone.querySelectorAll(`
    button, svg, aside, form, iframe,
    [role="button"], [aria-hidden="true"]
  `).forEach(el => el.remove());

  const title =
    doc.querySelector("h1")?.innerText ||
    doc.title.split("|")[0] ||
    "Untitled";

  return {
    title,
    content: clone.innerHTML,
    textContent: clone.textContent || ""
  };
}
function cleanGeneric(doc) {
  // remove junk first
  doc.querySelectorAll(`
    script, style, iframe, nav, header, footer, aside,
    .ads, .advertisement, .promo, .popup, .modal, .cookie
  `).forEach(el => el.remove());

  const reader = new Readability(doc);
  const article = reader.parse();

  if (!article || !article.content) return null;

  return {
    title: article.title || doc.title || "Untitled",
    content: article.content,
    textContent: article.textContent || ""
  };
}


async function fetchWithBrowserless(url) {
  if (!BROWSERLESS_TOKEN) {
    throw new Error("BROWSERLESS_TOKEN is missing");
  }

  const endpoint = `${BROWSERLESS_CONTENT_URL}?token=${encodeURIComponent(
    BROWSERLESS_TOKEN
  )}`;

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

    const preferBrowserless = mode === "deep" || isMedium(domain);
    const { html, source } = await fetchHtml(url, preferBrowserless);

    const dom = new JSDOM(html, { url });
    const doc = cleanCommon(dom.window.document);

    let article = null;

    if (isWikipedia(domain)) {
      article = cleanWikipedia(doc);
    } else if (isBBC(domain)) {
      article = cleanBBC(doc);
    } else if (isMedium(domain)) {
      article = cleanMedium(doc);
    }

    if (!article) {
      article = cleanGeneric(doc);
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