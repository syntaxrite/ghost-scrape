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
  maxRedirects: 5,
  maxContentLength: 8 * 1024 * 1024,
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
  filter: ["img", "picture", "source", "svg"],
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

function looksLikeChallenge(html) {
  const s = String(html || "").toLowerCase();
  return (
    s.includes("performing security verification") ||
    s.includes("verify you are not a bot") ||
    s.includes("security verification") ||
    s.includes("captcha") ||
    s.includes("access denied") ||
    s.includes("unusual traffic")
  );
}

function cleanCommon(doc) {
  doc.querySelectorAll(`
    script, style, iframe, nav, footer, header, aside, form, button, svg, noscript,
    .ads, .ad, .advertisement, .promo, .popup, .modal, .cookie, .newsletter,
    .subscribe, .sidebar, .share, .related, .recommendations
  `).forEach((el) => el.remove());

  return doc;
}

function cloneAndClean(node, extraRemoveSelectors = "") {
  const clone = node.cloneNode(true);
  const selectors = [
    "script",
    "style",
    "iframe",
    "nav",
    "footer",
    "header",
    "aside",
    "form",
    "button",
    "svg",
    "noscript",
    ".mw-editsection",
    ".reference",
    "sup.reference",
    ".hatnote",
    ".toc",
    ".navbox",
    ".vertical-navbox",
    ".ambox",
    ".infobox",
    ".mw-jump-link",
    ".mw-references-wrap",
    extraRemoveSelectors,
  ]
    .filter(Boolean)
    .join(", ");

  clone.querySelectorAll(selectors).forEach((el) => el.remove());
  return clone;
}

function textLength(node) {
  return (node?.textContent || "").replace(/\s+/g, " ").trim().length;
}

function countParagraphs(node) {
  return node ? node.querySelectorAll("p").length : 0;
}

function scoreNode(node) {
  if (!node) return -1;
  const text = textLength(node);
  const paragraphs = countParagraphs(node);
  const headings = node.querySelectorAll("h1,h2,h3,h4,h5,h6").length;
  return text + paragraphs * 120 + headings * 30;
}

function pickBestContainer(doc) {
  const candidates = [
    doc.querySelector("article"),
    doc.querySelector("main"),
    doc.querySelector('[role="main"]'),
    doc.querySelector("#content"),
    doc.querySelector("#mw-content-text"),
    doc.body,
  ].filter(Boolean);

  let best = candidates[0];
  let bestScore = -1;

  for (const node of candidates) {
    const score = scoreNode(node);
    if (score > bestScore) {
      best = node;
      bestScore = score;
    }
  }

  return best;
}

function extractWikipedia(doc) {
  const title =
    doc.querySelector("#firstHeading")?.textContent?.trim() ||
    doc.title?.replace(/\s*-\s*Wikipedia$/, "").trim() ||
    "Untitled";

  const content = doc.querySelector("#mw-content-text .mw-parser-output");
  if (!content) return null;

  const cleaned = cloneAndClean(content, ".mw-empty-elt");
  const text = cleaned.textContent || "";

  return {
    title,
    content: cleaned.innerHTML,
    textContent: text,
  };
}

