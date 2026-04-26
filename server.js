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
    console.log("🕵️ Switching to Stealth Mode...");
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process']
    });
    try {
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(2000); 
        const content = await page.content();
        await browser.close();
        return content;
    } catch (err) {
        if (browser) await browser.close();
        throw err;
    }
}

/* --- DISTILL --- */
function distill(html, url) {
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    if (!article) return null;
    const md = turndown.turndown(article.content);
    return { title: article.title, markdown: md, stats: { raw_chars: html.length, distilled_chars: md.length } };
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