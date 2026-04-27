const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { chromium } = require("playwright-core");
const { createClient } = require("@supabase/supabase-js");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const TurndownService = require("turndown");
const { HttpProxyAgent } = require('http-proxy-agent');

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Construct Proxy Agent for Axios
const proxyString = `http://${process.env.PROXY_USER}:${process.env.PROXY_PASS}@${process.env.PROXY_URL}`;
const agent = new HttpProxyAgent(proxyString);

// Smart Router: Does this site NEED a browser?
const needsStealth = (url) => {
    const targets = ['reddit.com', 'quora.com', 'twitter.com', 'instagram.com', 'facebook.com', 'linkedin.com'];
    return targets.some(target => url.toLowerCase().includes(target));
};

app.get("/scrape", async (req, res) => {
    const { url } = req.query;
    const apiKey = req.headers['x-api-key'];

    if (!url) return res.status(400).json({ error: "URL is required" });
    if (!apiKey) return res.status(401).json({ error: "API Key is required" });

    // 1. Auth & Credit Check
    const { data: user, error } = await supabase.from('profiles').select('*').eq('api_key', apiKey).single();
    if (error || !user) return res.status(403).json({ error: "Invalid API Key" });
    if (user.usage_count >= user.usage_limit) return res.status(429).json({ error: "Out of credits" });

    let html, mode;

    try {
        if (needsStealth(url)) {
            mode = "stealth";
            const browser = await chromium.connectOverCDP(`wss://production-sfo.browserless.io/chromium?token=${process.env.BROWSERLESS_TOKEN}`);
            const page = await browser.newPage();
            await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
            html = await page.content();
            await browser.close();
        } else {
            mode = "fast";
            const response = await axios.get(url, { 
                httpAgent: agent, 
                httpsAgent: agent,
                timeout: 15000,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            html = response.data;
        }

        // 2. Process Content
        const dom = new JSDOM(html, { url });
        const reader = new Readability(dom.window.document);
        const article = reader.parse();
        const turndown = new TurndownService({ headingStyle: 'atx' });

        // 3. Update Credits
        await supabase.rpc('increment_usage', { target_api_key: apiKey });

        res.json({
            success: true,
            mode,
            title: article?.title,
            markdown: article ? turndown.turndown(article.content) : "No content"
        });

    } catch (err) {
        res.status(500).json({ error: err.message, mode: "failed" });
    }
});

module.exports = app;