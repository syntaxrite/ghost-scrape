const axios = require("axios");

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;
// We use /scrape to allow for more 'Smart' options like waitFor and gotoOptions
const BROWSERLESS_URL = "https://chrome.browserless.io/scrape";

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
 * Smart Detection: Specifically identifies why a site is blocking the Ghost
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
    console.log(`[${domain}] Axios hit a ${block}. Escalating...`);
  } catch (err) {
    console.log(`[${domain}] Axios failed. Escalating...`);
  }

  // Level 2: Try Browserless /scrape (Smart Attempt)
  if (BROWSERLESS_TOKEN) {
    try {
      const res = await axios.post(`${BROWSERLESS_URL}?token=${BROWSERLESS_TOKEN}`, {
        url: url,
        elements: [{ selector: "body" }], // Required for /scrape endpoint
        gotoOptions: { waitUntil: "networkidle2" } // Smart wait for JS sites
      }, { timeout: 15000 });

      // The /scrape endpoint returns data in a results array
      const html = res.data.data[0].results[0].html;
      const block = getBlockType(html, 200);
      
      if (!block) return { html, source: "ghost-engine" };
      
      // If we see a block even in the browser, we are honest about it
      throw new Error(`Site is protected by ${block}. This Ghost isn't strong enough yet.`);
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message;
      throw new Error(errorMsg.includes("protected") ? errorMsg : "Access denied. Target is too well-guarded.");
    }
  }

  throw new Error("No way in. Axios blocked and no Cloud token found.");
}

module.exports = { getDomain, fetchSmart };