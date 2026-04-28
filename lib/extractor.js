const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");

function cleanNode(node) {
  node.querySelectorAll(`
    script, style, iframe, nav, header, footer, aside, 
    form, button, .ads, .sidebar, .comments
  `).forEach(el => el.remove());
  return node;
}

function extractContent(html, url) {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;
  const domain = new URL(url).hostname;

  // 1. Wikipedia Logic
  if (domain.includes("wikipedia.org")) {
    const main = doc.querySelector("#mw-content-text .mw-parser-output");
    if (main) {
      const cleaned = cleanNode(main);
      return { title: doc.title, content: cleaned.innerHTML, text: cleaned.textContent };
    }
  }

  // 2. Generic / Blog / News (Powered by Readability)
  // This is the most LLM-ready engine available
  const reader = new Readability(doc);
  const article = reader.parse();
  
  if (article) {
    return {
      title: article.title,
      content: article.content, // Returns clean HTML
      text: article.textContent
    };
  }

  return null;
}

module.exports = { extractContent };