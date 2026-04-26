const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const TurndownService = require('turndown');
const rateLimit = require('express-rate-limit');
const { chromium } = require('playwright');

require('dotenv').config();

const app = express();
app.use(cors());

// 🚧 RATE LIMIT
app.use(rateLimit({
    windowMs: 60 * 1000,
    max: 30
}));

// 🧠 CACHE
const cache = new Map();
const CACHE_TTL = 1000 * 60 * 30;

// 🔄 BROWSER REUSE
let browser;
async function getBrowser() {
    if (!browser) {
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox']
        });
    }
    return browser;
}

// 📄 MARKDOWN
const turndown = new TurndownService();
turndown.remove(['script', 'style', 'noscript', 'iframe', 'svg', 'img']);

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
            distilled_chars: md.length
        }
    };
}

// ⚡ FAST FETCH
async function fastFetch(url) {
    const { data } = await axios.get(url, {
        timeout: 8000,
        headers: {
            'User-Agent': 'GhostScrape/1.0'
        }
    });

    return distill(data, url);
}

// 🐢 BROWSER FALLBACK
async function browserFetch(url) {
    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
        await page.route('**/*', (route) => {
            const type = route.request().resourceType();
            if (['image', 'stylesheet', 'font'].includes(type)) {
                return route.abort();
            }
            return route.continue();
        });

        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 15000
        });

        await page.waitForSelector('p', { timeout: 5000 }).catch(() => {});

        const html = await page.content();
        return distill(html, url);
    } finally {
        await page.close();
    }
}

// 🔍 VALIDATION
function isValidUrl(url) {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

// 🎯 SCRAPER
async function scrape(url) {

    console.log("👉 Scraping:", url);

    // CACHE
    const cached = cache.get(url);
    if (cached && (Date.now() - cached.time < CACHE_TTL)) {
        return { ...cached.data, cached: true };
    }

    let result;

    // Wikipedia fast path
    if (url.includes('wikipedia.org')) {
        const parsedUrl = new URL(url);
        const wikiPath = parsedUrl.pathname.split('/wiki/')[1];
        if (!wikiPath) {
            throw new Error('Invalid Wikipedia article URL');
        }

        const title = encodeURIComponent(decodeURIComponent(wikiPath));
        const apiUrl = `https://en.wikipedia.org/api/rest_v1/page/html/${title}`;
        const { data } = await axios.get(apiUrl);
        result = distill(data, url);
    } else {
        try {
            result = await fastFetch(url);

            if (!result || result.markdown.length < 200) {
                throw new Error("Weak content");
            }

        } catch {
            result = await browserFetch(url);
        }
    }

    if (!result || !result.markdown) {
        throw new Error('No readable content found');
    }

    // LIMIT CACHE SIZE
    if (cache.size > 1000) cache.clear();

    cache.set(url, {
        data: result,
        time: Date.now()
    });

    return result;
}

// 🌐 API
app.get('/scrape', async (req, res) => {
    const { url } = req.query;

    if (!url || !isValidUrl(url)) {
        return res.status(400).json({ error: "Invalid URL" });
    }

    try {
        const start = Date.now();
        const data = await scrape(url);

        res.json({
            success: true,
            time_ms: Date.now() - start,
            ...data
        });
    } catch (e) {
        console.error("❌ SCRAPE ERROR:");
        console.error(e); // full error dump

        res.status(500).json({
            error: "Failed to scrape",
            details: e.message || "Unknown error"
        });
    }
});

// 🚀 START SERVER
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 GhostScrape running on ${PORT}`);
});