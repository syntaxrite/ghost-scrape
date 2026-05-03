import axios from "axios";
import { getAxiosProxyConfig } from "./proxy";
import {
  validatePublicUrl,
  stripTrackingParams,
  isBlockedText
} from "./utils";

const BROWSERLESS_URL = process.env.BROWSERLESS_URL;
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;

// Axios instance (standard HTTP client)
const http = axios.create({
  timeout: 15000,
  maxRedirects: 5,
  responseType: "text",
  validateStatus: () => true,
});

// Check if response is blocked by looking for errors or block text
function looksBlocked(status, html) {
  return status >= 400 || isBlockedText(html);
}

// Fetch using Axios GET (HTML or JSON)
async function fetchDirect(url, sessionId) {
  const config = { ...getAxiosProxyConfig(sessionId) };
  try {
    const res = await http.get(url, config);
    const contentType = res.headers["content-type"] || "";
    let payload = null, html = "";
    if (contentType.includes("application/json")) {
      payload = res.data;
      html = "";
    } else {
      html = res.data;
    }
    const finalUrl = res.request?.res?.responseUrl || url;
    return { html, payload, status: res.status, finalUrl };
  } catch (err) {
    return { html: "", payload: null, status: 0, finalUrl: url };
  }
}

// Fetch via Browserless headless Chrome (rendered HTML)
async function fetchBrowserless(url) {
  if (!BROWSERLESS_URL || !BROWSERLESS_TOKEN) {
    throw new Error("Browserless not configured");
  }
  const endpoint = `${BROWSERLESS_URL}?token=${encodeURIComponent(BROWSERLESS_TOKEN)}&url=${encodeURIComponent(url)}`;
  try {
    const res = await axios.get(endpoint, { timeout: 30000 });
    return { html: res.data, payload: null, status: res.status, finalUrl: url };
  } catch (err) {
    throw new Error("Browserless fetch failed");
  }
}

// Main smart fetch with retries and fallback
export async function fetchSmart(inputUrl) {
  const validUrl = await validatePublicUrl(inputUrl);
  const url = stripTrackingParams(validUrl);
  const sessionId = Math.random().toString(36).slice(2);

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchDirect(url, sessionId);
    if (res.payload) {
      return { ...res, source: "json", sourceType: "api", wasBlocked: false };
    }
    if (res.html && !looksBlocked(res.status, res.html)) {
      return { ...res, source: "axios", sourceType: "html", wasBlocked: false };
    }
    await new Promise(r => setTimeout(r, 500 + attempt * 500));
  }

  try {
    const res = await fetchBrowserless(url);
    if (res.html && !isBlockedText(res.html)) {
      return { ...res, source: "browserless", sourceType: "html", wasBlocked: true };
    }
  } catch (err) {}
  throw new Error("Failed to fetch usable content");
}
