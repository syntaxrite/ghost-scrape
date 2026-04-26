const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const TurndownService = require('turndown');
const axios = require('axios');
require('dotenv').config();

chromium.use(stealth);
const app = express();
app.use(cors());

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
turndown.remove(['script', 'style', 'noscript', 'iframe', 'svg', 'img', 'video', 'footer', 'nav', 'aside', 'header']);

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
    // 🎯 FIX 1: THE WIKIPEDIA SPEED HACK (Sub-500ms)
    if (url.includes('wikipedia.org')) {
        const title = url.split('/wiki/').pop();
        const apiUrl = `https://en.wikipedia.org/api/rest_v1/page/html/${title}`;
        const { data: html } = await axios.get(apiUrl, { 
            headers: { 'User-Agent': 'GhostScrape/1.0 (contact@ghost-scrape.tech)' }
        });
        return distill(html, url);
    }

    // 🎯 FIX 2: THE "SNIPER" BROWSER (For TechCrunch/ZDNet)
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--single-process'] 
    });
    const page = await browser.newPage();

    try {
        // Block everything but text data
        await page.route('**/*', (route) => {
            return ['document', 'script'].includes(route.request().resourceType()) ? route.continue() : route.abort();
        });

        // Use 'commit' instead of 'load' - this stops the clock 20 seconds earlier
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        
        // Grab content the moment the first paragraph exists
        await page.waitForSelector('p', { timeout: 5000 }).catch(() => null);

        const html = await page.content();
        return distill(html, url);
    } finally {
        await browser.close();
    }
}

app.get('/scrape', async (req, res) => {
    const { url } = req.query;
    try {
        const data = await scrapeSmart(url);
        res.json({ success: true, ...data });
    } catch (e) {
        res.status(500).json({ error: "Site is too slow or protected." });
    }
});

app.listen(5000, () => console.log("🚀 ULTRA-SPEED ENGINE LIVE"));