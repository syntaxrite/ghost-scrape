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

// Proxy setup for rotation (Uses your .env variables)
const proxyUrl = `http://${process.env.PROXY_USER}:${process.env.PROXY_PASS}@${process.env.PROXY_URL}`;
const agent = new HttpProxyAgent(proxyUrl);

// Configure Turndown for High-End Output
const turndownService = new TurndownService({ 
    headingStyle: 'atx', 
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced'
});

// Enable GitHub Flavored Markdown (for tables)
turndownService.use(gfm); 

// SUPERIOR CLEANING RULES: Remove links and images to keep it pure text for AI
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

    if (!url) return res.status(400).json({ error: "URL is required" });

    try {
        console.log(`Cleaning: ${url}`);

        // 1. Fetch HTML using Axios + Residential Proxy
        const response = await axios.get(url, { 
            httpAgent: agent, 
            httpsAgent: agent,
            timeout: 15000,
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0',
                'Accept': 'text/html,application/xhtml+xml,xml;q=0.9,image/webp,*/*;q=0.8'
            }
        });

        // 2. Load into JSDOM
        const dom = new JSDOM(response.data, { url });
        const doc = dom.window.document;

        // 3. AGGRESSIVE JUNK REMOVAL: Strip ads and nav before the parser even looks at it
        const junkSelectors = 'script, style, iframe, footer, nav, header, aside, .ads, .sidebar, #comments, .menu';
        doc.querySelectorAll(junkSelectors).forEach(el => el.remove());

        // 4. BEAUTIFUL EXTRACTION: Use Mozilla's Readability to find the "Main Story"
        const reader = new Readability(doc);
        const article = reader.parse();

        if (!article) {
            throw new Error("This page is too messy to clean. Try a different URL.");
        }

        // 5. CONVERT TO MARKDOWN
        const markdown = turndownService.turndown(article.content);

        // 6. RESPOND
        res.json({
            success: true,
            title: article.title,
            siteName: article.siteName,
            wordCount: article.textContent.split(/\s+/).length,
            markdown: markdown
        });

    } catch (error) {
        console.error("Clean Error:", error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            tip: "This tool is optimized for Articles, Blogs, and Wikis. It will not work on Social Media."
        });
    }
});

module.exports = app;