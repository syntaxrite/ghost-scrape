const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const TurndownService = require('turndown');
const { createClient } = require('@supabase/supabase-js');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

chromium.use(stealth);
const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(cors());
app.use(express.json());

const globalLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 100,
    message: { error: "Cool down! Too many requests." }
});

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
turndown.remove(['script', 'style', 'noscript', 'iframe', 'svg', 'img', 'video', 'footer', 'nav', 'aside', 'header']);

async function scrapeSmart(url, maxTokens = 2000) {
    // 1. Better & Smarter: Use --single-process to save RAM on Render
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process'] 
    });
    
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });
    
    const page = await context.newPage();

    try {
        // 2. AGGRESSIVE BLOCKING (Faster): Kill ads, trackers, and styles before they load
        await page.route('**/*', (route) => {
            const type = route.request().resourceType();
            const requestUrl = route.request().url();
            
            if (['image', 'media', 'font', 'stylesheet', 'other'].includes(type) || 
                requestUrl.includes('google-analytics') || 
                requestUrl.includes('doubleclick') ||
                requestUrl.includes('facebook')) {
                return route.abort();
            }
            route.continue();
        });

        // 3. THE 10-SECOND RULE (Smarter): Most text is ready in < 5 seconds
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            
            // Wait specifically for text-heavy containers, then STOP
            await Promise.race([
                page.waitForSelector('article', { timeout: 5000 }),
                page.waitForSelector('main', { timeout: 5000 }),
                page.waitForSelector('p', { timeout: 5000 })
            ]);
        } catch (e) {
            console.log("Quick-capture triggered (Fast extraction)");
        }

        const html = await page.content();
        const doc = new JSDOM(html, { url });
        const article = new Readability(doc.window.document).parse();

        if (!article) throw new Error("Ghost Engine failed to find the detail.");

        let markdown = turndown.turndown(article.content);
        
        // Final Smart Filter: Truncate for LLM window
        const charLimit = maxTokens * 4; 
        if (markdown.length > charLimit) {
            markdown = markdown.substring(0, charLimit) + "\n\n... [Truncated]";
        }

        return {
            title: article.title,
            markdown: markdown,
            stats: {
                raw_chars: html.length,
                distilled_chars: markdown.length,
                savings: Math.round((1 - (markdown.length / html.length)) * 100) + "%"
            }
        };
    } finally {
        await browser.close();
    }
}

// Routes
app.get('/scrape', globalLimiter, async (req, res) => {
    const { url, tokens = 2000 } = req.query;
    if (!url) return res.status(400).json({ error: "URL is required" });
    try {
        const data = await scrapeSmart(url, parseInt(tokens));
        res.json({ success: true, ...data });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/', (req, res) => res.send("✅ Ghost-Scrape Ultra-Fast Engine is LIVE"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Fast Engine running on ${PORT}`));