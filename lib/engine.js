const axios = require("axios");

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;
const BROWSERLESS_URL = "https://chrome.browserless.io/content";

const http = axios.create({
  timeout: 8000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/123.0.0.0",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  },
});

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

/**
 * Honest Detection: Tells us if the site is actively blocking us
 */
function getBlockType(html, status) {
  const s = String(html || "").toLowerCase();
  if (s.includes("cf-browser-verification") || s.includes("cf_chl_opt")) return "Cloudflare Challenge";
  if (s.includes("captcha") || s.includes("h-captcha")) return "CAPTCHA Wall";
  if (status === 403 || s.includes("access denied")) return "Forbidden (403)";
  return null;
}

async function fetchSmart(url) {
  const domain = getDomain(url);

  // Level 1: Try Axios (Fast & Free)
  try {
    const res = await http.get(url);
    const block = getBlockType(res.data, res.status);
    if (!block) return { html: res.data, source: "axios" };
    console.log(`[${domain}] Axios hit a ${block}. Trying basic browser...`);
  } catch (err) {
    console.log(`[${domain}] Axios failed. Trying basic browser...`);
  }

  // Level 2: Try Simple Browserless (The "Ghost" attempt)
  // We keep the body simple to avoid "Validation Errors"
  if (BROWSERLESS_TOKEN) {
    try {
      const res = await axios.post(`${BROWSERLESS_URL}?token=${BROWSERLESS_TOKEN}`, {
        url: url,
        waitFor: 2000 // Just wait a moment for basic JS
      }, { timeout: 15000 });

      const block = getBlockType(res.data, 200);
      if (!block) return { html: res.data, source: "browserless-basic" };
      
      throw new Error(`Site is protected by ${block}. Ghost Scrape cannot bypass this yet.`);
    } catch (err) {
      throw new Error(err.message.includes("protected") ? err.message : "This site is too well-guarded for a ghost to enter.");
    }
  }

  throw new Error("Axios blocked and no Browserless Token configured.");
}

module.exports = { getDomain, fetchSmart };