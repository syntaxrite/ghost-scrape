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

// Simple In-Memory Cache (The "Instant" Win)
const cache = new Map();

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
turndown.remove(['script', 'style', 'noscript', 'iframe', 'svg', 'img', 'video', 'footer', 'nav', 'header']);

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
    // 1. CACHE CHECK
    if (cache.has(url)) {
        console.log("🎯 Cache Hit: Instant Return");
        return cache.get(url);
    }

    // 2. FAST PATH (Wikipedia/GitHub) - Identity Fix included
    if (url.includes('wikipedia.org') || url.includes('github.com')) {
        const { data: html } = await axios.get(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } 
        });
        const result = distill(html, url);
        cache.set(url, result); // Save to cache
        return result;
    }

    // 3. OPTIMIZED CHROMIUM (Lighter than Firefox)
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process'] 
    });
    const page = await browser.newPage();

    try {
        await page.route('**/*', (route) => {
            const type = route.request().resourceType();
            // Aggressively block everything but the document
            if (['document'].includes(type)) return route.continue();
            return route.abort();
        });

        // Use 'commit' instead of 'domcontentloaded' for ultra-fast exit
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        
        // Wait for the FIRST paragraph and stop immediately
        await page.waitForSelector('p', { timeout: 3000 }).catch(() => null);

        const html = await page.content();
        const result = distill(html, url);
        cache.set(url, result);
        return result;
    } finally {
        await browser.close();
    }
}

app.get('/scrape', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send("Missing URL");
    try {
        const data = await scrapeSmart(url);
        res.json({ success: true, ...data });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(5000, () => console.log("🚀 Hyper-Engine Live"));