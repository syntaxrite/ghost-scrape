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
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    DNT: "1",
    "Sec-CH-UA": '"Chromium";v="123", "Google Chrome";v="123", ";Not A Brand";v="99"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"Windows"',
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

  if (u.pathname.includes("/comments/")) {
    if (!u.pathname.endsWith("/")) u.pathname += "/";
    u.pathname += ".json";
    u.searchParams.set("raw_json", "1");
    return u.toString();
  }

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

function isHtmlLike(body) {
  const s = String(body || "").trim().toLowerCase();
  return s.includes("<html") || s.includes("<!doctype html") || s.includes("<article") || s.includes("<main");
}

function jsonToHtmlMaybe(raw) {
  const s = String(raw || "").trim();
  if (!s || (!s.startsWith("{") && !s.startsWith("["))) return null;

  try {
    const data = JSON.parse(s);

    const extractFromObject = (obj) => {
      if (!obj || typeof obj !== "object") return null;

      const title =
        obj.title ||
        obj.headline ||
        obj.name ||
        obj.pageTitle ||
        obj.seoTitle ||
        "";

      const body =
        obj.content ||
        obj.body ||
        obj.articleBody ||
        obj.description ||
        obj.text ||
        obj.summary ||
        obj.html ||
        "";

      if (typeof body === "string" && body.trim()) {
        return {
          title: String(title || "Document"),
          body: String(body),
        };
      }

      return null;
    };

    if (Array.isArray(data)) {
      const first = data[0];

      if (first && typeof first === "object") {
        if (first?.data?.children?.[0]?.data?.selftext || first?.data?.children?.[0]?.data?.title) {
          const post = first.data.children[0].data;
          const title = post.title || "Reddit post";
          const body = String(post.selftext || post.body || "").trim();
          if (body) {
            return `<article><header><h1>${escapeHtml(title)}</h1></header><p>${escapeHtml(body).replace(/\n/g, "<br>")}</p></article>`;
          }
        }

        const maybe = extractFromObject(first);
        if (maybe) {
          return `<article><header><h1>${escapeHtml(maybe.title)}</h1></header><p>${escapeHtml(String(maybe.body)).replace(/\n/g, "<br>")}</p></article>`;
        }
      }

      return null;
    }

    const maybe = extractFromObject(data);
    if (maybe) {
      return `<article><header><h1>${escapeHtml(maybe.title)}</h1></header><p>${escapeHtml(String(maybe.body)).replace(/\n/g, "<br>")}</p></article>`;
    }

    const nested = ["data", "result", "article", "pageProps"].map((key) => data?.[key]).find(Boolean);
    if (nested && typeof nested === "object") {
      const fallback = extractFromObject(nested);
      if (fallback) {
        return `<article><header><h1>${escapeHtml(fallback.title)}</h1></header><p>${escapeHtml(String(fallback.body)).replace(/\n/g, "<br>")}</p></article>`;
      }
    }

    return null;
  } catch {
    return null;
  }
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
    "just a moment",
  ].some((term) => s.includes(term)) || isBlockedText(s);
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

  const endpoint = `${BROWSERLESS_URL}?token=${encodeURIComponent(BROWSERLESS_TOKEN)}`;

  const res = await axios.post(
    endpoint,
    { url },
    {
      timeout: 30000,
      responseType: "text",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/html,*/*",
      },
      validateStatus: () => true,
    }
  );

  const html = typeof res.data === "string" ? res.data : String(res.data || "");
  if (!html.trim()) throw new Error("Empty browserless response");

  return {
    html,
    status: res.status,
    finalUrl: url,
  };
}

async function fetchWikipedia(normalized) {
  const attempts = [normalized];

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

      const wrapped = jsonToHtmlMaybe(res.html);
      if (wrapped) {
        return {
          html: wrapped,
          source: "json",
          sourceType: "wikipedia",
          canonicalUrl: res.finalUrl || normalized,
          wasBlocked: false,
        };
      }
    } catch {
      // try next
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
        const wrapped = redditJsonToHtml(res.html) || jsonToHtmlMaybe(res.html);
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

  try {
    if (BROWSERLESS_TOKEN) {
      const rendered = await fetchBrowserless(normalized);
      if (isUsableHtml(rendered.html) && !looksBlocked(rendered.status, rendered.html)) {
        return {
          html: rendered.html,
          source: "browserless",
          sourceType: "reddit",
          canonicalUrl: rendered.finalUrl || normalized,
          wasBlocked: true,
        };
      }
    }
  } catch {
    // fall through
  }

  return null;
}

async function fetchGeneric(normalized, site) {
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

      const wrapped = jsonToHtmlMaybe(res.html);
      if (wrapped) {
        return {
          html: wrapped,
          source: "json",
          sourceType: site,
          canonicalUrl: res.finalUrl || normalized,
          wasBlocked: false,
        };
      }
    } catch {
      // retry
    }

    await new Promise((r) => setTimeout(r, 300 + attempt * 250));
  }

  try {
    const html = await fetchBrowserless(normalized);

    if (isUsableHtml(html.html) && !looksBlocked(html.status, html.html)) {
      return {
        html: html.html,
        source: "browserless",
        sourceType: site,
        canonicalUrl: html.finalUrl || normalized,
        wasBlocked: true,
      };
    }
  } catch {
    // fall through
  }

  return null;
}

async function fetchSmart(inputUrl) {
  const validated = await validatePublicUrl(inputUrl);
  const normalized = stripTrackingParams(validated);
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

  const generic = await fetchGeneric(normalized, site);
  if (generic) return generic;

  throw new Error("Failed to fetch usable content");
}

module.exports = {
  fetchSmart,
  getDomain,
};
