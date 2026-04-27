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

// Proxy: Keep-alive for speed
const proxyUrl = `http://${process.env.PROXY_USER}:${process.env.PROXY_PASS}@${process.env.PROXY_URL}`;
const agent = new HttpProxyAgent(proxyUrl, { keepAlive: true, timeout: 10000 });

// Markdown: Optimized for AI
const turndownService = new TurndownService({ 
    headingStyle: 'atx', 
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced'
}).use(gfm);

turndownService.addRule('no-links', { filter: ['a'], replacement: (c) => c });
turndownService.addRule('no-images', { filter: ['img'], replacement: () => '' });

app.get("/scrape", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "URL required" });

    let dom; // Declare outside so finally block can see it

    try {
        // 1. Corrected Axios Fetch
        const response = await axios.get(url, { 
            httpAgent: agent, 
            httpsAgent: agent,
            timeout: 12000, 
            maxContentLength: 5242880,
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/123.0.0.0',
                'Accept-Encoding': 'gzip, deflate, br'
            }
        });

        // 2. Parse DOM
        dom = new JSDOM(response.data, { url });
        const doc = dom.window.document;

        // Strip junk
        const junk = doc.querySelectorAll('script, style, iframe, footer, nav, header, aside, .ads, .sidebar, svg');
        for (let i = 0; i < junk.length; i++) {
            junk[i].remove();
        }

        // 3. Extraction
        const reader = new Readability(doc);
        const article = reader.parse();

        if (!article) throw new Error("Could not extract clean content.");

        const markdown = turndownService.turndown(article.content);

        res.json({
            success: true,
            title: article.title,
            siteName: article.siteName || "Source",
            wordCount: article.textContent.split(/\s+/).filter(n => n.length > 0).length,
            markdown: markdown
        });

    } catch (error) {
        console.error("Scrape Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (dom) {
            dom.window.close();
            dom = null;
        }
    }
});

module.exports = app;