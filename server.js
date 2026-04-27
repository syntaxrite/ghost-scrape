const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const TurndownService = require("turndown");
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
const { HttpProxyAgent } = require('http-proxy-agent');

require("dotenv").config();
chromium.use(stealth);

const app = express();

// Proxy Setup
const PROXY_URL = process.env.PROXY_URL; 
const PROXY_USER = process.env.PROXY_USER;
const PROXY_PASS = process.env.PROXY_PASS;
const FULL_PROXY = `http://${PROXY_USER}:${PROXY_PASS}@${PROXY_URL?.replace('http://', '')}`;

app.use(cors({ origin: "*" }));

// Utility: Determine if we NEED a browser (Smart Routing)
const needsStealth = (url) => {
    const targets = ['reddit.com', 'quora.com', 'twitter.com', 'instagram.com', 'facebook.com'];
    return targets.some(target => url.toLowerCase().includes(target));
};

async function fetchFast(url) {
    const agent = new HttpProxyAgent(FULL_PROXY);
    const response = await axios.get(url, { 
        httpAgent: agent, httpsAgent: agent,
        timeout: 10000,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36" }
    });
    return response.data;
}

async function fetchStealth(url) {
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        proxy: { server: PROXY_URL, username: PROXY_USER, password: PROXY_PASS }
    });
    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
        const content = await page.content();
        await browser.close();
        return content;
    } catch (err) {
        await browser.close();
        throw err;
    }
}

app.get("/scrape", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "URL required" });
    
    const startTime = Date.now();
    let html, mode;

    try {
        if (needsStealth(url)) {
            mode = "Stealth (Chromium)";
            html = await fetchStealth(url);
        } else {
            try {
                mode = "FastFetch (Axios)";
                html = await fetchFast(url);
            } catch (e) {
                mode = "Stealth (Failover)";
                html = await fetchStealth(url);
            }
        }

        const dom = new JSDOM(html, { url });
        const reader = new Readability(dom.window.document);
        const article = reader.parse();
        const turndown = new TurndownService({ headingStyle: 'atx' });

        res.json({
            success: true,
            title: article?.title || "No Title Found",
            markdown: article ? turndown.turndown(article.content) : "No content distilled",
            mode,
            time_ms: Date.now() - startTime,
            stats: {
                raw_chars: html.length,
                distilled_chars: article ? article.textContent.length : 0
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`GhostScrape is active on port ${PORT}`));