const axios = require("axios");

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;
const BROWSERLESS_URL = "https://chrome.browserless.io/content";

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
  return s.includes("captcha") || s.includes("cf-browser-verification") || s.includes("access denied");
}

async function fetchSmart(url) {
  // 1. Try Axios first (Cost: $0)
  try {
    const res = await http.get(url);
    if (!isBlocked(res.data)) return { html: res.data, source: "axios" };
  } catch (err) {
    console.log("Axios blocked, pivoting to browser...");
  }

  // 2. Pivot to Browserless (Cost: Credits)
  if (!BROWSERLESS_TOKEN) throw new Error("Blocked and no Browserless token provided");
  
  const res = await axios.post(`${BROWSERLESS_URL}?token=${BROWSERLESS_TOKEN}`, { url });
  return { html: res.data, source: "browserless" };
}

module.exports = { getDomain, fetchSmart };