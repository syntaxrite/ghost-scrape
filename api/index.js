const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { chromium } = require("playwright-core");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const TurndownService = require("turndown");
const { HttpProxyAgent } = require('http-proxy-agent');

const app = express();
app.use(cors());
app.use(express.json());

// Proxy setup (Used for the 'Fast' fetch)
const proxyUrl = `http://${process.env.PROXY_USER}:${process.env.PROXY_PASS}@${process.env.PROXY_URL}`;
const agent = new HttpProxyAgent(proxyUrl);

const turndown = new TurndownService({ headingStyle: 'atx' });

// Simple scraping function
app.get("/scrape", async (req, res) => {
    const { url } = req.query;

    if (!url) return res.status(400).json({ error: "No URL provided" });

    try {
        console.log(`Scraping: ${url}`);
        
        let html;
        let mode = "fast";

        try {
            // Step 1: Try fast fetch with axios + residential proxy
            const response = await axios.get(url, { 
                httpAgent: agent, 
                httpsAgent: agent,
                timeout: 10000,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' }
            });
            html = response.data;
        } catch (e) {
            // Step 2: If fast fetch fails (blocked), fallback to Browserless (Stealth)
            mode = "stealth";
            const browser = await chromium.connectOverCDP(
                `wss://production-sfo.browserless.io/chromium?token=${process.env.BROWSERLESS_TOKEN}`
            );
            const page = await browser.newContext().then(ctx => ctx.newPage());
            await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
            html = await page.content();
            await browser.close();
        }

        // Step 3: Parse and Convert
        const dom = new JSDOM(html, { url });
        const reader = new Readability(dom.window.document);
        const article = reader.parse();

        if (!article) throw new Error("Failed to parse content.");

        const markdown = turndown.turndown(article.content);

        res.json({
            success: true,
            mode: mode,
            title: article.title,
            markdown: markdown
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = app;