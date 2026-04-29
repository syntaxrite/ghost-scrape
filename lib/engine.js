const axios = require("axios");

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;
const BROWSERLESS_URL = "https://chrome.browserless.io/scrape";

// -----------------------------
// HTTP client
// -----------------------------
const http = axios.create({
  timeout: 8000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36",
  },
});

// -----------------------------
// Get clean domain
// -----------------------------
function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// -----------------------------
// Detect blocking
// -----------------------------
function getBlockType(html, status) {
  const s = String(html || "").toLowerCase();

  if (s.includes("cf-browser-verification") || s.includes("cf_chl_opt"))
    return "Cloudflare";

  if (s.includes("captcha") || s.includes("h-captcha"))
    return "CAPTCHA Wall";

  if (status === 403 || s.includes("access denied"))
    return "Forbidden (403)";

  return null;
}

// -----------------------------
// MAIN SCRAPER ENGINE
// -----------------------------
async function fetchSmart(url) {
  const domain = getDomain(url);

  // 1. Wikipedia fast path
  if (domain.includes("wikipedia.org")) {
    try {
      const res = await http.get(url);
      return {
        html: res.data,
        source: "axios-wikipedia",
        wasBlocked: false,
      };
    } catch {
      // fallback
    }
  }

  // 2. Normal axios fetch
  try {
    const res = await http.get(url);

    const block = getBlockType(res.data, res.status);

    if (!block && res.data && res.data.length > 2000) {
      return {
        html: res.data,
        source: "axios",
        wasBlocked: false,
      };
    }
  } catch (err) {
    console.log(`[${domain}] axios failed`);
  }

  // 3. Browserless fallback
  if (!BROWSERLESS_TOKEN) {
    throw new Error("Browserless not configured");
  }

  try {
    const res = await axios.post(
      `${BROWSERLESS_URL}?token=${BROWSERLESS_TOKEN}`,
      {
        url,
        elements: [{ selector: "body" }],
        gotoOptions: { waitUntil: "networkidle2" },
        waitFor: 3000,
      },
      { timeout: 20000 }
    );

    const html = res.data?.data?.[0]?.results?.[0]?.html;

    if (!html) {
      throw new Error("Empty browserless response");
    }

    const block = getBlockType(html, 200);

    if (block) {
      throw new Error(`Blocked by ${block}`);
    }

    return {
      html,
      source: "browserless",
      wasBlocked: true,
    };
  } catch (err) {
    throw new Error(
      err.message || "Access denied. Target is too well-guarded."
    );
  }
}

module.exports = { fetchSmart, getDomain };
