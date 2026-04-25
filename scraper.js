const { chromium } = require('playwright');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const TurndownService = require('turndown');

async function getMarkdown(url) {
  // 1. Launch Browser
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    // 2. Go to URL
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const html = await page.content();
    
    // 3. Use Readability to extract the "Meat" (Strips nav, ads, footers)
    const doc = new JSDOM(html, { url });
    const reader = new Readability(doc.window.document);
    const article = reader.parse();

    if (!article) throw new Error("Could not parse content.");

    // 4. Convert HTML to Markdown
    const turndownService = new TurndownService();
    const markdown = turndownService.turndown(article.content);

    return {
      title: article.title,
      content: markdown,
      excerpt: article.excerpt
    };
  } catch (error) {
    console.error("Scraping failed:", error);
  } finally {
    await browser.close();
  }
}

// Quick Test: Replace with any news article or blog URL
getMarkdown('https://en.wikipedia.org/wiki/Artificial_intelligence')
  .then(data => console.log(data.content.substring(0, 500) + "..."));