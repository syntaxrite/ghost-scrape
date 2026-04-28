const TurndownService = require("turndown");
const { gfm } = require("turndown-plugin-gfm");

// Initialize Turndown with GitHub Flavored Markdown
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
}).use(gfm);

// Rule: Remove images and media to keep it text-only for LLMs
turndown.addRule("remove-media", {
  filter: ["img", "picture", "source", "video", "iframe"],
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
    .replace(/\n{3,}/g, "\n\n") // Remove excessive newlines
    .replace(/&nbsp;/g, " ")
    .trim();
}

// Aggressive cleaning for LLM readiness
function cleanNode(node) {
  const junk = node.querySelectorAll(`
    script, style, iframe, nav, header, footer, aside, 
    form, button, svg, noscript, .ads, .advertisement, 
    .promo, .popup, .modal, .cookie, .newsletter, .sidebar
  `);
  junk.forEach(el => el.remove());
  return node;
}

module.exports = { 
  turndown, normalizeUrl, getWordCount, cleanMarkdown, cleanNode 
};