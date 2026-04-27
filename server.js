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
const VERSION = "5967";

// Proxy Configuration
const PROXY_URL = process.env.PROXY_URL; 
const PROXY_USER = process.env.PROXY_USER;
const PROXY_PASS = process.env.PROXY_PASS;
const FULL_PROXY = PROXY_URL ? `http://${PROXY_USER}:${PROXY_PASS}@${PROXY_URL.replace('http://', '')}` : null;

app.use(cors({ origin: "*" }));

app.get("/health", (req, res) => res.json({ status: "alive", version: VERSION }));

app.get("/scrape", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "URL required" });
    
    try {
        let html;
        // Try Playwright directly for Reddit/Quora
        const browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox'],
            proxy: { server: PROXY_URL, username: PROXY_USER, password: PROXY_PASS }
        });
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
        html = await page.content();
        await browser.close();

        const dom = new JSDOM(html, { url });
        const reader = new Readability(dom.window.document);
        const article = reader.parse();
        const turndown = new TurndownService();

        res.json({
            success: true,
            title: article.title,
            markdown: turndown.turndown(article.content),
            version: VERSION
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`GhostScrape v${VERSION} Active`));