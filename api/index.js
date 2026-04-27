const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { Redis } = require("@upstash/redis");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const TurndownService = require("turndown");
const gfm = require("turndown-plugin-gfm").gfm;
const { HttpProxyAgent } = require('http-proxy-agent');

const app = express();
app.use(cors());
app.use(express.json());

// Upstash Connection
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Proxy setup for residential rotation
const agent = new HttpProxyAgent(`http://${process.env.PROXY_USER}:${process.env.PROXY_PASS}@${process.env.PROXY_URL}`);

// Configure Turndown for "Beautiful" Markdown
const turndownService = new TurndownService({ 
    headingStyle: 'atx', 
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced'
});
turndownService.use(gfm); // Enables GitHub Flavored Markdown (Tables, Tasklists)

// Strip images and links for the "Ultra-Clean" look
turndownService.addRule('no-links', {
    filter: ['a'],
    replacement: (content) => content 
});
turndownService.addRule('no-images', {
    filter: ['img'],
    replacement: () => '' 
});

app.get("/scrape", async (req, res) => {
    const { url } = req.query;
    const apiKey = req.headers['x-api-key'];

    if (!url) return res.status(400).json({ error: "URL is required" });
    if (!apiKey) return res.status(401).json({ error: "API Key required" });

    try {
        // 1. Upstash Credit Check (Atomic)
        const credits = await redis.get(`user:${apiKey}:credits`);
        if (credits === null || parseInt(credits) <= 0) {
            return res.status(402).json({ error: "Insufficient credits. Top up at ghost-scrape.tech" });
        }

        // 2. Fetch Content (Using Residential Proxies)
        const response = await axios.get(url, { 
            httpAgent: agent, 
            httpsAgent: agent,
            timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0' }
        });

        // 3. Beautiful Extraction
        const dom = new JSDOM(response.data, { url });
        
        // Remove known ad selectors before parsing
        const doc = dom.window.document;
        const junk = doc.querySelectorAll('script, style, iframe, footer, nav, .ads, #sidebar');
        junk.forEach(el => el.remove());

        const reader = new Readability(doc);
        const article = reader.parse();

        if (!article) throw new Error("Content is too messy or restricted to parse.");

        const markdown = turndownService.turndown(article.content);

        // 4. Atomic Decrement in Upstash
        await redis.decr(`user:${apiKey}:credits`);

        // 5. Clean Response
        res.json({
            success: true,
            data: {
                title: article.title,
                byline: article.byline,
                siteName: article.siteName,
                markdown: markdown,
                wordCount: article.textContent.split(/\s+/).length
            }
        });

    } catch (error) {
        console.error("Scrape Error:", error.message);
        res.status(500).json({ success: false, error: "Failed to clean content. Site may be protected." });
    }
});

module.exports = app;