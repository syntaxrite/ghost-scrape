const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const { cleanNode } = require("./utils");

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

function extractBBC(doc) {
  const blocks = [...doc.querySelectorAll('[data-component="text-block"]')];
  if (blocks.length === 0) return null;
  const html = blocks.map(b => `<p>${b.textContent.trim()}</p>`).join("");
  return {
    title: doc.querySelector("h1")?.textContent?.trim(),
    content: html,
    textContent: blocks.map(b => b.textContent).join(" ")
  };
}

function extractGeneric(html, url) {
  // Pre-strip CSS/Style to prevent JSDOM crashes
  const safeHtml = html.replace(/<style([\s\S]*?)<\/style>/gi, "");
  const dom = new JSDOM(safeHtml, { url });
  const doc = dom.window.document;
  
  const domain = new URL(url).hostname;

  // Route to specific scrapers
  if (domain.includes("wikipedia.org")) return extractWikipedia(doc);
  if (domain.includes("bbc.com")) return extractBBC(doc);

  // Default: Use Mozilla Readability (best for LLMs)
  const reader = new Readability(doc);
  const article = reader.parse();
  return article ? {
    title: article.title,
    content: article.content,
    textContent: article.textContent
  } : null;
}

module.exports = { extractGeneric };