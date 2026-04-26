const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const TurndownService = require('turndown');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const validateApiKey = async (req, res, next) => {
    const userKey = req.headers['x-api-key'];
    if (!userKey) return res.status(401).json({ error: "API Key required. Get one at ghost-scrape.vercel.app" });
    
    // Check Supabase if this key is valid
    const { data, error } = await supabase.from('users').select('*').eq('api_key', userKey).single();
    if (error || !data) return res.status(403).json({ error: "Invalid API Key" });
    
    req.user = data; // Attach user info for logging
    next();
};
chromium.use(stealth);
const app = express();
app.use(cors());
app.use(express.json());

app.get('/v1/scrape', validateApiKey, async (req, res) => {
    const { url } = req.query;
    
    try {
        const result = await scrapeGhost(url);
        
        // LOG USAGE: This is how you prove value to users
        const tokensSaved = Math.round(result.content.length / 2); // Simplified savings math
        await supabase.from('usage_logs').insert({ 
            user_id: req.user.id, 
            url, 
            tokens_saved: tokensSaved 
        });

        res.json({
            status: "success",
            data: {
                title: result.title,
                markdown: result.content,
                metadata: { source: url, method: result.method },
                usage: { tokens_estimated: Math.round(result.content.length / 4) }
            }
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
});

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

// AGGRESSIVELY remove token-wasters
turndown.remove(['script', 'style', 'noscript', 'iframe', 'svg', 'img', 'video', 'footer', 'nav']);

async function scrapeSmart(url, maxTokens = 2000) {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    
    try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });

        // CLEANUP: Kill the "Clumsy HTML" before it even reaches the parser
        await page.evaluate(() => {
            const junk = ['.ad', '.promo', 'header', 'footer', 'nav', '.sidebar', 'aside', '.popup'];
            junk.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));
        });

        const html = await page.content();
        const doc = new JSDOM(html, { url });
        const reader = new Readability(doc.window.document);
        const article = reader.parse();

        if (!article) throw new Error("Content Extraction Failed");

        let markdown = turndown.turndown(article.content);
        
        // TOKEN BUDGETING: Don't let the agent overspend
        const charLimit = maxTokens * 4; // Rough estimate: 4 chars per token
        if (markdown.length > charLimit) {
            markdown = markdown.substring(0, charLimit) + "... [Truncated for Token Savings]";
        }

        return {
            title: article.title,
            markdown: markdown,
            stats: {
                raw_chars: html.length,
                distilled_chars: markdown.length,
                savings_pct: Math.round((1 - (markdown.length / html.length)) * 100)
            }
        };
    } finally {
        await browser.close();
    }
}

app.get('/scrape', async (req, res) => {
    const { url, tokens = 2000 } = req.query;
    if (!url) return res.status(400).json({ error: "Missing URL" });

    try {
        const data = await scrapeSmart(url, tokens);
        res.json({ success: true, ...data });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/', (req, res) => {
    res.send('✅ Ghost-Scrape Engine is Online. Send requests to /scrape?url=...');
});

app.listen(process.env.PORT || 5000);