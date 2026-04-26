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

// GLOBAL CACHE (The ultimate speed trick)
const memoryCache = new Map();

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
    // 0. CHECK CACHE (Instant)
    if (memoryCache.has(url)) return memoryCache.get(url);

    // 1. "ZERO-BROWSER" PATH (Wikipedia, GitHub, News)
    // We use a high-authority Chrome User-Agent to avoid the 23s delay
    try {
        const response = await axios.get(url, { 
            timeout: 5000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' } 
        });
        const result = distill(response.data, url);
        if (result && result.markdown.length > 200) {
            memoryCache.set(url, result);
            return result;
        }
    } catch (e) {
        console.log("Fast fetch failed, using emergency browser...");
    }

    // 2. EMERGENCY BROWSER (Only for sites that block Axios)
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--single-process'] 
    });
    const page = await browser.newPage();

    try {
        await page.route('**/*', (r) => ['document'].includes(r.request().resourceType()) ? r.continue() : r.abort());
        
        // Wait for ONLY the main frame to commit, then grab and go
        await page.goto(url, { waitUntil: 'commit', timeout: 15000 });
        const html = await page.content();
        const result = distill(html, url);
        memoryCache.set(url, result);
        return result;
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
        res.status(500).json({ error: "Speed limit exceeded. Try again." });
    }
});

app.listen(5000, () => console.log("🚀 GHOST-SPEED ENGINE ACTIVE"));