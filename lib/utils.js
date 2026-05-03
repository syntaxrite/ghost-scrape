
const dns = require("node:dns").promises;
const net = require("node:net");
const TurndownService = require("turndown");
const { gfm } = require("turndown-plugin-gfm");

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "_",
}).use(gfm);

turndown.addRule("remove-media", {
  filter: ["img", "picture", "source", "video", "iframe", "svg", "canvas", "audio"],
  replacement: () => "",
});

turndown.addRule("remove-script-style", {
  filter: ["script", "style", "noscript"],
  replacement: () => "",
});

turndown.addRule("remove-hidden-blocks", {
  filter: (node) => {
    if (!node || !node.getAttribute) return false;
    const style = (node.getAttribute("style") || "").toLowerCase();
    const aria = (node.getAttribute("aria-hidden") || "").toLowerCase();
    return style.includes("display:none") || style.includes("visibility:hidden") || aria === "true";
  },
  replacement: () => "",
});

function normalizeUrl(input) {
  let url = String(input || "").trim();
  if (!url) throw new Error("URL required");

  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  const parsed = new URL(url);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are supported");
  }

  if (parsed.username || parsed.password) {
    throw new Error("URLs with credentials are not allowed");
  }

  if (!parsed.pathname) parsed.pathname = "/";
  return parsed.toString();
}

function getDomain(input) {
  try {
    const url = new URL(normalizeUrl(input));
    return url.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function stripTrackingParams(input) {
  const url = new URL(normalizeUrl(input));

  const paramsToDelete = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "utm_id",
    "utm_name",
    "fbclid",
    "gclid",
    "igshid",
    "mc_cid",
    "mc_eid",
    "ref",
    "ref_src",
    "spm",
    "si",
    "_ga",
    "_gl",
  ];

  for (const p of paramsToDelete) url.searchParams.delete(p);
  url.hash = "";
  return url.toString();
}

function getWordCount(text) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return 0;
  return cleaned.split(" ").filter(Boolean).length;
}

function cleanMarkdown(md) {
  return String(md || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\[\d+\]/g, "")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}

function isBlockedText(text) {
  const s = String(text || "").toLowerCase();

  return [
    "captcha",
    "hcaptcha",
    "cloudflare",
    "just a moment",
    "access denied",
    "forbidden",
    "verify you are human",
    "enable javascript",
    "sign in to continue",
    "log in to continue",
    "login to continue",
    "are you a robot",
    "robot check",
    "not authorized",
    "rate limit exceeded",
  ].some((term) => s.includes(term));
}

function isPrivateHostname(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host) return true;

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".intranet") ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "::1"
  ) {
    return true;
  }

  return false;
}

function isPrivateIp(ip) {
  const value = String(ip || "").trim();
  if (!value) return true;

  if (net.isIP(value) === 6) {
    const v = value.toLowerCase();
    if (v === "::1") return true;
    if (v.startsWith("fe80:")) return true;
    if (v.startsWith("fc") || v.startsWith("fd")) return true;
    if (v.startsWith("::ffff:127.")) return true;
    return false;
  }

  if (net.isIP(value) !== 4) return true;

  const [a, b] = value.split(".").map(Number);
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true;
  return false;
}

async function resolveHostname(hostname) {
  try {
    return await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    return [];
  }
}

async function validatePublicUrl(input) {
  if (!input || typeof input !== "string") {
    throw new Error("Invalid URL");
  }

  let url;

  try {
    url = new URL(normalizeUrl(input));
  } catch {
    throw new Error("Invalid URL format");
  }

  const protocol = url.protocol;
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error("Only HTTP/HTTPS URLs allowed");
  }

  const hostname = url.hostname;

  if (isPrivateHostname(hostname)) {
    throw new Error("Private or local URLs are not allowed");
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error("Private or local URLs are not allowed");
    }
    return url.toString();
  }

  const addresses = await resolveHostname(hostname);
  if (!addresses.length) {
    throw new Error("Unable to resolve URL host");
  }

  for (const record of addresses) {
    if (isPrivateIp(record.address)) {
      throw new Error("Private or local URLs are not allowed");
    }
  }

  return url.toString();
}

module.exports = {
  turndown,
  normalizeUrl,
  validatePublicUrl,
  getDomain,
  stripTrackingParams,
  getWordCount,
  cleanMarkdown,
  escapeHtml,
  isBlockedText,
  isPrivateHostname,
  isPrivateIp,
};
