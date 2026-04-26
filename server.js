const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const TurndownService = require('turndown');
const axios = require('axios'); // Add this for Wikipedia speed
require('dotenv').config();

chromium.use(stealth);
const app = express();
const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
turndown.remove(['script', 'style', 'noscript', 'iframe', 'svg', 'img', 'video', 'footer', 'nav', 'aside']);

// Shared distillation logic
function distill(html, url) {
    const doc = new JSDOM(html, { url });
    const article = new Readability(doc.window.document).parse();
    if (!article) return null;
    const md = turndown.turndown(article.content);
    return {
        title: article.title,
        markdown: md,
        stats: {
            raw_chars: html.length,
            distilled_chars: md.length,
            savings: Math.round((1 - (md.length / html.length)) * 100) + "%"
        }
    };
}

async function scrapeSmart(url) {
    // 1. FAST PATH (Wikipedia/GitHub) - Zero Browser Overhead
    if (url.includes('wikipedia.org') || url.includes('github.com')) {
        console.log("⚡ Turbo Path: Using Axios");
        const { data: html } = await axios.get(url, { timeout: 8000 });
        return distill(html, url);
    }

    // 2. STEALTH PATH (TechCrunch/ZDNet) - One single load
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--single-process'] 
    });
    const page = await browser.newPage();

    try {
        // Block trash immediately
        await page.route('**/*', (route) => {
            if (['image', 'media', 'font', 'stylesheet'].includes(route.request().resourceType())) {
                return route.abort();
            }
            route.continue();
        });

        // ONLY ONE GOTO CALL (This fixes your timeout bug)
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        
        // Wait max 5 seconds for text to appear
        await page.waitForSelector('p', { timeout: 5000 }).catch(() => null);

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

app.listen(5000, () => console.log("🚀 Engine Live I guess"));