const { JSDOM } = require("jsdom");

// ---------- CLEAN ----------
function cleanWikipediaContent(container) {
  const clone = container.cloneNode(true);

  clone.querySelectorAll(`
    .reference,
    sup.reference,
    .mw-editsection,
    .hatnote,
    .toc,
    .navbox,
    .vertical-navbox,
    .ambox,
    .sidebar,
    .infobox,
    .mw-jump-link,
    .mw-references-wrap,
    .reflist,
    script,
    style,
    iframe,
    svg,
    table
  `).forEach(el => el.remove());

  return clone;
}

// ---------- MAIN ----------
function extractWikipedia(html, url) {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  const title =
    doc.querySelector("#firstHeading")?.textContent?.trim() ||
    doc.title?.replace(/\s*-\s*Wikipedia$/, "").trim() ||
    "Untitled";

  const content = doc.querySelector("#mw-content-text .mw-parser-output");

  if (!content) return null;

  const cleaned = cleanWikipediaContent(content);

  return {
    title,
    content: cleaned.innerHTML,
    textContent: cleaned.textContent || ""
  };
}

module.exports = extractWikipedia;