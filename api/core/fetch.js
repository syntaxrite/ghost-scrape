const axios = require("axios");

// ---------- CONFIG ----------
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;
const BROWSERLESS_URL =
  process.env.BROWSERLESS_CONTENT_URL || "https://chrome.browserless.io/content";

// ---------- AXIOS INSTANCE ----------
const http = axios.create({
  timeout: 15000,
  maxRedirects: 5,
  maxContentLength: 8 * 1024 * 1024,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  },
});

// ---------- HELPERS ----------
function isLikelyHTML(html) {
  if (!html) return false;
  return html.includes("<html") || html.includes("<body");
}

function isTooSmall(html) {
  return !html || html.length < 2000;
}

function looksBlocked(html) {
  const s = String(html || "").toLowerCase();

  return (
    s.includes("cf-browser-verification") ||
    s.includes("checking your browser") ||
    s.includes("access denied") ||
    s.includes("captcha") ||
    (s.includes("verify you are not a bot") &&
      s.includes("security verification"))
  );
}

// ---------- BROWSERLESS ----------
async function fetchBrowserless(url) {
  if (!BROWSERLESS_TOKEN) {
    throw new Error("Missing BROWSERLESS_TOKEN");
  }

  const res = await axios.post(
    `${BROWSERLESS_URL}?token=${encodeURIComponent(BROWSERLESS_TOKEN)}`,
    { url },
    {
      timeout: 30000,
      responseType: "text",
      transformResponse: [(d) => d],
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  return res.data;
}

// ---------- MAIN FETCH ----------
async function fetchSmart(url, { forceBrowser = false } = {}) {
  let html = null;
  let source = "axios";

  // 1. FORCE browser (for Medium etc)
  if (forceBrowser) {
    html = await fetchBrowserless(url);
    source = "browserless";
  } else {
    try {
      const res = await http.get(url, { responseType: "text" });
      html = res.data;
      source = "axios";
    } catch (err) {
      const status = err?.response?.status;

      // fallback on blocked responses
      if (status === 403 || status === 429 || status === 503) {
        html = await fetchBrowserless(url);
        source = "browserless-fallback";
      } else {
        throw err;
      }
    }
  }

  // 2. VALIDATION (this is VERY important)
  if (!isLikelyHTML(html) || isTooSmall(html) || looksBlocked(html)) {
    // retry with browserless if not already
    if (source === "axios") {
      const retryHtml = await fetchBrowserless(url);

      if (retryHtml && retryHtml.length > html.length) {
        return {
          html: retryHtml,
          source: "browserless-retry",
        };
      }
    }
  }

  return { html, source };
}

module.exports = {
  fetchSmart,
  fetchBrowserless,
};