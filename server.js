const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const TurndownService = require("turndown");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
const { HttpProxyAgent } = require('http-proxy-agent');

// Core Configuration
require("dotenv").config();
chromium.use(stealth);

const app = express();
const cache = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour cache

// Proxy Setup from Env Vars
const PROXY_URL = process.env.PROXY_URL; // http://31.59.20.176:6754
const PROXY_USER = process.env.PROXY_USER; // etbhwesx
const PROXY_PASS = process.env.PROXY_PASS; // 5r7000jhftl8

// Formatted for Axios/Fast Mode
const FULL_PROXY = `http://${PROXY_USER}:${PROXY_PASS}@${PROXY_URL?.replace('http://', '')}`;

const turndown = new TurndownService({ 
    headingStyle: "atx", 
    codeBlockStyle: "fenced",
    emDelimiter: "*" 
});

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: "*" }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 60 }));

/**
 * Fast Mode: Axios with Proxy
 * Good for Wikipedia, Docs, etc.
 */
async function fetchFast(url) {
    const agent = new HttpProxyAgent(FULL_PROXY);
    const response = await axios.get(url, { 
        httpAgent: agent,
        httpsAgent: agent,
        timeout: 8000,
        headers: { 
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36" 
        }
    });
    return response.data;
}

/**
 * Stealth Mode: Playwright with Proxy
 * Mandatory for Reddit and Quora
 */
async function fetchStealth(url) {
    const browser = await chromium.launch({
        headless: true,
        proxy: {
            server: PROXY_URL,
            username: PROXY_USER,
            password: PROXY_PASS
        }
    });
    
    try {
        const context = await browser.newContext({
            viewport: { width: 1280, height: 800 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();
        
        // Reddit/Quora need time to load JS
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(2000); 
        
        const content = await page.content();
        await browser.close();
        return content;
    } catch (err) {
        await browser.close();
        throw err;
    }
}

/**
 * Content Distiller
 */
function distill(html, url) {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) throw new Error("Content could not be parsed. Site might be blocking the scraper.");

    return {
        title: article.title,
        content: article.textContent,
        markdown: turndown.turndown(article.content),
        excerpt: article.excerpt,
        stats: {
            raw_chars: html.length,
            distilled_chars: article.textContent.length
        }
    };
}

/**
 * Main Scrape Endpoint
 */
app.get("/scrape", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "URL is required" });

    try {
        // Cache Check
        if (cache.has(url)) {
            const cached = cache.get(url);
            if (Date.now() - cached.time < CACHE_TTL) return res.json(cached.data);
        }

        const start = Date.now();
        let html, mode = "fast";

        try {
            // Try Fast mode first
            html = await fetchFast(url);
        } catch (e) {
            console.log(`Fast mode blocked for ${url}. Switching to Proxy Stealth...`);
            // Switch to Playwright + Proxy if Fast mode fails (common for Reddit/Quora)
            html = await fetchStealth(url);
            mode = "stealth (proxy)";
        }

        const result = distill(html, url);
        const finalResponse = {
            success: true,
            mode,
            time_ms: Date.now() - start,
            ...result
        };

        cache.set(url, { data: finalResponse, time: Date.now() });
        res.json(finalResponse);

    } catch (err) {
        console.error("Scrape Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Scraper running on port ${PORT}`);
    console.log(`🚀 Proxy active: ${PROXY_URL}`);
});