function extractBBC(doc) {
  const title =
    doc.querySelector("h1")?.textContent?.trim() ||
    doc.title?.split(" - ")[0]?.trim() ||
    "Untitled";

  const blocks = [...doc.querySelectorAll('[data-component="text-block"]')];
  if (blocks.length > 0) {
    const html = blocks
      .map((b) => {
        const t = (b.textContent || "").trim();
        return t ? `<p>${escapeHtml(t)}</p>` : "";
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

  const container = pickBestContainer(doc);
  if (!container) return null;

  const cleaned = cloneAndClean(container);
  const text = cleaned.textContent || "";
  return {
    title,
    content: cleaned.innerHTML,
    textContent: text,
  };
}

function extractMedium(doc) {
  const title =
    doc.querySelector("h1")?.textContent?.trim() ||
    doc.title?.split("|")[0]?.trim() ||
    "Untitled";

  const container = doc.querySelector("article") || doc.querySelector("main") || pickBestContainer(doc);
  if (!container) return null;

  const cleaned = cloneAndClean(container, '[aria-hidden="true"], [role="button"]');
  const text = cleaned.textContent || "";

  return {
    title,
    content: cleaned.innerHTML,
    textContent: text,
  };
}

function extractGeneric(doc) {
  const reader = new Readability(doc, {
    keepClasses: false,
  });

  const article = reader.parse();
  if (article && article.content) {
    return {
      title: article.title || doc.title || "Untitled",
      content: article.content,
      textContent: article.textContent || "",
    };
  }

  const container = pickBestContainer(doc);
  if (!container) return null;

  const cleaned = cloneAndClean(container);
  return {
    title: doc.title || "Untitled",
    content: cleaned.innerHTML,
    textContent: cleaned.textContent || "",
  };
}

function prettyMarkdown(md) {
  return String(md || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/g, "")
    .replace(/^\s*-\s*$/gm, "")
    .trim();
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildMarkdown(title, html) {
  const body = turndown.turndown(html || "");
  const cleanedBody = prettyMarkdown(body);
  if (!title) return cleanedBody;
  return prettyMarkdown(`# ${title}\n\n${cleanedBody}`);
}

async function fetchBrowserless(url) {
  if (!BROWSERLESS_TOKEN) throw new Error("BROWSERLESS_TOKEN is missing");

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

async function fetchSmart(url, domain, mode) {
  const forceBrowser = isMedium(domain) || mode === "deep";

  if (forceBrowser) {
    const html = await fetchBrowserless(url);
    return { html, source: "browserless" };
  }

  try {
    const response = await http.get(url, { responseType: "text" });
    return { html: response.data, source: "axios" };
  } catch (err) {
    const status = err?.response?.status;
    if (status === 403 || status === 429 || status === 503) {
      const html = await fetchBrowserless(url);
      return { html, source: "browserless-retry" };
    }
    throw err;
  }
}

function isWeak(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  return words < 80;
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Use GET" });
  }

  try {
    let { url, mode } = req.query;
    url = normalizeUrl(url);

    const domain = domainOf(url);
    const preferBrowserless = isMedium(domain) || mode === "deep";

    let { html, source } = await fetchSmart(url, domain, mode);

    if (looksLikeChallenge(html)) {
      return res.status(403).json({
        success: false,
        error: "This site returned a security verification page. That page is not supported reliably.",
        domain,
        source,
      });
    }

    let dom = new JSDOM(html, { url });
    let doc = cleanCommon(dom.window.document);

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

    if (!article || isWeak(article.textContent)) {
      if (!preferBrowserless) {
        const retryHtml = await fetchBrowserless(url);

        if (looksLikeChallenge(retryHtml)) {
          return res.status(403).json({
            success: false,
            error: "This site returned a security verification page. That page is not supported reliably.",
            domain,
            source: "browserless-retry",
          });
        }

        source = "browserless-retry";
        dom = new JSDOM(retryHtml, { url });
        doc = cleanCommon(dom.window.document);

        article =
          (isWikipedia(domain) && extractWikipedia(doc)) ||
          (isBBC(domain) && extractBBC(doc)) ||
          (isMedium(domain) && extractMedium(doc)) ||
          extractGeneric(doc);
      }
    }

    if (!article || !article.content) {
      throw new Error("Extraction failed");
    }

    const title = article.title || "Untitled";
    const markdown = buildMarkdown(title, article.content);
    const wordCount = article.textContent.split(/\s+/).filter(Boolean).length;

    dom.window.close();

    return res.status(200).json({
      success: true,
      source,
      domain,
      title,
      wordCount,
      readingTime: `${Math.max(1, Math.ceil(wordCount / 200))} min`,
      markdown,
    });
  } catch (err) {
    console.error("SCRAPE ERROR:", err?.response?.status, err?.message);

    return res.status(500).json({
      success: false,
      error: err?.response?.status
        ? `Upstream returned ${err.response.status}`
        : err.message || "Unknown error",
    });
  }
};