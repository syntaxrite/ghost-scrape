const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const TurndownService = require("turndown");
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
const { HttpProxyAgent } = require('http-proxy-agent');
const { createClient } = require('@supabase/supabase-js');

require("dotenv").config();
chromium.use(stealth);

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

app.use(cors({ origin: "*" }));
app.use(express.json());

const FULL_PROXY = `http://${process.env.PROXY_USER}:${process.env.PROXY_PASS}@${process.env.PROXY_URL?.replace('http://', '')}`;

// Smart Router: Does this site NEED a browser?
const needsStealth = (url) => {
    const targets = ['reddit.com', 'quora.com', 'twitter.com', 'instagram.com', 'facebook.com', 'linkedin.com'];
    return targets.some(target => url.toLowerCase().includes(target));
};

async function fetchFast(url) {
    const agent = new HttpProxyAgent(FULL_PROXY);
    const res = await axios.get(url, { 
        httpAgent: agent, httpsAgent: agent,
        timeout: 15000,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36" }
    });
    return res.data;
}

async function fetchStealth(url) {
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        proxy: { server: process.env.PROXY_URL, username: process.env.PROXY_USER, password: process.env.PROXY_PASS }
    });
    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
        const html = await page.content();
        await browser.close();
        return html;
    } catch (e) {
        await browser.close();
        throw e;
    }
}

// THE GATEKEEPER MIDDLEWARE
const authenticate = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(401).json({ error: "Missing API Key. Provide 'x-api-key' in headers." });

    const { data: user, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('api_key', apiKey)
        .single();

    if (error || !user) return res.status(403).json({ error: "Invalid API Key." });
    if (user.usage_count >= user.usage_limit) return res.status(429).json({ error: "Limit reached. Upgrade at ghost-scrape.tech" });

    req.user = user;
    next();
};

app.get("/scrape", authenticate, async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "URL required" });

    const start = Date.now();
    let html, mode;

    try {
        if (needsStealth(url)) {
            mode = "stealth";
            html = await fetchStealth(url);
        } else {
            try {
                mode = "fast";
                html = await fetchFast(url);
            } catch (e) {
                mode = "stealth-failover";
                html = await fetchStealth(url);
            }
        }

        const dom = new JSDOM(html, { url });
        const reader = new Readability(dom.window.document);
        const article = reader.parse();
        const turndown = new TurndownService({ headingStyle: 'atx' });

        // Update usage count in Supabase
        await supabase.rpc('increment_usage', { target_api_key: req.user.api_key });

        res.json({
            success: true,
            data: {
                title: article?.title,
                markdown: article ? turndown.turndown(article.content) : "",
                metadata: { source: url, mode, time_ms: Date.now() - start }
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.listen(process.env.PORT || 3000, () => console.log("GhostScrape API Engine Live"));