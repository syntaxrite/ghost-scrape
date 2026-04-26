const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const TurndownService = require("turndown");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const dns = require("dns").promises;
const { chromium } = require("playwright");

require("dotenv").config();

const app = express();
app.use(helmet());
app.use(cors({ origin: "*" }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 60 }));

const cache = new Map();
const CACHE_TTL = 1000 * 60 * 60;
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

/* --- SSRF PROTECTION --- */
async function validateUrl(input) {
    const parsed = new URL(input);
    const hostname = parsed.hostname.toLowerCase();
    if (["localhost", "127.0.0.1", "::1"].includes(hostname)) throw new Error("Local access forbidden");

    const { address } = await dns.lookup(hostname);
    const parts = address.split('.').map(Number);
    const isPrivate = 
        address.startsWith("10.") || 
        address.startsWith("192.168.") ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
        address.startsWith("169.254.");

    if (isPrivate) throw new Error("Security Block: Private network detected");
    return parsed.toString();
}

/* --- FAST FETCH --- */
async function fetchFast(url) {
    const res = await axios.get(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Safari/537.36" },
        timeout: 7000
    });
    return res.data;
}

/* --- STEALTH FETCH (RAILWAY OPTIMIZED) --- */
async function fetchStealth(url) {
    console.log("🕵️ Entering Ultra-Stealth Mode...");
    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled', // Hides "automated" flag
        ]
    });

    try {
        const context = await browser.newContext({
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport: { width: 1920, height: 1080 },
            deviceScaleFactor: 1,
        });

        const page = await context.newPage();
        
        // Stack Overflow/Medium check for "webdriver" property. This deletes it.
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        // Use 'networkidle' for Medium/StackOverflow to ensure comments/math/code load
        await page.goto(url, { 
            waitUntil: "networkidle", 
            timeout: 45000 
        });

        // Human-like scroll to trigger lazy-loaded content
        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        await page.waitForTimeout(2500); 

        const content = await page.content();
        await browser.close();
        return content;
    } catch (err) {
        if (browser) await browser.close();
        throw new Error("Stealth failed: " + err.message);
    }
}

/* --- DISTILL --- */
function distill(html, url) {
    const dom = new JSDOM(html, { url });
    const doc = dom.window.document;

    // 1. Let Readability find the "Heart" of the page first
    const reader = new Readability(doc, {
        charThreshold: 500, // Helps with shorter Stack Overflow answers
        nbTopCandidates: 3
    });
    
    const article = reader.parse();

    if (!article || !article.content) {
        // Fallback: If Readability fails, grab the <body> but strip scripts
        const body = doc.body;
        body.querySelectorAll("script, style, nav, footer, header").forEach(el => el.remove());
        return {
            title: doc.title || "No Title",
            markdown: turndown.turndown(body.innerHTML),
            stats: { raw_chars: html.length, distilled_chars: body.textContent.length }
        };
    }

    // 2. Convert the found article content to Markdown
    const markdown = turndown.turndown(article.content);

    return {
        title: article.title,
        markdown: markdown,
        stats: {
            raw_chars: html.length,
            distilled_chars: markdown.length
        }
    };
}

/* --- ROUTE --- */
app.get("/scrape", async (req, res) => {
    let { url } = req.query;
    if (!url) return res.status(400).json({ success: false, error: "URL required" });

    try {
        const safeUrl = await validateUrl(url);
        if (cache.has(safeUrl)) return res.json(cache.get(safeUrl).data);

        const start = Date.now();
        let html, mode = "fast";

        try {
            html = await fetchFast(safeUrl);
        } catch (e) {
            if (e.response?.status === 403 || e.code === 'ECONNABORTED') {
                html = await fetchStealth(safeUrl);
                mode = "stealth";
            } else throw e;
        }

        const result = distill(html, safeUrl);
        const final = { success: true, mode, time_ms: Date.now() - start, ...result };
        cache.set(safeUrl, { data: final, time: Date.now() });
        res.json(final);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.listen(process.env.PORT || 8080);