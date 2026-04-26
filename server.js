const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const TurndownService = require('turndown');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios'); // Add axios for the "Fast Path"
require('dotenv').config();

chromium.use(stealth);
const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(cors());
app.use(express.json());

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
turndown.remove(['script', 'style', 'noscript', 'iframe', 'svg', 'img', 'video', 'footer', 'nav', 'aside']);

// Helper to distill HTML (Shared logic)
function distill(html, url, maxTokens) {
    const doc = new JSDOM(html, { url });
    const article = new Readability(doc.window.document).parse();
    if (!article) return null;

    let markdown = turndown.turndown(article.content);
    const charLimit = maxTokens * 4;
    if (markdown.length > charLimit) {
        markdown = markdown.substring(0, charLimit) + "\n\n... [Content Truncated]";
    }

    return {
        title: article.title,
        author: article.byline,
        markdown: markdown,
        stats: {
            raw_chars: html.length,
            distilled_chars: markdown.length,
            savings: Math.round((1 - (markdown.length / html.length)) * 100) + "%"
        }
    };
}

async function scrapeSmart(url, maxTokens = 2000) {
    // 1. LIGHTNING FAST PATH (Wikipedia, GitHub, etc.)
    if (url.includes('wikipedia.org') || url.includes('github.com')) {
        console.log("⚡ Fast Path: Using Axios for " + url);
        try {
            const { data: html } = await axios.get(url, { timeout: 10000 });
            return distill(html, url, maxTokens);
        } catch (e) {
            console.log("Fast path failed, falling back to browser...");
        }
    }

    // 2. TURBO BROWSER PATH (TechCrunch, BBC, ZDNet)
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process'] 
    });
    const page = await browser.newPage();

    try {
        // Block all "trash" resources immediately
        await page.route('**/*', (route) => {
            if (['image', 'media', 'font', 'stylesheet'].includes(route.request().resourceType())) {
                return route.abort();
            }
            route.continue();
        });

        // ONE single navigation with a short timeout
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

        // Race: Stop as soon as content is found OR 5 seconds pass
        await Promise.race([
            page.waitForSelector('article', { timeout: 5000 }),
            page.waitForSelector('main', { timeout: 5000 }),
            page.waitForTimeout(5000)
        ]);

        const html = await page.content();
        return distill(html, url, maxTokens);
    } finally {
        await browser.close();
    }
}

// Routes
app.get('/scrape', async (req, res) => {
    const { url, tokens = 2000 } = req.query;
    if (!url) return res.status(400).json({ error: "URL is required" });
    try {
        const data = await scrapeSmart(url, parseInt(tokens));
        res.json({ success: true, ...data });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/', (req, res) => res.send("✅ Ghost-Scrape Hybrid Engine is LIVE"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Engine running on port ${PORT}`));