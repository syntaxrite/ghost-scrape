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
    // 1. TURBO PATH: Wikipedia & GitHub (Sub-second speed via Identity Spoofing)
    if (url.includes('wikipedia.org') || url.includes('github.com')) {
        console.log("⚡ Turbo Path: Bypassing Tarpit");
        const response = await axios.get(url, { 
            timeout: 10000,
            headers: { 
                // This specific header is the "Magic Key" to avoid Wikipedia's 20s delay
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' 
            }
        });
        return distill(response.data, url);
    }

    // 2. STEALTH ENGINE: (TechCrunch, ZDNet)
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process'] 
    });
    const page = await browser.newPage();

    try {
        // Snipe Mode: Block everything but the raw text document
        await page.route('**/*', (route) => {
            const type = route.request().resourceType();
            if (['image', 'media', 'font', 'stylesheet', 'other'].includes(type)) return route.abort();
            route.continue();
        });

        // Fast-Exit Navigation (waitUntil: 'commit' is the fastest possible state)
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
        
        // Race: Stop the moment content appears
        await Promise.race([
            page.waitForSelector('p', { timeout: 8000 }),
            new Promise(res => setTimeout(res, 8000))
        ]);

        const html = await page.content();
        return distill(html, url);
    } finally {
        await browser.close();
    }
}

app.get('/scrape', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "URL Required" });
    try {
        const data = await scrapeSmart(url);
        res.json({ success: true, ...data });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Engine v4.0 (Ghost-Scrape) Live on ${PORT}`));