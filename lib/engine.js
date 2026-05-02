const axios = require("axios");
const {
  normalizeUrl,
  getDomain,
  stripTrackingParams,
  escapeHtml,
} = require("./utils");

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;
const BROWSERLESS_URL =
  process.env.BROWSERLESS_URL || "https://chrome.browserless.io/content";

const http = axios.create({
  timeout: 10000,
  maxRedirects: 5,
  responseType: "text",
  validateStatus: () => true,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  },
});

// --------------------
// CLASSIFIER
// --------------------
function classifyDomain(domain) {
  if (domain.includes("wikipedia.org")) return "wikipedia";
  if (domain.includes("reddit.com")) return "reddit";
  if (domain.includes("medium.com")) return "medium";
  if (domain.includes("quora.com")) return "quora";
  return "generic";
}

// --------------------
// REDDIT HELPERS
// --------------------
function toOldReddit(url) {
  const u = new URL(url);
  if (u.hostname.includes("reddit.com")) {
    u.hostname = "old.reddit.com";
    return u.toString();
  }
  return null;
}

function toRedditJson(url) {
  const u = new URL(url);

  if (!u.hostname.includes("reddit.com")) return null;

  if (u.pathname.includes("/comments/")) {
    if (!u.pathname.endsWith("/")) u.pathname += "/";
    u.pathname += ".json";
    u.searchParams.set("raw_json", "1");
    return u.toString();
  }

  return null;
}

function redditJsonToHtml(jsonText) {
  try {
    const data = JSON.parse(jsonText);
    const post = data?.[0]?.data?.children?.[0]?.data;
    if (!post) return null;

    const title = post.title || "Reddit post";
    const body = post.selftext || "";

    return `
      <article>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(body).replace(/\n/g, "<br>")}</p>
      </article>
    `;
  } catch {
    return null;
  }
}

// --------------------
// FETCH CORE
// --------------------
async function fetchDirect(url) {
  const res = await http.get(url);
  return {
    status: res.status,
    html: typeof res.data === "string" ? res.data : "",
    finalUrl: res.request?.res?.responseUrl || url,
  };
}

// --------------------
// BLOCK DETECTION (FIXED)
// --------------------
function looksBlocked(status, html) {
  if ([401, 403, 429].includes(status)) return true;

  const s = html.toLowerCase();

  // STRICT ONLY — avoid false positives
  return [
    "cf-browser-verification",
    "/cdn-cgi/challenge",
    "captcha",
    "hcaptcha",
  ].some((t) => s.includes(t));
}

// --------------------
// QUALITY CHECK (NEW)
// --------------------
function isUsableHtml(html) {
  if (!html) return false;

  const text = html.replace(/<[^>]*>/g, "").trim();

  return text.length > 200; // relaxed threshold
}

// --------------------
// BROWSERLESS
// --------------------
async function fetchBrowserless(url) {
  if (!BROWSERLESS_TOKEN) {
    throw new Error("Browserless not configured");
  }

  const res = await axios.post(
    `${BROWSERLESS_URL}?token=${BROWSERLESS_TOKEN}`,
    { url },
    { timeout: 25000 }
  );

  const html = typeof res.data === "string" ? res.data : "";
  if (!html) throw new Error("Empty browserless response");

  return html;
}

// --------------------
// MAIN ENGINE
// --------------------
async function fetchSmart(inputUrl) {
  const normalized = stripTrackingParams(normalizeUrl(inputUrl));
  const domain = getDomain(normalized);
  const site = classifyDomain(domain);

  // --------------------
  // 1. REDDIT JSON FAST PATH
  // --------------------
  if (site === "reddit") {
    const jsonUrl = toRedditJson(normalized);
    if (jsonUrl) {
      try {
        const res = await fetchDirect(jsonUrl);
        const html = redditJsonToHtml(res.html);
        if (html) {
          return {
            html,
            source: "reddit-json",
            sourceType: "reddit",
            canonicalUrl: normalized,
            wasBlocked: false,
          };
        }
      } catch {}
    }
  }

  // --------------------
  // 2. DIRECT FETCH + RETRY
  // --------------------
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetchDirect(normalized);

      if (!looksBlocked(res.status, res.html) && isUsableHtml(res.html)) {
        return {
          html: res.html,
          source: "axios",
          sourceType: site,
          canonicalUrl: res.finalUrl,
          wasBlocked: false,
        };
      }
    } catch {}

    await new Promise((r) => setTimeout(r, 500)); // retry delay
  }

  // --------------------
  // 3. OLD REDDIT FALLBACK
  // --------------------
  if (site === "reddit") {
    try {
      const oldUrl = toOldReddit(normalized);
      if (oldUrl) {
        const res = await fetchDirect(oldUrl);
        if (isUsableHtml(res.html)) {
          return {
            html: res.html,
            source: "old-reddit",
            sourceType: "reddit",
            canonicalUrl: oldUrl,
            wasBlocked: false,
          };
        }
      }
    } catch {}
  }

  // --------------------
  // 4. BROWSERLESS (LAST RESORT)
  // --------------------
  try {
    const html = await fetchBrowserless(normalized);

    if (isUsableHtml(html)) {
      return {
        html,
        source: "browserless",
        sourceType: site,
        canonicalUrl: normalized,
        wasBlocked: true,
      };
    }
  } catch (err) {
    throw new Error(err.message);
  }

  // --------------------
  // FAIL ONLY HERE
  // --------------------
  throw new Error("Failed to fetch usable content");
}

module.exports = {
  fetchSmart,
  getDomain,
};
