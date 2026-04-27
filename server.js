const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const TurndownService = require("turndown");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const dns = require("dns").promises;
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();

// Core Configuration
require("dotenv").config();
chromium.use(stealth);

const app = express();
const cache = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

const turndown = new TurndownService({ 
    headingStyle: "atx", 
    codeBlockStyle: "fenced",
    emDelimiter: "*" 
});

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: "*" }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 60 })); // 60 requests per minute

/* --- SSRF PROTECTION: BLOCKING PRIVATE IPS --- */
async function validateUrl(input) {
    try {
        const parsed = new URL(input);
        const hostname = parsed.hostname.toLowerCase();
        
        if (["localhost", "127.0.0.1", "::1"].includes(hostname)) {
            throw new Error("Internal access forbidden");
        }

        const { address } = await dns.lookup(hostname);
        const parts = address.split('.').map(Number);
        
        const isPrivate = 
            address.startsWith("10.") || 
            address.startsWith("192.168.") ||
            (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
            address.startsWith("169.254.");

        if (isPrivate) throw new Error("Security Block: Private network detected");
        
        return parsed.toString();
    } catch (e) {
        throw new Error(e.message || "Invalid URL");
    }
}

/* --- FAST FETCH: LIGHTWEIGHT AXIOS --- */
async function fetchFast(url) {
    const res = await axios.get(url, {
        headers: { 
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Referer": "https://www.google.com/"
        },
        timeout: 8000
    });
    return res.data;
}

/* --- ULTRA-STEALTH FETCH: PLAYWRIGHT WITH CLOAKING --- */
async function fetchStealth(url) {
    console.log("🕵️ Launching Ghost-Mode Browser...");
    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--single-process' // Saves RAM on Railway
        ]
    });

    try {
        const context = await browser.newContext({
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport: { width: 1280, height: 800 },
            extraHTTPHeaders: { 'Referer': 'https://www.google.com/' }
        });

        const page = await context.newPage();
        
        // 🔥 PERFORMANCE: Block images, CSS, and fonts to save memory/speed
        await page.route('**/*.{png,jpg,jpeg,gif,svg,webp,css,woff,woff2}', (route) => route.abort());

        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

        // 🖱️ HUMAN INTERACTION: Jitter scroll to trigger lazy loading
        for (let i = 0; i < 3; i++) {
            await page.evaluate(() => window.scrollBy(0, window.innerHeight / 2));
            await page.waitForTimeout(800); 
        }

        const content = await page.content();
        return content;
    } finally {
        // ALWAYS close the browser to prevent memory leaks/Status 137
        if (browser) await browser.close();
    }
}

/* --- DISTILL ENGINE: ARTICLE CLEANING --- */
function distill(html, url) {
    const dom = new JSDOM(html, { url });
    const doc = dom.window.document;

    // Remove junk before parsing
    const junk = doc.querySelectorAll('script, style, iframe, noscript, ad, ins');
    junk.forEach(el => el.remove());

    const reader = new Readability(doc, { charThreshold: 400 });
    const article = reader.parse();

    let md, title;
    if (!article || !article.content) {
        title = doc.title || "No Title Found";
        const bodyFallback = doc.querySelector('article') || doc.querySelector('main') || doc.body;
        md = turndown.turndown(bodyFallback.innerHTML || "No content extracted.");
    } else {
        title = article.title;
        md = turndown.turndown(article.content);
    }

    return {
        title,
        markdown: md,
        stats: {
            raw_chars: html.length,
            distilled_chars: md.length
        }
    };
}

/* --- THE SCRAPE ROUTE --- */
app.get("/scrape", async (req, res) => {
    let { url } = req.query;
    if (!url) return res.status(400).json({ success: false, error: "URL is required" });

    try {
        const safeUrl = await validateUrl(url);

        // Cache Check
        if (cache.has(safeUrl)) {
            const cached = cache.get(safeUrl);
            if (Date.now() - cached.time < CACHE_TTL) return res.json(cached.data);
        }

        const start = Date.now();
        let html, mode = "fast";

        try {
            html = await fetchFast(safeUrl);
        } catch (e) {
            // Pivot to Stealth on blocks or timeouts
            const status = e.response?.status;
            if (status === 403 || status === 401 || e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT') {
                html = await fetchStealth(safeUrl);
                mode = "stealth";
            } else {
                throw e;
            }
        }

        const result = distill(html, safeUrl);
        const finalResponse = {
            success: true,
            mode,
            time_ms: Date.now() - start,
            ...result
        };

        cache.set(safeUrl, { data: finalResponse, time: Date.now() });
        res.json(finalResponse);

    } catch (err) {
        console.error("Critical Failure:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`
    👻 GhostScrape Engine Active
    🚀 Port: ${PORT}
    🛡️ Stealth: Enabled
    🔒 SSRF Protection: Active
    `);
});