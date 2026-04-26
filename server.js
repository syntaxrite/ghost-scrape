const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const TurndownService = require('turndown');
const axios = require('axios'); // For lightning-fast fetches
require('dotenv').config();

chromium.use(stealth);
const app = express();
const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
turndown.remove(['script', 'style', 'noscript', 'iframe', 'svg', 'img', 'video', 'footer', 'nav', 'aside']);

// Helper to turn HTML into clean Markdown
function distill(html, url) {
    const doc = new JSDOM(html, { url });
    const article = new Readability(doc.window.document).parse();
    if (!article) return null;
    return {
        title: article.title,
        markdown: turndown.turndown(article.content),
        savings: Math.round((1 - (turndown.turndown(article.content).length / html.length)) * 100) + "%"
    };
}

async function scrapeSmart(url) {
    // 1. FAST PATH: No browser needed for Wikipedia/GitHub
    if (url.includes('wikipedia.org') || url.includes('github.com')) {
        console.log("⚡ Fast Path: Axios Fetching...");
        const { data: html } = await axios.get(url, { timeout: 10000 });
        return distill(html, url);
    }

    // 2. STEALTH PATH: Optimized Playwright for heavy sites
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process'] 
    });
    const page = await browser.newPage();

    try {
        // Block "Trash" (Ads/Images/CSS) immediately
        await page.route('**/*', (route) => {
            if (['image', 'media', 'font', 'stylesheet'].includes(route.request().resourceType())) {
                return route.abort();
            }
            route.continue();
        });

        // SINGLE NAVIGATION (This fixes your double-load bug)
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        
        // Race: Stop as soon as content is visible
        await Promise.race([
            page.waitForSelector('article', { timeout: 6000 }),
            page.waitForSelector('main', { timeout: 6000 }),
            page.waitForTimeout(6000)
        ]);

        const html = await page.content();
        return distill(html, url);
    } finally {
        await browser.close();
    }
}

app.use(cors());
app.get('/scrape', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "URL is required" });
    try {
        const data = await scrapeSmart(url);
        res.json({ success: true, ...data });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(5000, () => console.log("🚀 Engine Live on 5000"));