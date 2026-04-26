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

// Security & Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: "*" }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 60 }));

const cache = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

const turndown = new TurndownService({ 
    headingStyle: "atx", 
    codeBlockStyle: "fenced",
    emDelimiter: "*" 
});

/* --- SSRF PROTECTION --- */
async function validateUrl(input) {
    try {
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

        if (isPrivate) throw new Error("Security Block: Private network");
        return parsed.toString();
    } catch (e) {
        throw new Error(e.message || "Invalid URL");
    }
}

/* --- FAST FETCH (AXIOS) --- */
async function fetchFast(url) {
    const res = await axios.get(url, {
        headers: { 
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
        },
        timeout: 8000
    });
    return res.data;
}

/* --- STEALTH FETCH (ULTRA MODE) --- */
async function fetchStealth(url) {
    console.log("🕵️ Launching Ultra-Stealth Browser...");
    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--single-process' 
        ]
    });

    try {
        const context = await browser.newContext({
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport: { width: 1280, height: 800 }
        });

        const page = await context.newPage();
        
        // Mask the fact that this is a robot
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        // Increase timeout for slow sites like Medium
        await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
        
        // Scroll slightly to trigger lazy-loaded images/text
        await page.evaluate(() => window.scrollBy(0, 500));
        await page.waitForTimeout(1500);

        const content = await page.content();
        await browser.close();
        return content;
    } catch (err) {
        if (browser) await browser.close();
        console.error("Stealth Error:", err.message);
        throw new Error("Site blocked access or timed out.");
    }
}

/* --- DISTILL ENGINE --- */
function distill(html, url) {
    const dom = new JSDOM(html, { url });
    const doc = dom.window.document;

    const reader = new Readability(doc, { charThreshold: 400 });
    const article = reader.parse();

    if (!article || !article.content) {
        // Fallback if Readability fails
        const bodyText = doc.body?.textContent || "";
        return {
            title: doc.title || "Untitled",
            markdown: turndown.turndown(doc.body?.innerHTML || ""),
            stats: { raw_chars: html.length, distilled_chars: bodyText.length }
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

/* --- ROUTES --- */
app.get("/scrape", async (req, res) => {
    let { url } = req.query;
    if (!url) return res.status(400).json({ success: false, error: "URL required" });

    try {
        const safeUrl = await validateUrl(url);

        if (cache.has(safeUrl)) {
            const cached = cache.get(safeUrl);
            if (Date.now() - cached.time < CACHE_TTL) return res.json(cached.data);
        }

        const start = Date.now();
        let html, mode = "fast";

        try {
            html = await fetchFast(safeUrl);
        } catch (e) {
            // Pivot to Stealth on 403, 401, or Timeout
            if (e.response?.status === 403 || e.response?.status === 401 || e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT') {
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
        console.error("Final Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 GhostScrape API on port ${PORT}`));