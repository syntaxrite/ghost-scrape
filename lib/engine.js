const { getAxiosProxyConfig } = require("./proxy");
const axios = require("axios");
const {
  validatePublicUrl,
  getDomain,
  stripTrackingParams,
  escapeHtml,
  isBlockedText,
} = require("./utils");

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;
const BROWSERLESS_URL =
  process.env.BROWSERLESS_URL || "https://chrome.browserless.io/content";

const http = axios.create({
  timeout: 12000,
  maxRedirects: 5,
  responseType: "text",
  validateStatus: () => true,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
  },
});

/* =========================
   EXISTING HELPERS (UNCHANGED)
========================= */

function classifyDomain(domain) {
  if (domain.includes("wikipedia.org")) return "wikipedia";
  if (domain.includes("reddit.com")) return "reddit";
  if (domain.includes("medium.com")) return "medium";
  if (domain.includes("quora.com")) return "quora";
  return "generic";
}

/* =========================
   PROXY-AWARE FETCH
========================= */

async function fetchDirect(url, sessionId) {
  const proxyConfig = getAxiosProxyConfig(sessionId);

  const res = await http.get(url, {
    ...proxyConfig,
  });

  return {
    status: res.status,
    html:
      typeof res.data === "string"
        ? res.data
        : String(res.data || ""),
    contentType: String(res.headers?.["content-type"] || ""),
    finalUrl: res.request?.res?.responseUrl || url,
  };
}

/* =========================
   BLOCK DETECTION
========================= */

function looksBlocked(status, html) {
  if ([401, 403, 429].includes(Number(status))) return true;

  const s = String(html || "").toLowerCase();

  return [
    "cf-browser-verification",
    "captcha",
    "verify you are human",
    "access denied",
    "just a moment",
  ].some((term) => s.includes(term)) || isBlockedText(s);
}

function isUsableHtml(html) {
  if (!html) return false;
  const text = String(html).replace(/<[^>]*>/g, "").trim();
  return text.length > 120;
}

/* =========================
   BROWSERLESS
========================= */

async function fetchBrowserless(url) {
  if (!BROWSERLESS_TOKEN) {
    throw new Error("Browserless not configured");
  }

  const endpoint = `${BROWSERLESS_URL}?token=${encodeURIComponent(BROWSERLESS_TOKEN)}`;

  const res = await axios.post(
    endpoint,
    { url },
    {
      timeout: 30000,
      responseType: "text",
      headers: {
        "Content-Type": "application/json",
      },
      validateStatus: () => true,
    }
  );

  return {
    html: String(res.data || ""),
    status: res.status,
    finalUrl: url,
  };
}

/* =========================
   REDDIT + WIKI (UPDATED)
========================= */

async function fetchWikipedia(normalized, sessionId) {
  try {
    const res = await fetchDirect(normalized, sessionId);

    if (isUsableHtml(res.html) && !looksBlocked(res.status, res.html)) {
      return {
        html: res.html,
        source: "proxy",
        sourceType: "wikipedia",
        canonicalUrl: res.finalUrl,
        wasBlocked: false,
      };
    }
  } catch {}

  throw new Error("Wikipedia fetch failed");
}

async function fetchReddit(normalized, sessionId) {
  try {
    const res = await fetchDirect(normalized, sessionId);

    if (isUsableHtml(res.html) && !looksBlocked(res.status, res.html)) {
      return {
        html: res.html,
        source: "proxy",
        sourceType: "reddit",
        canonicalUrl: res.finalUrl,
        wasBlocked: false,
      };
    }
  } catch {}

  try {
    const rendered = await fetchBrowserless(normalized);

    if (isUsableHtml(rendered.html)) {
      return {
        html: rendered.html,
        source: "browserless",
        sourceType: "reddit",
        canonicalUrl: normalized,
        wasBlocked: true,
      };
    }
  } catch {}

  return null;
}

/* =========================
   GENERIC (MAJOR UPGRADE)
========================= */

async function fetchGeneric(normalized, site, sessionId) {
  let currentSession = sessionId;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchDirect(normalized, currentSession);

      if (isUsableHtml(res.html) && !looksBlocked(res.status, res.html)) {
        return {
          html: res.html,
          source: "proxy",
          sourceType: site,
          canonicalUrl: res.finalUrl,
          wasBlocked: false,
        };
      }
    } catch {}

    // 🔥 rotate proxy AFTER failure
    currentSession = Math.random().toString(36).slice(2);

    await new Promise((r) => setTimeout(r, 400 + attempt * 300));
  }

  // fallback
  try {
    const rendered = await fetchBrowserless(normalized);

    if (isUsableHtml(rendered.html)) {
      return {
        html: rendered.html,
        source: "browserless",
        sourceType: site,
        canonicalUrl: normalized,
        wasBlocked: true,
      };
    }
  } catch {}

  return null;
}

/* =========================
   MAIN ENTRY
========================= */

async function fetchSmart(inputUrl) {
  const validated = await validatePublicUrl(inputUrl);
  const normalized = stripTrackingParams(validated);
  const domain = getDomain(normalized);
  const site = classifyDomain(domain);

  // 🔑 sticky session per request
  const sessionId = Math.random().toString(36).slice(2);

  if (site === "wikipedia") {
    return fetchWikipedia(normalized, sessionId);
  }

  if (site === "reddit") {
    const reddit = await fetchReddit(normalized, sessionId);
    if (reddit) return reddit;
    throw new Error("Reddit fetch failed");
  }

  const generic = await fetchGeneric(normalized, site, sessionId);
  if (generic) return generic;

  throw new Error("Failed to fetch usable content");
}

module.exports = {
  fetchSmart,
  getDomain,
};
