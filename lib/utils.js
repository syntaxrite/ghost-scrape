import { promises as dns } from "dns";
import net from "net";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const turndown = new TurndownService();
turndown.use(gfm);

// Escape HTML characters to prevent injection
export function escapeHtml(str) {
  return String(str || "")
    .replace(/[&<>"']/g, ch => {
      switch (ch) {
        case "&": return "&amp;";
        case "<": return "&lt;";
        case ">": return "&gt;";
        case '"': return "&quot;";
        case "'": return "&#39;";
        default: return ch;
      }
    });
}

// Remove unwanted tracking params from URL
export function stripTrackingParams(url) {
  try {
    const u = new URL(url);
    ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","fbclid","gclid"].forEach(p => u.searchParams.delete(p));
    return u.toString();
  } catch {
    return url;
  }
}

// Get domain/hostname from URL string
export function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// Check if text indicates a blocked page (captcha, cloudflare, etc.)
export function isBlockedText(text) {
  const s = String(text || "").toLowerCase();
  return ["captcha", "cloudflare", "hcaptcha", "verify you're a human"].some(substr => s.includes(substr));
}

// Check if IP is in a private or link-local range
export function isPrivateIp(ip) {
  if (!ip) return false;
  try {
    const [a, b, c, d] = ip.split(".").map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
  } catch {
    // skip IPv6 checks for simplicity
  }
  return false;
}

// Check if hostname is likely private/local
export function isPrivateHostname(hostname) {
  const privateHosts = ["localhost", "127.0.0.1", "0.0.0.0"];
  return privateHosts.includes(hostname);
}

// Resolve hostname and ensure none of its IPs are private
async function ensureHostnameSafe(hostname) {
  try {
    const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    if (!addresses || !addresses.length) throw new Error("Unable to resolve host");
    for (const rec of addresses) {
      if (isPrivateIp(rec.address)) {
        throw new Error("Private or local IP");
      }
    }
  } catch (err) {
    throw new Error("Host resolution failed: " + err.message);
  }
}

// Validate a user-supplied URL (HTTP/HTTPS, no private IPs or hostnames)
export async function validatePublicUrl(input) {
  if (!input || typeof input !== "string") {
    throw new Error("Invalid URL");
  }
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Invalid URL format");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP/HTTPS URLs allowed");
  }
  const hostname = url.hostname;
  if (isPrivateHostname(hostname)) {
    throw new Error("Private or local URLs are not allowed");
  }
  if (net.isIP(hostname)) {
    // If input is IP address
    if (isPrivateIp(hostname)) {
      throw new Error("Private or local IPs not allowed");
    }
    return url.toString();
  }
  // Resolve DNS and check IPs
  await ensureHostnameSafe(hostname);
  return url.toString();
}

// Clean up markdown: strip excessive whitespace, control chars
export function cleanMarkdown(md) {
  return String(md || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u200B/g, "")
    .replace(/\n{2,}/g, "\n\n")
    .trim();
}

// Count words in text
export function getWordCount(text) {
  if (!text) return 0;
  const words = String(text).trim().split(/\s+/);
  return words.filter(w => w).length;
}

// Turndown (export the instance)
export const markdownParser = turndown;
