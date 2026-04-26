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

// 📄 MARKDOWN ENGINE
const turndown = new TurndownService();
turndown.remove(['script', 'style', 'noscript', 'iframe', 'svg', 'img']);

function distill(html, url) {
    const doc = new JSDOM(html, { url });
    const article = new Readability(doc.window.document).parse();

    if (!article) {
        return {
            title: "Extraction Failed",
            markdown: "Could not extract readable content.",
            stats: {
                raw_chars: html.length,
                distilled_chars: 0
            }
        };
    }

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

// ⚡ FETCH
async function fetchPage(url) {
    const { data } = await axios.get(url, {
        timeout: 15000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (GhostScrape)'
        }
    });

    return distill(data, url);
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

    const cached = cache.get(url);
    if (cached && (Date.now() - cached.time < CACHE_TTL)) {
        console.log("⚡ Cache hit");
        return { ...cached.data, cached: true };
    }

    let result;

    if (url.includes('wikipedia.org')) {
        const parsedUrl = new URL(url);
        const wikiPath = parsedUrl.pathname.split('/wiki/')[1];

        if (!wikiPath) throw new Error('Invalid Wikipedia URL');

        const title = encodeURIComponent(decodeURIComponent(wikiPath));
        const apiUrl = `https://en.wikipedia.org/api/rest_v1/page/html/${title}`;

        const { data } = await axios.get(apiUrl);
        result = distill(data, url);
    } else {
        result = await fetchPage(url);
    }

    if (!result || !result.markdown) {
        throw new Error("No readable content found");
    }

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
        console.error("❌ SCRAPE ERROR:", e);

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