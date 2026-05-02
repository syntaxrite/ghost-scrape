const axios = require("axios");
const {
  normalizeUrl,
  getDomain,
  stripTrackingParams,
  escapeHtml,
  isBlockedText,
} = require("./utils");

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;
const BROWSERLESS_URL = process.env.BROWSERLESS_URL || "https://chrome.browserless.io/content";

const http = axios.create({
  timeout: 12000,
  maxRedirects: 5,
  responseType: "text",
  validateStatus: () => true,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
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
  const host = u.hostname.replace(/^www\./i, "").toLowerCase();
  if (host.endsWith("reddit.com")) {
    u.hostname = "old.reddit.com";
    return u.toString();
  }
  return url;
}

function toRedditJson(url) {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./i, "").toLowerCase();

  if (!host.endsWith("reddit.com")) return null;

  // Submission/comment pages
  if (u.pathname.includes("/comments/")) {
    if (!u.pathname.endsWith("/")) u.pathname += "/";
    u.pathname += ".json";
    u.searchParams.set("raw_json", "1");
    u.searchParams.set("limit", "1");
    return u.toString();
  }

  // Subreddit / listing pages
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
  const s = String(html || "").toLowerCase();

  if ([401, 403, 404, 429].includes(Number(status))) return true;

  return [
    "just a moment",
    "access denied",
    "forbidden",
    "captcha",
    "verify you are human",
    "enable javascript",
    "sign in to continue",
    "log in to continue",
    "login to continue",
    "are you a robot",
    "cloudflare",
  ].some((term) => s.includes(term));
}

async function fetchBrowserlessHtml(url) {
  if (!BROWSERLESS_TOKEN) {
    throw new Error("Browserless not configured");
  }

  const res = await axios.post(
    `${BROWSERLESS_URL}?token=${BROWSERLESS_TOKEN}`,
    {
      url,
      gotoOptions: {
        waitUntil: "networkidle2",
      },
      waitFor: 1500,
    },
    {
      timeout: 30000,
      responseType: "text",
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  const html = typeof res.data === "string" ? res.data : String(res.data || "");
  if (!html.trim()) throw new Error("Empty browserless response");
  return html;
}

async function fetchSmart(inputUrl) {
  const normalized = stripTrackingParams(normalizeUrl(inputUrl));
  const domain = getDomain(normalized);
  const site = classifyDomain(domain);

  const candidates = [];

  if (site === "reddit") {
    const redditJson = toRedditJson(normalized);
    const oldReddit = toOldReddit(normalized);

    if (redditJson) candidates.push({ kind: "reddit-json", url: redditJson });
    if (oldReddit !== normalized) candidates.push({ kind: "reddit-old", url: oldReddit });
  }

  candidates.push({ kind: "direct", url: normalized });

  const seen = new Set();
  const unique = candidates.filter((c) => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });

  for (const candidate of unique) {
    try {
      const res = await fetchDirect(candidate.url);

      // Public Reddit JSON path
      if (site === "reddit" && candidate.kind === "reddit-json" && isJsonLike(res.html, res.contentType)) {
        const wrapped = redditJsonToHtml(res.html);
        if (wrapped) {
          return {
            html: wrapped,
            source: "reddit-json",
            sourceType: "reddit",
            canonicalUrl: candidate.url,
            wasBlocked: false,
          };
        }
      }

      if (!looksBlocked(res.status, res.html) && res.html && res.html.trim().length > 200) {
        return {
          html: res.html,
          source: candidate.kind === "reddit-old" ? "axios-old-reddit" : "axios",
          sourceType: site,
          canonicalUrl: res.finalUrl || candidate.url,
          wasBlocked: false,
        };
      }
    } catch {
      // try next path
    }
  }

  // Browserless fallback only for public pages that need rendering
  try {
    const html = await fetchBrowserlessHtml(normalized);

    if (looksBlocked(200, html)) {
      throw new Error("Blocked or login wall detected");
    }

    return {
      html,
      source: "browserless",
      sourceType: site,
      canonicalUrl: normalized,
      wasBlocked: true,
    };
  } catch (err) {
    throw new Error(
      err.message || "Access denied or unsupported page"
    );
  }
}

module.exports = {
  fetchSmart,
  getDomain,
};
