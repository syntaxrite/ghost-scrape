const axios = require("axios");

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;
const BROWSERLESS_URL = "https://chrome.browserless.io/scrape";

const http = axios.create({
  timeout: 5000, // Reduced for speed
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/123.0.0.0",
  },
});

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function getBlockType(html, status) {
  const s = String(html || "").toLowerCase();
  if (s.includes("cf-browser-verification") || s.includes("cf_chl_opt")) return "Cloudflare";
  if (s.includes("captcha") || s.includes("h-captcha")) return "CAPTCHA Wall";
  if (status === 403 || s.includes("access denied")) return "Forbidden (403)";
  return null;
}

async function fetchSmart(url) {
  const domain = getDomain(url);

  // 1. Wikipedia Fast-Path (Instant)
  if (domain.includes("wikipedia.org")) {
    try {
      const res = await http.get(url);
      return { html: res.data, source: "axios-wiki", wasBlocked: false };
    } catch (err) {
      console.log("Wiki fast-path failed, falling back...");
    }
  }

  // 2. Axios Attempt (Standard Sites)
  try {
    const res = await http.get(url);
    const block = getBlockType(res.data, res.status);
    if (!block && res.data.length > 3000) { // Check length to avoid "empty" success
       return { html: res.data, source: "axios", wasBlocked: false };
    }
  } catch (err) {
    console.log(`[${domain}] Axios failed. Escalating...`);
  }

  // 3. Browserless Stealth (For The Verge, Medium, etc.)
  if (!BROWSERLESS_TOKEN) throw new Error("Shield detected. Connect Cloud Token to bypass.");

  try {
    const res = await axios.post(`${BROWSERLESS_URL}?token=${BROWSERLESS_TOKEN}`, {
      url: url,
      elements: [{ selector: "body" }],
      // "Stealth" settings to fix The Verge/Medium
      gotoOptions: { waitUntil: "networkidle2" },
      waitFor: 3000, // Hard wait for JS to render
      context: {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        viewport: { width: 1920, height: 1080 }
      }
    }, { timeout: 20000 });

    const html = res.data.data[0].results[0].html;
    const block = getBlockType(html, 200);

    if (block) {
      throw new Error(`Site protected by ${block}. Ghost Scrape cannot enter yet.`);
    }

    return { html, source: "ghost-stealth", wasBlocked: true };
  } catch (err) {
    const msg = err.response?.data?.error || err.message;
    throw new Error(msg.includes("protected") ? msg : "Access denied. Target is too well-guarded.");
  }
}

module.exports = { getDomain, fetchSmart };