const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const TurndownService = require('turndown');
const rateLimit = require('express-rate-limit');

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

// 🎭 ROTATING USER AGENTS (basic anti-bot)
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/119 Safari/537.36'
];

function getHeaders() {
    const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    return {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'keep-alive'
    };
}

// 📄 MARKDOWN ENGINE
const turndown = new TurndownService();
turndown.remove(['script', 'style', 'noscript', 'iframe', 'svg', 'img']);

function distill(html, url) {
    const doc = new JSDOM(html, { url });
    const article = new Readability(doc.window.document).parse();

    // 🧠 If Readability works
    if (article && article.textContent.length > 200) {
        const md = turndown.turndown(article.content);

        return {
            title: article.title,
            markdown: md,
            mode: "readability",
            stats: {
                raw_chars: html.length,
                distilled_chars: md.length
            }
        };
    }

    // 💀 Fallback: extract body text manually
    console.log("⚠️ Falling back to raw extraction");

    const bodyText = doc.window.document.body.textContent
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 15000); // limit

    return {
        title: doc.window.document.title || "Untitled",
        markdown: bodyText,
        mode: "raw",
        stats: {
            raw_chars: html.length,
            distilled_chars: bodyText.length
        }
    };
}

// ⚡ SMART FETCH (retry + anti-bot)
async function fetchPage(url) {
    try {
        const { data } = await axios.get(url, {
            timeout: 15000,
            headers: getHeaders(),
            maxRedirects: 5
        });
        return data;
    } catch (err) {
        // retry once with new headers
        console.log("🔁 Retry with new headers...");
        const { data } = await axios.get(url, {
            timeout: 15000,
            headers: getHeaders()
        });
        return data;
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

    // ⚡ CACHE
    const cached = cache.get(url);
    if (cached && (Date.now() - cached.time < CACHE_TTL)) {
        console.log("⚡ Cache hit");
        return { ...cached.data, cached: true };
    }

    let html;

    try {
        html = await fetchPage(url);
    } catch (err) {
        console.error("❌ Fetch failed:", err.message);
        throw new Error("Failed to fetch page (blocked or timeout)");
    }

    const result = distill(html, url);

    if (!result || !result.markdown) {
        throw new Error("No readable content found");
    }

    // 🧹 CACHE LIMIT
    if (cache.size > 1000) cache.clear();

    cache.set(url, {
        data: result,
        time: Date.now()
    });

    return result;
}

// 🌐 ROOT
app.get('/', (req, res) => {
    res.send("👻 GhostScrape API is alive");
});

// 🌐 API
app.get('/scrape', async (req, res) => {
    const { url } = req.query;

    if (!url || !isValidUrl(url)) {
        return res.status(400).json({ success: false, error: "Invalid URL" });
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
        console.error("❌ SCRAPE ERROR:", e.message);

        res.status(500).json({
            success: false,
            error: e.message
        });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 GhostScrape running on ${PORT}`);
});