const axios = require("axios");

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;

// -----------------------------
// HTTP client (fast + safe)
// -----------------------------
const http = axios.create({
  timeout: 8000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
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

  // =============================
  // 1. Wikipedia fast path
  // =============================
  if (domain.includes("wikipedia.org")) {
    const res = await http.get(url);
    return {
      html: res.data,
      source: "axios-wikipedia",
      wasBlocked: false,
    };
  }

  // =============================
  // 2. Normal axios fetch
  // =============================
  try {
    const res = await http.get(url);

    const block = getBlockType(res.data, res.status);

    if (!block && res.data && res.data.length > 2000) {
      return {
        html: res
