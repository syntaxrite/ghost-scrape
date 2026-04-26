require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { firefox } = require('playwright-extra'); 
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const TurndownService = require('turndown');
const rateLimit = require('express-rate-limit');

const app = express();
firefox.use(StealthPlugin());

// Rate limit to stay under the radar
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use(cors());
app.use(express.json());
app.use('/scrape', limiter);

let browserInstance = null;

async function getBrowser() {
    if (!browserInstance) {
        browserInstance = await firefox.launch({ 
            headless: true,
            args: ['--disable-dev-shm-usage', '--no-sandbox'] 
        });
    }
    return browserInstance;
}

// Tier 1: Fast Static Fetch
async function fastFetch(url) {
    try {
        const { data: html } = await axios.get(url, { 
            timeout: 5000, 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            } 
        });
        const dom = new JSDOM(html, { url });
        const article = new Readability(dom.window.document).parse();
        return (article && article.textContent.length > 500) ? article : null;
    } catch (e) { return null; }
}

app.get('/scrape', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: 'URL is required' });

    try {
        let article = await fastFetch(targetUrl);
        let method = "Tier 1 (Lightning)";

        if (!article) {
            method = "Tier 2 (Firefox Ghost)";
            const browser = await getBrowser();
            const context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
                extraHTTPHeaders: { 'Referer': 'https://www.google.com/' },
                viewport: { width: 1280, height: 720 }
            });

            const page = await context.newPage();

            // Block heavy assets for speed
            await page.route('**/*', (route) => {
                const type = route.request().resourceType();
                if (['image', 'font', 'media', 'stylesheet'].includes(type)) return route.abort();
                route.continue();
            });

            try {
                // Wait for the actual content to hit the DOM
                await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await page.waitForSelector('p, article', { timeout: 12000 });
                
                const html = await page.content();
                const dom = new JSDOM(html, { url: targetUrl });
                article = new Readability(dom.window.document).parse();
            } finally {
                await context.close();
            }
        }

        if (!article) throw new Error("Content extraction failed or site blocked the request.");

        // Convert to Markdown
        const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
        
        // Fix relative image paths
        turndownService.addRule('absoluteImages', {
            filter: 'img',
            replacement: (content, node) => {
                let src = node.getAttribute('src');
                if (!src) return '';
                try { src = new URL(src, targetUrl).href; } catch(e){}
                return `![${node.getAttribute('alt') || 'image'}](${src})`;
            }
        });

        const markdown = turndownService.turndown(article.content || '');
        const wordCount = article.textContent.split(/\s+/).length;
        const savings = Math.round((1 - markdown.length / (article.content.length || 1)) * 100);

        // RESPONSE TAILORED FOR YOUR page.tsx
        return res.json({
            title: article.title || 'Untitled Article',
            method: `${method} • ${Math.ceil(wordCount / 225)} min read`,
            stats: { 
                savings: `${savings}% tokens saved`,
                wordCount: `${wordCount} words`
            },
            markdown: { content: markdown }
        });

    } catch (err) {
        console.error("Scrape Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Ghost Engine V3.2 Active on Port ${PORT}`));