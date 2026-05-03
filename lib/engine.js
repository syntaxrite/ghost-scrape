const axios = require("axios");
const { getAxiosProxyConfig } = require("./proxy");
const {
  validatePublicUrl,
  getDomain,
  stripTrackingParams,
  escapeHtml,
  isBlockedText,
} = require("./utils");

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;
const BROWSERLESS_URL = process.env.BROWSERLESS_URL || "https://chrome.browserless.io/content";

const http = axios.create({
  timeout: 15000,
  maxRedirects: 5,
  responseType: "text",
  validateStatus: () => true,
  decompress: true,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.6",
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

function looksBlocked(status, html) {
  if ([401, 403, 429].includes(Number(status))) return true;

  const s = String(html || "").toLowerCase();
  return [
    "cf-browser-verification",
    "captcha",
    "verify you are human",
    "access denied",
    "just a moment",
    "robot check",
    "attention required",
    "enable javascript",
  ].some((term) => s.includes(term)) || isBlockedText(s);
}

function isUsableHtml(html) {
  if (!html) return false;
  const text = String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > 120;
}

function maybeJson(input) {
  const text = String(input || "").trim();
  if (!text) return null;
  if (!(text.startsWith("{") || text.startsWith("["))) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function collectReadablePairs(input, path = [], output = [], depth = 0) {
  if (depth > 6 || output.length > 180) return output;

  if (input === null || input === undefined) {
    return output;
  }

  if (typeof input === "string" || typeof input === "number" || typeof input === "boolean") {
    const value = String(input).trim();
    if (value) output.push({ key: path.join(" / ") || "value", value });
    return output;
  }

  if (Array.isArray(input)) {
    input.slice(0, 15).forEach((item, index) => {
      collectReadablePairs(item, [...path, `item ${index + 1}`], output, depth + 1);
    });
    return output;
  }

  if (typeof input === "object") {
    const preferredKeys = ["title", "headline", "name", "author", "byline", "description", "summary", "text", "body", "content", "articleBody", "selftext"];

    for (const key of preferredKeys) {
      if (key in input) {
        const value = input[key];
        if (typeof value === "string" && value.trim()) {
          output.push({ key: path.concat(key).join(" / ") || key, value: String(value).trim() });
        }
      }
    }

    for (const [key, value] of Object.entries(input)) {
      if (output.length > 180) break;
      if (preferredKeys.includes(key)) continue;
      collectReadablePairs(value, [...path, key], output, depth + 1);
    }
  }

  return output;
}

function inferJsonTitle(data) {
  if (!data || typeof data !== "object") return "JSON response";
  const candidates = [data.title, data.headline, data.name, data.pageTitle, data.subject];
  return candidates.map((v) => String(v || "").trim()).find(Boolean) || "JSON response";
}

function jsonToHtml(payload, fallbackTitle = "JSON response") {
  const title = inferJsonTitle(payload) || fallbackTitle;
  const pairs = collectReadablePairs(payload).slice(0, 120);
  const sections = pairs.length
    ? pairs
        .map(({ key, value }) => `
          <section>
            <h2>${escapeHtml(key)}</h2>
            <p>${escapeHtml(value).replace(/\n/g, "<br>")}</p>
          </section>
        `)
        .join("")
    : `<p>${escapeHtml(JSON.stringify(payload, null, 2)).replace(/\n/g, "<br>")}</p>`;

  return `
    <article>
      <header>
        <h1>${escapeHtml(title)}</h1>
      </header>
      ${sections}
    </article>
  `;
}

async function fetchDirect(url, sessionId) {
  const proxyConfig = getAxiosProxyConfig(sessionId);

  const res = await http.get(url, {
    ...proxyConfig,
  });

  const contentType = String(res.headers?.["content-type"] || "").toLowerCase();
  const body = typeof res.data === "string" ? res.data : String(res.data || "");
  const finalUrl = res.request?.res?.responseUrl || url;
  const parsedJson = contentType.includes("application/json") ? maybeJson(body) : null;

  if (parsedJson) {
    return {
      status: res.status,
      html: jsonToHtml(parsedJson, inferJsonTitle(parsedJson)),
      payload: parsedJson,
      contentType,
      finalUrl,
      source: "json",
      sourceType: "json",
      wasBlocked: false,
    };
  }

  if (!parsedJson && body.trim().startsWith("{")) {
    const loose = maybeJson(body);
    if (loose) {
      return {
        status: res.status,
        html: jsonToHtml(loose, inferJsonTitle(loose)),
        payload: loose,
        contentType: "application/json",
        finalUrl,
        source: "json",
        sourceType: "json",
        wasBlocked: false,
      };
    }
  }

  return {
    status: res.status,
    html: body,
    payload: null,
    contentType,
    finalUrl,
    source: "axios",
    sourceType: "html",
    wasBlocked: looksBlocked(res.status, body),
  };
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
      timeout: 35000,
      responseType: "text",
      headers: { "Content-Type": "application/json" },
      validateStatus: () => true,
    }
  );

  const body = typeof res.data === "string" ? res.data : String(res.data || "");
  return {
    status: res.status,
    html: body,
    payload: null,
    contentType: String(res.headers?.["content-type"] || "").toLowerCase(),
    finalUrl: url,
    source: "browserless",
    sourceType: "browserless",
    wasBlocked: false,
  };
}

function redditJsonUrl(url) {
  const next = new URL(url);
  if (next.pathname.endsWith(".json")) return next.toString();
  next.pathname = `${next.pathname.replace(/\/$/, "")}.json`;
  return next.toString();
}

async function fetchWikipedia(normalized, sessionId) {
  const direct = await fetchDirect(normalized, sessionId);
  if (isUsableHtml(direct.html) && !looksBlocked(direct.status, direct.html)) {
    return {
      ...direct,
      source: "axios",
      sourceType: "wikipedia",
      wasBlocked: false,
    };
  }
  throw new Error("Wikipedia fetch failed");
}

async function fetchReddit(normalized, sessionId) {
  try {
    const jsonResult = await fetchDirect(redditJsonUrl(normalized), sessionId);
    if (jsonResult.payload || String(jsonResult.contentType).includes("json")) {
      return {
        ...jsonResult,
        source: "json",
        sourceType: "reddit",
        wasBlocked: false,
      };
    }
  } catch {}

  const direct = await fetchDirect(normalized, sessionId);
  if (isUsableHtml(direct.html) && !looksBlocked(direct.status, direct.html)) {
    return {
      ...direct,
      source: "axios",
      sourceType: "reddit",
      wasBlocked: false,
    };
  }

  const rendered = await fetchBrowserless(normalized);
  if (isUsableHtml(rendered.html)) {
    return {
      ...rendered,
      sourceType: "reddit",
      wasBlocked: true,
    };
  }

  throw new Error("Reddit fetch failed");
}

async function fetchGeneric(normalized, site, sessionId) {
  let currentSession = sessionId;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetchDirect(normalized, currentSession);

      if (res.payload) {
        return {
          ...res,
          source: "json",
          sourceType: site,
          wasBlocked: false,
        };
      }

      if (isUsableHtml(res.html) && !looksBlocked(res.status, res.html)) {
        return {
          ...res,
          source: "axios",
          sourceType: site,
          wasBlocked: false,
        };
      }
    } catch {}

    currentSession = Math.random().toString(36).slice(2);
    await new Promise((resolve) => setTimeout(resolve, 300 + attempt * 250));
  }

  try {
    const rendered = await fetchBrowserless(normalized);
    if (isUsableHtml(rendered.html)) {
      return {
        ...rendered,
        sourceType: site,
        wasBlocked: true,
      };
    }
  } catch {}

  throw new Error("Failed to fetch usable content");
}

async function fetchSmart(inputUrl) {
  const validated = await validatePublicUrl(inputUrl);
  const normalized = stripTrackingParams(validated);
  const domain = getDomain(normalized);
  const site = classifyDomain(domain);
  const sessionId = Math.random().toString(36).slice(2);

  if (site === "wikipedia") {
    return fetchWikipedia(normalized, sessionId);
  }

  if (site === "reddit") {
    return fetchReddit(normalized, sessionId);
  }

  return fetchGeneric(normalized, site, sessionId);
}

module.exports = {
  fetchSmart,
  getDomain,
  classifyDomain,
};
