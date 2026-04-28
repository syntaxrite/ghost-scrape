const axios = require("axios");

// ---------- CONFIG & CONSTANTS ----------
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;
const BROWSERLESS_URL = process.env.BROWSERLESS_CONTENT_URL || "https://chrome.browserless.io/content";

const http = axios.create({
  timeout: 15000,
  maxRedirects: 5,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36",
  },
});

// ---------- SITE DETECTION ----------
function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch { return ""; }
}

function getSiteType(domain) {
  if (domain.includes("wikipedia.org")) return "wikipedia";
  if (domain.includes("bbc.com") || domain.includes("cnn.com") || domain.includes("nytimes.com")) return "news";
  if (domain.includes("docs.python.org") || domain.includes("developer.mozilla.org")) return "docs";
  return "blog";
}

function isHomepage(url) {
  try {
    const u = new URL(url);
    return u.pathname === "/" || u.pathname === "";
  } catch { return false; }
}

// ---------- FETCH LOGIC ----------
async function fetchBrowserless(url) {
  if (!BROWSERLESS_TOKEN) throw new Error("Missing BROWSERLESS_TOKEN");
  const res = await axios.post(`${BROWSERLESS_URL}?token=${encodeURIComponent(BROWSERLESS_TOKEN)}`, 
    { url }, { timeout: 30000 });
  return res.data;
}

async function fetchSmart(url, { forceBrowser = false } = {}) {
  let html = null;
  let source = "axios";

  if (forceBrowser) {
    html = await fetchBrowserless(url);
    source = "browserless";
  } else {
    try {
      const res = await http.get(url);
      html = res.data;
    } catch (err) {
      html = await fetchBrowserless(url);
      source = "browserless-fallback";
    }
  }
  return { html, source };
}

// ---------- SCORING & RETRY ----------
function getWordCount(text) {
  return String(text || "").split(/\s+/).filter(Boolean).length;
}

function shouldRetry(article, source) {
  if (!article || getWordCount(article.textContent) < 120) {
    return !source.includes("browserless");
  }
  return false;
}

module.exports = {
  getDomain,
  getSiteType,
  isHomepage,
  fetchSmart,
  getWordCount,
  shouldRetry
};