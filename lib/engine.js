const axios = require("axios");

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;
const BROWSERLESS_URL = "https://chrome.browserless.io/content";

const http = axios.create({
  timeout: 15000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/123.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  },
});

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function getSiteType(domain) {
  if (domain.includes("wikipedia.org")) return "wikipedia";
  if (domain.includes("bbc.com") || domain.includes("cnn.com") || domain.includes("nytimes.com")) return "news";
  if (domain.includes("developer.mozilla.org") || domain.includes("docs.python.org")) return "docs";
  return "blog";
}

async function fetchSmart(url, forceBrowser = false) {
  if (forceBrowser && BROWSERLESS_TOKEN) {
    const res = await axios.post(`${BROWSERLESS_URL}?token=${BROWSERLESS_TOKEN}`, { url });
    return { html: res.data, source: "browserless" };
  }

  try {
    const res = await http.get(url);
    return { html: res.data, source: "axios" };
  } catch (err) {
    if ([403, 429, 503].includes(err?.response?.status) && BROWSERLESS_TOKEN) {
      const res = await axios.post(`${BROWSERLESS_URL}?token=${BROWSERLESS_TOKEN}`, { url });
      return { html: res.data, source: "browserless-fallback" };
    }
    throw err;
  }
}

function shouldRetry(article, source, wordCount) {
  if (source.includes("browserless")) return false; // Already tried the big guns
  return !article || wordCount < 250;
}

module.exports = { getDomain, getSiteType, fetchSmart, shouldRetry };