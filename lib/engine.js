const axios = require("axios");
const { fetchWithBrowser } = require("./cloud"); // Your superior engine

const http = axios.create({
  timeout: 10000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/123.0.0.0",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  },
});

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function isBlocked(html) {
  const s = String(html || "").toLowerCase();
  // Detecting Cloudflare or generic "Bot" walls
  return s.includes("captcha") || 
         s.includes("cf-browser-verification") || 
         s.includes("access denied") ||
         s.includes("unusual traffic");
}

async function fetchSmart(url) {
  const domain = getDomain(url);
  const isWiki = domain.includes("wikipedia.org");

  // Escalation Level 1: Wikipedia always stays on Axios (Fast & Free)
  if (isWiki) {
    try {
      const res = await http.get(url);
      return { html: res.data, source: "axios-wiki" };
    } catch (err) {
      throw new Error(`Wiki is down or URL is wrong: ${err.message}`);
    }
  }

  // Escalation Level 2: Try Axios for other sites to save Browserless credits
  try {
    const res = await http.get(url);
    if (!isBlocked(res.data)) {
      return { html: res.data, source: "axios-standard" };
    }
    console.log(`[${domain}] Axios blocked. Escalating to Superior Cloud...`);
  } catch (err) {
    console.log(`[${domain}] Axios failed. Escalating to Superior Cloud...`);
  }

  // Escalation Level 3: Pull the big lever (Human-mimicry)
  // This uses your new cloud.js script
  return await fetchWithBrowser(url);
}

module.exports = { getDomain, fetchSmart };