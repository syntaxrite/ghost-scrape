const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const TurndownService = require('turndown');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const dns = require('dns').promises;

require('dotenv').config();

const app = express();

/* ---------------- SECURITY ---------------- */
app.use(helmet());

app.use(cors({
    origin: "*", // tighten later when deploying frontend
    methods: ["GET"],
}));

app.use(rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false
}));

/* ---------------- CACHE ---------------- */
const cache = new Map();
const CACHE_TTL = 1000 * 60 * 30;

setInterval(() => {
    const now = Date.now();
    for (const [key, value] of cache.entries()) {
        if (now - value.time > CACHE_TTL) {
            cache.delete(key);
        }
    }
}, 60 * 1000);

/* ---------------- USER AGENTS ---------------- */
const USER_AGENTS = [
    'Mozilla/5.0 Chrome/120 Safari/537.36',
    'Mozilla/5.0 Safari/605.1.15',
    'Mozilla/5.0 Chrome/119 Safari/537.36'
];

function getHeaders() {
    return {
        'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
        'Accept': 'text/html,application/xhtml+xml'
    };
}

/* ---------------- SSRF PROTECTION ---------------- */
async function validateUrl(input) {
    let parsed;

    try {
        parsed = new URL(input);
    } catch {
        throw new Error("Invalid URL");
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("Only HTTP/HTTPS allowed");
    }

    const hostname = parsed.hostname.toLowerCase();

    const blockedHosts = [
        "localhost",
        "127.0.0.1",
        "0.0.0.0"
    ];

    if (blockedHosts.includes(hostname)) {
        throw new Error("Blocked host");
    }

    const { address } = await dns.lookup(hostname);

    if (
        address.startsWith("10.") ||
        address.startsWith("192.168.") ||
        address.startsWith("172.")
    ) {
        throw new Error("Private network blocked");
    }

    return parsed.toString();
}

/* ---------------- CLEANUP ---------------- */
function cleanDom(document) {
    const selectors = [
        'script','style','noscript','iframe',
        'header','footer','nav','aside',
        '[class*="ad"]','[id*="ad"]'
    ];

    selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => el.remove());
    });
}

/* ---------------- MEDIA ---------------- */
function simplifyMedia(document) {
    document.querySelectorAll('img').forEach(img => {
        const src = img.src || "";
        img.replaceWith(`[image](${src})`);
    });
}

/* ---------------- MARKDOWN ENGINE ---------------- */
const turndown = new TurndownService();
turndown.remove(['script','style','iframe']);

/* ---------------- DISTILL ---------------- */
function distill(html, pageUrl) {
    const dom = new JSDOM(html, { url: pageUrl });
    const doc = dom.window.document;

    cleanDom(doc);
    simplifyMedia(doc);

    const article = new Readability(doc).parse();

    if (article?.content) {
        return {
            title: article.title,
            markdown: turndown.turndown(article.content),
            mode: "readability"
        };
    }

    return {
        title: doc.title || "Untitled",
        markdown: doc.body?.textContent?.slice(0, 20000) || "",
        mode: "fallback"
    };
}

/* ---------------- FETCH ---------------- */
async function fetchPage(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const res = await axios.get(url, {
            headers: getHeaders(),
            signal: controller.signal
        });

        return res.data;
    } finally {
        clearTimeout(timeout);
    }
}

/* ---------------- SCRAPE CORE ---------------- */
async function scrape(rawUrl) {
    const safeUrl = await validateUrl(rawUrl);

    const cached = cache.get(safeUrl);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
        return { ...cached.data, cached: true };
    }

    const html = await fetchPage(safeUrl);
    const result = distill(html, safeUrl);

    cache.set(safeUrl, {
        data: result,
        time: Date.now()
    });

    return result;
}

/* ---------------- ROUTES ---------------- */
app.get('/', (req, res) => {
    res.send("👻 GhostScrape API alive");
});

app.get('/scrape', async (req, res) => {
    try {
        const url = req.query.url;

        if (!url) {
            return res.status(400).json({
                success: false,
                error: "Missing URL"
            });
        }

        const start = Date.now();
        const data = await scrape(url);

        res.json({
            success: true,
            time_ms: Date.now() - start,
            ...data
        });

    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

/* ---------------- START ---------------- */
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
    console.log(`👻 GhostScrape running on port ${PORT}`);
});