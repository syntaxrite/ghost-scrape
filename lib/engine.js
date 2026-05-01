const axios = require("axios");

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;
const BROWSERLESS_URL = "https://chrome.browserless.io/scrape";

const http = axios.create({
  timeout: 9000,
  responseType: "text",
  decompress: true,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  },
  validateStatus: () => true,
});

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeHtmlPayload(data) {
  if (data == null) return "";

  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }

  if (typeof data === "string") {
    return data;
  }

  if (typeof data === "object") {
    if (typeof data.html === "string") return data.html;
    if (typeof data.content === "string") return data.content;
    if (typeof data.data === "string") return data.data;
    return JSON.stringify(data);
  }

  return String(data);
}

function looksLikeHtml(html) {
  const s = String(html || "").trim().toLowerCase();
  if (!s) return false;

  return (
    s.includes("<html") ||
    s.includes("<!doctype html") ||
    s.includes("<body") ||
    s.includes("<head") ||
    s.includes("<div") ||
    s.includes("<article")
  );
}

function getBlockType(html, status) {
  const s = String(html || "").toLowerCase();

  if (s.includes("cf-browser-verification") || s.includes("cf_chl_opt")) {
    return "Cloudflare";
  }

  if (s.includes("captcha") || s.includes("h-captcha") || s.includes("recaptcha")) {
    return "CAPTCHA Wall";
  }

  if (
    status === 403 ||
    status === 401 ||
    s.includes("access denied") ||
    s.includes("forbidden") ||
    s.includes("unusual traffic")
  ) {
    return `Blocked (${status || "unknown"})`;
  }

  return null;
}

function isGoodHtml(html) {
  const s = String(html || "").trim();
  if (s.length < 400) return false;
  if (!looksLikeHtml(s)) return false;

  const block = getBlockType(s, 200);
  return !block;
}

async function fetchDirect(url) {
  const res = await http.get(url);

  const html = normalizeHtmlPayload(res.data);
  const block = getBlockType(html, res.status);

  if (res.status === 200 && !block && isGoodHtml(html)) {
    return {
      html,
      source: "axios",
      wasBlocked: false,
    };
  }

  return {
    html,
    source: "axios",
    wasBlocked: !!block,
    blockedReason: block || null,
    status: res.status,
  };
}

async function fetchWikipedia(url) {
  const res = await http.get(url);

  const html = normalizeHtmlPayload(res.data);
  const block = getBlockType(html, res.status);

  if (res.status === 200 && !block && isGoodHtml(html)) {
    return {
      html,
      source: "axios-wikipedia",
      wasBlocked: false,
    };
  }

  return null;
}

function extractBrowserlessHtml(data) {
  if (!data) return "";

  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      return extractBrowserlessHtml(parsed);
    } catch {
      return data;
    }
  }

  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }

  if (typeof data === "object") {
    const candidates = [
      data.html,
      data.content,
      data.data?.html,
      data.data?.content,
      data.data?.[0]?.html,
      data.data?.[0]?.content,
      data.data?.[0]?.results?.[0]?.html,
      data.results?.[0]?.html,
      data.results?.[0]?.content,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate;
      }
    }

    return JSON.stringify(data);
  }

  return String(data);
}

async function fetchBrowserless(url) {
  if (!BROWSERLESS_TOKEN) {
    throw new Error("Browserless not configured");
  }

  const res = await axios.post(
    `${BROWSERLESS_URL}?token=${BROWSERLESS_TOKEN}`,
    {
      url,
      elements: [{ selector: "body" }],
      gotoOptions: {
        waitUntil: "networkidle2",
        timeout: 20000,
      },
      waitFor: 2500,
    },
    {
      timeout: 25000,
      responseType: "json",
      validateStatus: () => true,
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  const html = extractBrowserlessHtml(res.data);
  const block = getBlockType(html, res.status);

  if (res.status >= 200 && res.status < 300 && html && isGoodHtml(html) && !block) {
    return {
      html,
      source: "browserless",
      wasBlocked: true,
    };
  }

  const reason = block || `Browserless returned ${res.status}`;
  throw new Error(reason);
}

async function fetchSmart(url) {
  const domain = getDomain(url);

  if (!url || typeof url !== "string") {
    throw new Error("Invalid URL");
  }

  // Wikipedia fast path
  if (domain.includes("wikipedia.org")) {
    try {
      const wiki = await fetchWikipedia(url);
      if (wiki) return wiki;
    } catch (err) {
      console.log(`[${domain}] wikipedia fast path failed`);
    }
  }

  // Direct fetch
  try {
    const direct = await fetchDirect(url);

    if (direct?.html && isGoodHtml(direct.html) && !direct.wasBlocked) {
      return direct;
    }

    console.log(`[${domain}] direct fetch weak or blocked, using fallback`);
  } catch (err) {
    console.log(`[${domain}] direct fetch failed`);
  }

  // Browserless fallback
  try {
    return await fetchBrowserless(url);
  } catch (err) {
    throw new Error(err?.message || "Access denied. Target is too well-guarded.");
  }
}

module.exports = { fetchSmart, getDomain };
