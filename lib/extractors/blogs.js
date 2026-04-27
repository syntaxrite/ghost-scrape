const { JSDOM } = require("jsdom");

// ---------- CLEAN ----------
function cleanNode(node) {
  const clone = node.cloneNode(true);

  clone.querySelectorAll(`
    script, style, iframe, nav, header, footer, aside,
    form, button, svg, noscript, figure,
    .ads, .advertisement, .promo, .popup, .modal,
    .cookie, .newsletter, .sidebar, .share, .related
  `).forEach(el => el.remove());

  return clone;
}

// ---------- BLOG EXTRACTION ----------
function extractBlog(html, url) {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  const title =
    doc.querySelector("h1")?.textContent?.trim() ||
    doc.title ||
    "Untitled";

  // Try common blog containers
  let container =
    doc.querySelector("article") ||
    doc.querySelector("main") ||
    doc.querySelector('[class*="post"]') ||
    doc.querySelector('[class*="article"]');

  if (!container) return null;

  const cleaned = cleanNode(container);

  // filter weak paragraphs
  cleaned.querySelectorAll("p").forEach(p => {
    if (p.textContent.trim().length < 30) {
      p.remove();
    }
  });

  return {
    title,
    content: cleaned.innerHTML,
    textContent: cleaned.textContent || ""
  };
}

module.exports = extractBlog;