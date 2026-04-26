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
    // 1. TURBO PATH: Wikipedia & GitHub (Identity spoofed for instant speed)
    if (url.includes('wikipedia.org') || url.includes('github.com')) {
        console.log("⚡ Turbo Path Active");
        const response = await axios.get(url, { 
            timeout: 10000,
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' 
            }
        });
        return distill(response.data, url);
    }

    // 2. STEALTH ENGINE: Aggressively optimized for Render's 512MB RAM
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--single-process'] 
    });
    const page = await browser.newPage();

    try {
        // "Sniper" Mode: Kill all non-essential assets immediately
        await page.route('**/*', (route) => {
            const type = route.request().resourceType();
            if (['image', 'media', 'font', 'stylesheet', 'other'].includes(type)) {
                return route.abort();
            }
            route.continue();
        });

        // Fast-Exit Navigation
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        
        // Don't wait for "Load"—just wait for any paragraph tag to appear
        await page.waitForSelector('p', { timeout: 5000 }).catch(() => null);

        const html = await page.content();
        return distill(html, url);
    } finally {
        await browser.close();
    }
}

app.get('/scrape', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "URL required" });
    try {
        const data = await scrapeSmart(url);
        res.json({ success: true, ...data });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Ghost-Scrape Engine v3.5 Live` || "Server Error"));