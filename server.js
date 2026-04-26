const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const TurndownService = require('turndown');

chromium.use(stealth);
const app = express();

// FIXED CORS: This allows your Vercel app to talk to Render
app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'x-api-key']
}));

app.use(express.json());

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
turndown.remove(['script', 'style', 'noscript', 'iframe', 'svg', 'img', 'video', 'footer', 'nav']);

async function scrapeSmart(url) {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
        const html = await page.content();
        const doc = new JSDOM(html, { url });
        const article = new Readability(doc.window.document).parse();
        if (!article) throw new Error("Content Extraction Failed");

        let markdown = turndown.turndown(article.content);
        return {
            title: article.title,
            markdown: markdown,
            stats: {
                savings: Math.round((1 - (markdown.length / html.length)) * 100) + "%"
            }
        };
    } finally {
        await browser.close();
    }
}

// HEALTH CHECK (Visit your-app.onrender.com to see this)
app.get('/', (req, res) => res.send("✅ Ghost-Scrape Engine is LIVE"));

// THE MAIN ROUTE (Used by your frontend)
app.get('/scrape', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "URL is required" });
    try {
        const data = await scrapeSmart(url);
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(process.env.PORT || 5000);