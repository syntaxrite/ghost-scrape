const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const TurndownService = require("turndown");
const gfm = require("turndown-plugin-gfm").gfm;
const { HttpProxyAgent } = require('http-proxy-agent');

const app = express();
app.use(cors());
app.use(express.json());

// Optimized Proxy Agent
const proxyUrl = `http://${process.env.PROXY_USER}:${process.env.PROXY_PASS}@${process.env.PROXY_URL}`;
const agent = new HttpProxyAgent(proxyUrl, {
    keepAlive: true, // Smoother: Keeps connection open for faster subsequent requests
    timeout: 10000
});

const turndownService = new TurndownService({ 
    headingStyle: 'atx', 
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced'
}).use(gfm);

// Rule: Keep content, strip formatting that clutters AI context
turndownService.addRule('no-links', { filter: ['a'], replacement: (c) => c });
turndownService.addRule('no-images', { filter: ['img'], replacement: () => '' });

app.get("/scrape", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "URL required" });

    try {
        // 1. Optimized Fetch: Only wait 10s max for the initial byte
        const response = await axios.get(url, { 
            httpAgent: agent, 
            httpsAgent: agent,
            timeout: 10000, 
            maxContentLength: 5 * 1024 * 1024, // 5MB Limit to prevent memory crashes
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                'Accept-Encoding': 'gzip, deflate, br' // Smoother: Ask for compressed data
            }
        });

        // 2. High-Speed Parsing
        const dom = new JSDOM(response.data, { url, runScripts: "dangerously" === false });
        const doc = dom.window.document;

        // Strip junk immediately to reduce Readability workload
        const junk = doc.querySelectorAll('script, style, iframe, footer, nav, header, aside, .ads, .sidebar, svg');
        for (let i = 0; i < junk.length; i++) junk[i].remove();

        const reader = new Readability(doc);
        const article = reader.parse();

        if (!article) throw new Error("Content extraction failed");

        const markdown = turndownService.turndown(article.content);

        // 3. Clear memory before responding
        dom.window.close(); 

        res.json({
            success: true,
            title: article.title,
            siteName: article.siteName,
            wordCount: article.textContent.split(/\s+/).length,
            markdown: markdown
        });

    } catch (error) {
        console.error("Engine Error:", error.message);
        res.status(500).json({ 
            success: false, 
            error: error.code === 'ECONNABORTED' ? "Target site timed out" : error.message 
        });
    }
});

module.exports = app;