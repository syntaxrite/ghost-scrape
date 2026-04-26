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

// 1. Setup & Plugins
chromium.use(stealth);
const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(cors());
app.use(express.json());

// 2. Global Rate Limiter
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 50, 
    message: { error: "Too many requests. Please try again in 15 minutes." }
});

// 3. API Key Middleware
const validateApiKey = async (req, res, next) => {
    const userKey = req.headers['x-api-key'] || req.query.api_key;
    if (!userKey) return res.status(401).json({ error: "API Key required." });
    
    const { data, error } = await supabase.from('users').select('*').eq('api_key', userKey).single();
    if (error || !data) return res.status(403).json({ error: "Invalid API Key." });
    
    req.user = data; 
    next();
};

// 4. THE SMART ENGINE
const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
// Explicitly strip non-content elements to focus on the detail
turndown.remove(['script', 'style', 'noscript', 'iframe', 'svg', 'img', 'video', 'footer', 'nav', 'aside']);

async function scrapeSmart(url, maxTokens = 2000) {
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        // 1. BLOCK THE TRASH (The most important speed fix)
        await page.route('**/*', (route) => {
            const type = route.request().resourceType();
            // Block images, css, and fonts - you only need the HTML text!
            if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
                return route.abort();
            }
            route.continue();
        });

        // 2. DOM-ONLY LOADING
        // We use 'domcontentloaded' because it finishes in < 2 seconds
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        
        // 3. TARGETED WAIT
        // Wait specifically for the text content, then stop immediately
        await page.waitForSelector('body', { timeout: 5000 });

        const html = await page.content();
        const doc = new JSDOM(html, { url });
        const article = new Readability(doc.window.document).parse();

        if (!article) throw new Error("Ghost Engine couldn't find the main detail.");

        let markdown = turndown.turndown(article.content);
        
        // Truncate if too long for LLM context
        if (markdown.length > maxTokens * 4) {
            markdown = markdown.substring(0, maxTokens * 4) + "... [Truncated]";
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

// 5. Routes
app.get('/', (req, res) => res.send("✅ Ghost-Scrape Smart Engine is LIVE"));

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

app.get('/v1/scrape', validateApiKey, globalLimiter, async (req, res) => {
    const { url } = req.query;
    try {
        const data = await scrapeSmart(url);
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Smart Engine running on port ${PORT}`));