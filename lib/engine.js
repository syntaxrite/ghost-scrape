const axios = require("axios");
const { fetchWithBrowser } = require("./cloud");

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

/**
 * Smart Detection Logic
 * Categorizes the block so the UI can be specific.
 */
function analyzeResponse(html, status) {
  const s = String(html || "").toLowerCase();
  
  const blocks = {
    isBlocked: false,
    type: null,
    message: null
  };

  if (s.includes("cf-browser-verification") || s.includes("cf_chl_opt") || s.includes("checking your browser")) {
    blocks.isBlocked = true;
    blocks.type = "CLOUDFLARE";
    blocks.message = "Cloudflare JS Challenge detected.";
  } else if (s.includes("captcha") || s.includes("g-recaptcha") || s.includes("h-captcha")) {
    blocks.isBlocked = true;
    blocks.type = "CAPTCHA";
    blocks.message = "CAPTCHA wall encountered.";
  } else if (status === 403 || s.includes("access denied")) {
    blocks.isBlocked = true;
    blocks.type = "IP_BLOCK";
    blocks.message = "IP blocked or forbidden access.";
  } else if (s.includes("unusual traffic")) {
    blocks.isBlocked = true;
    blocks.type = "RATE_LIMIT";
    blocks.message = "Rate limit reached.";
  }

  return blocks;
}

async function fetchSmart(url) {
  const domain = getDomain(url);
  const isWiki = domain.includes("wikipedia.org");

  // Level 1: Wikipedia / Simple Fetch
  if (isWiki) {
    const res = await http.get(url);
    return { html: res.data, source: "axios-wiki" };
  }

  // Level 2: Smart Axios Attempt
  try {
    const res = await http.get(url);
    const analysis = analyzeResponse(res.data, res.status);
    
    if (!analysis.isBlocked) {
      return { html: res.data, source: "axios-standard" };
    }
    console.log(`[Ghost Detection]: ${analysis.message} Escalating...`);
  } catch (err) {
    const analysis = analyzeResponse(err.response?.data, err.response?.status);
    console.log(`[Ghost Detection]: ${analysis.message || "Request failed"}. Escalating...`);
  }

  // Level 3: Superior Cloud (Human Mimicry)
  // We pass the detection message back so the UI knows we're "bypassing"
  const browserRes = await fetchWithBrowser(url);
  return { ...browserRes, wasBlocked: true };
}

module.exports = { getDomain, fetchSmart };