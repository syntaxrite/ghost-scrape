const TurndownService = require("turndown");
const { gfm } = require("turndown-plugin-gfm");

// Initialize Turndown with LLM-friendly settings
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
}).use(gfm);

// Rule: Remove all media and images to save tokens for LLMs
turndown.addRule("remove-media", {
  filter: ["img", "picture", "source", "video", "iframe", "svg"],
  replacement: () => "",
});

function normalizeUrl(input) {
  let url = String(input || "").trim();
  if (!url) throw new Error("URL required");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

function getWordCount(text) {
  return String(text || "").split(/\s+/).filter(Boolean).length;
}

function cleanMarkdown(md) {
  return md
    .replace(/\[\d+\]/g, "")      // Remove wiki-style citations [1]
    .replace(/\n{3,}/g, "\n\n")    // Collapse excessive whitespace
    .replace(/[ \t]+\n/g, "\n")    // Clean trailing spaces
    .trim();
}

module.exports = { 
  turndown, normalizeUrl, getWordCount, cleanMarkdown 
};