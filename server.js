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

// 🎭 USER AGENTS
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/119 Safari/537.36'
];

function getHeaders() {
    return {
        'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'keep-alive'
    };
}

// 🧹 REMOVE ADS / JUNK
function cleanDom(document) {
    const selectors = [
        'script', 'style', 'noscript', 'iframe',
        'header', 'footer', 'nav', 'aside',
        '.ads', '.advertisement', '.promo',
        '[class*="ad"]', '[id*="ad"]',
        '.sidebar', '.popup', '.banner'
    ];

    selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => el.remove());
    });

    return document;
}

// 🖼️ SIMPLIFY MEDIA
function simplifyMedia(document) {
    document.querySelectorAll('img').forEach(img => {
        const src = img.src || '';
        img.replaceWith(`[Image: ${src.split('/').pop() || 'image'}.jpg]`);
    });

    document.querySelectorAll('video').forEach(video => {
        video.replaceWith(`[Video content removed]`);
    });

    return document;
}

// 📄 MARKDOWN ENGINE
const turndown = new TurndownService();
turndown.remove(['script', 'style', 'iframe', 'svg']);

// 🧠 DISTILL FUNCTION (SMART)
function distill(html, url) {
    const dom = new JSDOM(html, { url });
    let document = dom.window.document;

    // 🧹 Clean junk first
    document = cleanDom(document);

    // 🖼️ simplify media
    document = simplifyMedia(document);

    // 🧠 Try Readability
    const article = new Readability(document).parse();

    if (article && article.textContent.length > 300) {
        const md = turndown.turndown(article.content);

        return {
            title: article.title,
            markdown: formatMarkdown(md),
            mode: "readability",
            stats: {
                raw_chars: html.length,
                distilled_chars: md.length
            }
        };
    }

    function formatMarkdown(md) {
    return md
        // Add spacing after headings
        .replace(/(#+ .+)/g, '\n$1\n')

        // Fix bullet lists
        .replace(/•/g, '\n- ')

        // Add spacing after sentences
        .replace(/([a-z])([A-Z])/g, '$1\n\n$2')

        // Clean excessive spaces
        .replace(/\s{2,}/g, ' ')

        // Add spacing around code
        .replace(/(const|let|var|function)/g, '\n\n$1')

        .trim();
}

    // 💀 Fallback: grab main content manually
    console.log("⚠️ Readability failed → fallback mode");

    let text = document.body.textContent
    .replace(/\.\s+/g, '.\n\n') // sentence spacing
    .replace(/:\s+/g, ':\n')    // headings
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 20000);

    return {
        title: document.title || "Untitled",
        markdown: text,
        mode: "fallback",
        stats: {
            raw_chars: html.length,
            distilled_chars: text.length
        }
    };
}

// ⚡ FETCH
async function fetchPage(url) {
    try {
        const { data } = await axios.get(url, {
            timeout: 15000,
            headers: getHeaders(),
            decompress: true
        });
        return data;
    } catch (err) {
        console.log("🔁 Retry...");
        const { data } = await axios.get(url, {
            timeout: 15000,
            headers: getHeaders()
        });
        return data;
    }
}

// 🎯 SCRAPER
async function scrape(url) {
    console.log("👉 Scraping:", url);

    const cached = cache.get(url);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
        console.log("⚡ Cache hit");
        return { ...cached.data, cached: true };
    }

    let html;

    try {
        html = await fetchPage(url);
    } catch (err) {
        throw new Error("Fetch failed (blocked or timeout)");
    }

    const result = distill(html, url);

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

    try {
        const start = Date.now();
        const data = await scrape(url);

        res.json({
            success: true,
            time_ms: Date.now() - start,
            ...data
        });

    } catch (e) {
        console.error("❌ ERROR:", e.message);

        res.status(500).json({
            success: false,
            error: e.message
        });
    }
});

// 🚀 START
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Running on ${PORT}`);
});