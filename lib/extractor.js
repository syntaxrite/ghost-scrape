const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");

// ---------- SHARED CLEANING ----------
function cleanNode(node) {
  const clone = node.cloneNode(true);
  const junk = clone.querySelectorAll(`
    script, style, iframe, nav, header, footer, aside,
    form, button, svg, noscript, .ads, .advertisement, 
    .promo, .popup, .cookie, .share, .related,
    .mw-editsection, .hatnote, .toc, .navbox
  `);
  junk.forEach(el => el.remove());
  return clone;
}

// ---------- SPECIFIC PARSERS ----------
function extractWikipedia(doc) {
  const content = doc.querySelector("#mw-content-text .mw-parser-output");
  if (!content) return null;
  const cleaned = cleanNode(content);
  return {
    title: doc.querySelector("#firstHeading")?.textContent?.trim(),
    content: cleaned.innerHTML,
    textContent: cleaned.textContent
  };
}

function extractNews(doc) {
  // Try BBC/News specific selectors or fallback to article tag
  const container = doc.querySelector('[data-component="text-block"]') || doc.querySelector("article") || doc.querySelector("main");
  if (!container) return null;
  const cleaned = cleanNode(container);
  return {
    title: doc.querySelector("h1")?.textContent?.trim(),
    content: cleaned.innerHTML,
    textContent: cleaned.textContent
  };
}

function extractGeneric(doc) {
  const reader = new Readability(doc);
  const article = reader.parse();
  return article ? {
    title: article.title,
    content: article.content,
    textContent: article.textContent
  } : null;
}

// ---------- ROUTER ----------
function runExtractor(type, html, url) {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  if (type === "wikipedia") return extractWikipedia(doc);
  if (type === "news") return extractNews(doc);
  
  return extractGeneric(doc) || { title: doc.title, content: doc.body.innerHTML, textContent: doc.body.textContent };
}

module.exports = { runExtractor };