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

// 2. Global Rate Limiter (Prevents server overload)
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // Limit each IP to 50 requests per window
    message: { error: "Too many requests. Please try again in 15 minutes." }
});

// 3. API Key Middleware (Uses your Supabase logic)
const validateApiKey = async (req, res, next) => {
    const userKey = req.headers['x-api-key'] || req.query.api_key;
    if (!userKey) return res.status(401).json({ error: "API Key required." });
    
    const { data, error } = await supabase.from('users').select('*').eq('api_key', userKey).single();
    if (error || !data) return res.status(403).json({ error: "Invalid API Key." });
    
    req.user = data; 
    next();
};

// 4. SMART ENGINE (Optimized for TechCrunch/BBC/Wikipedia)
const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
turndown.remove(['script', 'style', 'noscript', 'iframe', 'svg', 'img', 'video', 'footer', 'nav']);

async function scrapeSmart(url, maxTokens = 2000) {
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    });
    
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 }
    });
    
    const page = await context.newPage();

    try {
        // --- BANDWIDTH OPTIMIZATION (BLOCKS ADS/TRACKERS) ---
        await page.route('**/*', (route) => {
            const type = route.request().resourceType();
            // Blocking these makes heavy sites like TechCrunch load 5x faster
            if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
                return route.abort();
            }
            route.continue();
        });

        // --- FAST FAIL NAVIGATION ---
        // Wait for 'domcontentloaded' instead of 'networkidle' to bypass infinite ads
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        // Final "Wait for content" check
        // --- REPLACE THIS ---
// await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });

// --- WITH THIS ---
try {
    // 1. Only wait for the main HTML structure (instant)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    
    // 2. Race: Wait for the main article text to appear OR wait max 5 seconds
    // This stops the "Network Busy" loop entirely
    await Promise.race([
        page.waitForSelector('article', { timeout: 5000 }),
        page.waitForSelector('main', { timeout: 5000 }),
        page.waitForTimeout(5000) 
    ]);
} catch (e) {
    console.log("Navigation timeout hit, but proceeding with captured HTML...");
} 

        const html = await page.content();
        const doc = new JSDOM(html, { url });
        const article = new Readability(doc.window.document).parse();

        if (!article) throw new Error("Ghost Engine couldn't extract the main text.");

        let markdown = turndown.turndown(article.content);
        
        // TOKEN BUDGETING (Safety for your LLM context)
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
    } finally {
        await browser.close();
    }
}

// 5. Routes
app.get('/', (req, res) => res.send("✅ Ghost-Scrape Engine v2.0 is LIVE"));

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

// New /v1/scrape protected route
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
app.listen(PORT, () => console.log(`🚀 Engine running on port ${PORT}`));