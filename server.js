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
app.use(rateLimit({ windowMs: 60 * 1000, max: 40 }));

const cache = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

/* ---------------- 1. FAST FETCH (AXIOS) ---------------- */
async function fetchFast(url) {
    console.log("🚀 Attempting Fast Fetch...");
    const response = await axios.get(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
        },
        timeout: 8000
    });
    return response.data;
}

/* ---------------- 2. STEALTH FETCH (PLAYWRIGHT) ---------------- */
async function fetchStealth(url) {
    console.log("🕵️ Fast Fetch blocked or failed. Switching to Stealth Mode...");
    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext({
            viewport: { width: 1280, height: 800 }
        });
        const page = await context.newPage();
        // Wait for 'load' instead of 'networkidle' for speed, or 'domcontentloaded'
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
        
        // Optional: wait a tiny bit for JS to execute
        await page.waitForTimeout(1000); 
        
        return await page.content();
    } finally {
        await browser.close();
    }
}

/* ---------------- REFINED SSRF CHECK ---------------- */
async function validateUrl(input) {
    const parsed = new URL(input);
    const hostname = parsed.hostname.toLowerCase();
    
    if (["localhost", "127.0.0.1", "::1"].includes(hostname)) throw new Error("Local access forbidden");

    const { address } = await dns.lookup(hostname);
    
    // Narrower check for 172 range to avoid blocking public IPs mistakenly
    const isPrivate = 
        address.startsWith("10.") || 
        address.startsWith("192.168.") ||
        (address.startsWith("172.") && parseInt(address.split(".")[1]) >= 16 && parseInt(address.split(".")[1]) <= 31) ||
        address.startsWith("169.254.");

    if (isPrivate) throw new Error("Security Block: Private network detected");
    return parsed.toString();
}

/* ---------------- DISTILL ---------------- */
function distill(html, url) {
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();

    if (!article) return null;

    const markdown = turndown.turndown(article.content);
    return {
        title: article.title,
        markdown: markdown,
        stats: { raw_chars: html.length, distilled_chars: markdown.length }
    };
}

/* ---------------- MAIN ROUTE ---------------- */
app.get("/scrape", async (req, res) => {
    let { url } = req.query;
    if (!url) return res.status(400).json({ success: false, error: "URL is required" });

    try {
        url = await validateUrl(url);

        // Check Cache
        if (cache.has(url)) {
            const cached = cache.get(url);
            if (Date.now() - cached.time < CACHE_TTL) return res.json({ ...cached.data, cached: true });
        }

        const start = Date.now();
        let html;
        let mode = "fast";

        try {
            html = await fetchFast(url);
        } catch (fastErr) {
            // If we get a 403, 401, or 429, we swap to Stealth
            const status = fastErr.response?.status;
            if (status === 403 || status === 401 || status === 429 || fastErr.code === 'ECONNABORTED') {
                html = await fetchStealth(url);
                mode = "stealth";
            } else {
                throw fastErr; // Real error (like 404 or DNS fail)
            }
        }

        const result = distill(html, url);
        if (!result) throw new Error("Failed to parse content");

        const responseData = {
            success: true,
            mode,
            time_ms: Date.now() - start,
            ...result
        };

        cache.set(url, { data: responseData, time: Date.now() });
        res.json(responseData);

    } catch (err) {
        console.error("Scrape Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`👻 GhostScrape running on ${PORT}`));