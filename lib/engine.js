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
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  },
});

function classifyDomain(domain) {
  if (domain.includes("wikipedia.org")) return "wikipedia";
  if (domain.includes("reddit.com")) return "reddit";
  if (domain.includes("medium.com")) return "medium";
  if (domain.includes("quora.com")) return "quora";
  return "generic";
}

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

  // Reddit comment/post pages
  if (u.pathname.includes("/comments/")) {
    if (!u.pathname.endsWith("/")) u.pathname += "/";
    u.pathname += ".json";
    u.searchParams.set("raw_json", "1");
    return u.toString();
  }

  // Subreddit listing pages
  if (u.pathname.startsWith("/r/")) {
    if (!u.pathname.endsWith("/")) u.pathname += "/";
    u.pathname += ".json";
    return u.toString();
  }

  return null;
}

function isJsonLike(body, contentType) {
  const s = String(body || "").trim();
  return (
    String(contentType || "").toLowerCase().includes("application/json") ||
    s.startsWith("{") ||
    s.startsWith("[")
  );
}

function redditJsonToHtml(jsonText) {
  try {
    const data = JSON.parse(jsonText);
    const post = Array.isArray(data)
      ? data?.[0]?.data?.children?.[0]?.data
      : null;

    if (!post) return null;

    const title = post.title || "Reddit post";
    const body = String(post.selftext || "").trim();
    const metaBits = [
      post.subreddit ? `r/${post.subreddit}` : null,
      post.author ? `u/${post.author}` : null,
      post.num_comments != null ? `${post.num_comments} comments` : null,
    ].filter(Boolean);

    const metaHtml = metaBits.length
      ? `<p><em>${escapeHtml(metaBits.join(" • "))}</em></p>`
      : "";

    const bodyHtml = body
      ? `<p>${escapeHtml(body).replace(/\n/g, "<br>")}</p>`
      : "<p></p>";

    return `<article><header><h1>${escapeHtml(title)}</h1>${metaHtml}</header>${bodyHtml}</article>`;
  } catch {
    return null;
  }
}

async function fetchDirect(candidateUrl) {
  const res = await http.get(candidateUrl);
  const html = typeof res.data === "string" ? res.data : String(res.data || "");
  const finalUrl = res.request?.res?.responseUrl || candidateUrl;

  return {
    status: res.status,
    html,
    contentType: String(res.headers?.["content-type"] || ""),
    finalUrl,
  };
}

function looksBlocked(status, html) {
  if ([401, 403, 429].includes(Number(status))) return true;

  const s = String(html || "").toLowerCase();

  // Keep this strict to avoid false positives like Wikipedia.
  return [
    "cf-browser-verification",
    "/cdn-cgi/challenge",
    "captcha",
    "hcaptcha",
    "verify you are human",
    "access denied",
    "blocked by network security",
    "login to continue",
    "sign in to continue",
  ].some((term) => s.includes(term));
}

function isUsableHtml(html) {
  if (!html) return false;
  const text = String(html).replace(/<[^>]*>/g, "").trim();
  return text.length > 120;
}

async function fetchBrowserless(url) {
  if (!BROWSERLESS_TOKEN) {
    throw new Error("Browserless not configured");
  }

  const res = await axios.post(
    `${BROWSERLESS_URL}?token=${BROWSERLESS_TOKEN}`,
    { url },
    {
      timeout: 25000,
      responseType: "text",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/html,*/*",
      },
    }
  );

  const html = typeof res.data === "string" ? res.data : String(res.data || "");
  if (!html.trim()) throw new Error("Empty browserless response");
  return html;
}

async function fetchWikipedia(normalized) {
  // Wikipedia should be direct-fetch first, no Browserless by default.
  const attempts = [
    normalized,
    normalized.replace("https://", "https://m."),
  ];

  for (const url of attempts) {
    try {
      const res = await fetchDirect(url);
      if (isUsableHtml(res.html) && !looksBlocked(res.status, res.html)) {
        return {
          html: res.html,
          source: "axios",
          sourceType: "wikipedia",
          canonicalUrl: res.finalUrl || normalized,
          wasBlocked: false,
        };
      }
    } catch {
      // try next attempt
    }
  }

  throw new Error("Wikipedia fetch failed");
}

async function fetchReddit(normalized) {
  const jsonUrl = toRedditJson(normalized);
  if (jsonUrl) {
    try {
      const res = await fetchDirect(jsonUrl);
      if (isJsonLike(res.html, res.contentType)) {
        const wrapped = redditJsonToHtml(res.html);
        if (wrapped) {
          return {
            html: wrapped,
            source: "reddit-json",
            sourceType: "reddit",
            canonicalUrl: normalized,
            wasBlocked: false,
          };
        }
      }
    } catch {
      // continue
    }
  }

  try {
    const oldUrl = toOldReddit(normalized);
    if (oldUrl) {
      const res = await fetchDirect(oldUrl);
      if (isUsableHtml(res.html) && !looksBlocked(res.status, res.html)) {
        return {
          html: res.html,
          source: "old-reddit",
          sourceType: "reddit",
          canonicalUrl: oldUrl,
          wasBlocked: false,
        };
      }
    }
  } catch {
    // continue
  }

  return null;
}

async function fetchGeneric(normalized, site) {
  // direct fetch first
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchDirect(normalized);
      if (isUsableHtml(res.html) && !looksBlocked(res.status, res.html)) {
        return {
          html: res.html,
          source: "axios",
          sourceType: site,
          canonicalUrl: res.finalUrl || normalized,
          wasBlocked: false,
        };
      }
    } catch {
      // retry
    }

    await new Promise((r) => setTimeout(r, 400));
  }

  // Browserless last resort for public pages that need JS rendering
  try {
    const html = await fetchBrowserless(normalized);

    if (isUsableHtml(html) && !looksBlocked(200, html)) {
      return {
        html,
        source: "browserless",
        sourceType: site,
        canonicalUrl: normalized,
        wasBlocked: true,
      };
    }
  } catch {
    // fall through
  }

  return null;
}

async function fetchSmart(inputUrl) {
  const normalized = stripTrackingParams(normalizeUrl(inputUrl));
  const domain = getDomain(normalized);
  const site = classifyDomain(domain);

  if (site === "wikipedia") {
    return fetchWikipedia(normalized);
  }

  if (site === "reddit") {
    const reddit = await fetchReddit(normalized);
    if (reddit) return reddit;
    throw new Error("Reddit fetch failed");
  }

  // Medium / Quora / generic public pages
  const generic = await fetchGeneric(normalized, site);
  if (generic) return generic;

  throw new Error("Failed to fetch usable content");
}

module.exports = {
  fetchSmart,
  getDomain,
};
