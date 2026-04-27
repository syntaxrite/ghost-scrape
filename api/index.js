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

// SUPERIOR PROXY CONFIG: Keep-alive reduces handshake time by 50%
const proxyUrl = `http://${process.env.PROXY_USER}:${process.env.PROXY_PASS}@${process.env.PROXY_URL}`;
const agent = new HttpProxyAgent(proxyUrl, {
    keepAlive: true, 
    timeout: 10000
});

// SUPERIOR MARKDOWN CONFIG: Cleanest possible output for LLMs
const turndownService = new TurndownService({ 
    headingStyle: 'atx', 
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*' 
}).use(gfm);

// Remove links/images but preserve the text content for the AI to "read"
turndownService.addRule('no-links', { filter: ['a'], replacement: (c) => c });
turndownService.addRule('no-images', { filter: ['img'], replacement: () => '' });

app.get("/scrape", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "URL required" });

    let dom; // Defined outside to ensure closure in finally block

    try {
        // 1. OPTIMIZED FETCH
        const response = await axios.get(url, { 
            httpAgent: agent, 
            httpsAgent: agent,
            timeout: 10000, 
            maxContentLength: 5 * 1024 * 1024, // 5MB Limit
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0',
                'Accept': 'text/html,application/xhtml+xml,xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br' 
            }
        });

        // 2. HIGH-SPEED PARSING
        dom = new JSDOM(response.data, { url, runScripts: "dangerously" === false });
        const doc = dom.window.document;

        // Strip junk before Readability starts (saves CPU cycles)
        const junk = doc.querySelectorAll('script, style, iframe, footer, nav, header, aside, .ads, .sidebar, svg, noscript');
        for (let i = 0; i < junk.length; i++) junk[i].remove();

        const reader = new Readability(doc);
        const article = reader.parse();

        if (!article) throw new Error("Could not extract main content.");

        // 3. CLEAN MARKDOWN CONVERSION
        const markdown = turndownService.turndown(article.content);

        res.json({
            success: true,
            title: article.title,
            siteName: article.siteName,
            wordCount: article.textContent.split(/\s+/).filter(w => w.length > 0).length,
            markdown: markdown
        });

    } catch (error) {
        console.error("Scrape Error:", error.message);
        res.status(500).json({ 
            success: false, 
            error: error.code === 'ECONNABORTED' ? "Target site timed out" : error.message 
        });
    } finally {
        // CRITICAL: Clean up memory immediately
        if (dom) dom.window.close();
    }
});

module.exports = app;