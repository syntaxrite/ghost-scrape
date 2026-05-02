const TurndownService = require("turndown");
const { gfm } = require("turndown-plugin-gfm");

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "_",
}).use(gfm);

turndown.addRule("remove-media", {
  filter: ["img", "picture", "source", "video", "iframe", "svg", "canvas"],
  replacement: () => "",
});

turndown.addRule("remove-script-style", {
  filter: ["script", "style", "noscript"],
  replacement: () => "",
});

function normalizeUrl(input) {
  let url = String(input || "").trim();
  if (!url) throw new Error("URL required");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
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
    "fbclid",
    "gclid",
    "igshid",
  ];

  for (const p of paramsToDelete) url.searchParams.delete(p);
  return url.toString();
}

function getWordCount(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean).length;
}

function cleanMarkdown(md) {
  return String(md || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\[\d+\]/g, "")
    .trim();
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (ch) => {
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
  ].some((term) => s.includes(term));
}

module.exports = {
  turndown,
  normalizeUrl,
  getDomain,
  stripTrackingParams,
  getWordCount,
  cleanMarkdown,
  escapeHtml,
  isBlockedText,
};
