const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");

// ---------- CLEAN ----------
function cleanDocument(doc) {
  doc.querySelectorAll(`
    script, style, iframe, nav, header, footer, aside,
    form, button, svg, noscript,
    .ads, .advertisement, .promo, .popup, .modal,
    .cookie, .newsletter, .sidebar, .share, .related
  `).forEach(el => el.remove());

  return doc;
}

// ---------- PICK BEST NODE ----------
function pickMainContent(doc) {
  const candidates = [
    doc.querySelector("article"),
    doc.querySelector("main"),
    doc.querySelector('[role="main"]'),
    doc.querySelector("#content"),
    doc.body
  ].filter(Boolean);

  let best = null;
  let bestScore = 0;

  for (const node of candidates) {
    const textLen = (node.textContent || "").length;
    const pCount = node.querySelectorAll("p").length;

    const score = textLen + pCount * 100;

    if (score > bestScore) {
      best = node;
      bestScore = score;
    }
  }

  return best;
}

// ---------- MAIN ----------
function extractGeneric(html, url) {
  const dom = new JSDOM(html, { url });
  let doc = dom.window.document;

  doc = cleanDocument(doc);

  // 1. Readability (primary engine)
  const reader = new Readability(doc);
  const article = reader.parse();

  if (article && article.content) {
    return {
      title: article.title || doc.title || "Untitled",
      content: article.content,
      textContent: article.textContent || ""
    };
  }

  // 2. Manual fallback
  const container = pickMainContent(doc);

  if (!container) return null;

  // remove weak paragraphs
  container.querySelectorAll("p").forEach(p => {
    if (p.textContent.trim().length < 30) {
      p.remove();
    }
  });

  return {
    title: doc.title || "Untitled",
    content: container.innerHTML,
    textContent: container.textContent || ""
  };
}

module.exports = extractGeneric;