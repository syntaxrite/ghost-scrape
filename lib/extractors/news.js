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

// ---------- BBC ----------
function extractBBC(doc) {
  const title =
    doc.querySelector("h1")?.textContent?.trim() ||
    doc.title?.split(" - ")[0]?.trim();

  const blocks = [...doc.querySelectorAll('[data-component="text-block"]')];

  if (blocks.length > 0) {
    const html = blocks
      .map(b => {
        const text = (b.textContent || "").trim();
        return text ? `<p>${text}</p>` : "";
      })
      .filter(Boolean)
      .join("\n");

    return {
      title,
      content: html,
      textContent: blocks.map(b => b.textContent || "").join(" ")
    };
  }

  return null;
}

// ---------- GENERIC NEWS ----------
function extractGenericNews(doc) {
  const article =
    doc.querySelector("article") ||
    doc.querySelector("main");

  if (!article) return null;

  const cleaned = cleanNode(article);

  return {
    title:
      doc.querySelector("h1")?.textContent?.trim() ||
      doc.title ||
      "Untitled",
    content: cleaned.innerHTML,
    textContent: cleaned.textContent || ""
  };
}

// ---------- PARAGRAPH HEURISTIC ----------
function extractByParagraphs(doc) {
  const paragraphs = [...doc.querySelectorAll("p")];

  const valid = paragraphs.filter(p => {
    const text = (p.textContent || "").trim();
    return text.length > 50;
  });

  if (valid.length < 5) return null;

  const html = valid.map(p => `<p>${p.textContent.trim()}</p>`).join("\n");

  return {
    title:
      doc.querySelector("h1")?.textContent?.trim() ||
      doc.title ||
      "Untitled",
    content: html,
    textContent: valid.map(p => p.textContent).join(" ")
  };
}

// ---------- MAIN ----------
function extractNews(html, url) {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  // 1. BBC (best case)
  let result = extractBBC(doc);
  if (result) return result;

  // 2. Standard article containers
  result = extractGenericNews(doc);
  if (result) return result;

  // 3. Paragraph fallback
  result = extractByParagraphs(doc);
  if (result) return result;

  return null;
}

module.exports = extractNews;