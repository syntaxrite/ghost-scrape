const { chromium } = require('playwright');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const TurndownService = require('turndown');

async function scrapeToMarkdown(url) {
  // Added critical flags for Linux/Render environments
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
  });
  
  const page = await browser.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const html = await page.content();
    
    const doc = new JSDOM(html, { url });
    const reader = new Readability(doc.window.document);
    const article = reader.parse();

    if (!article) throw new Error("Could not parse content.");

    const turndownService = new TurndownService();
    const markdown = turndownService.turndown(article.content);

    return {
      title: article.title,
      content: markdown,
      excerpt: article.excerpt
    };
  } catch (error) {
    console.error("Scraping failed:", error);
    throw error;
  } finally {
    await browser.close();
  }
}

// Export the function so server.js can use it
module.exports = { scrapeToMarkdown };

// NOTE: DO NOT ADD A TEST CALL HERE. IT WILL CRASH RENDER.