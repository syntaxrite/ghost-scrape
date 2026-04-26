const express = require('express');
const cors = require('cors');
// Changed to firefox
const { firefox } = require('playwright-extra'); 
const stealth = require('puppeteer-extra-plugin-stealth')();
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const TurndownService = require('turndown');
const axios = require('axios'); 
require('dotenv').config();

firefox.use(stealth);
const app = express();
app.use(cors());
app.use(express.json());

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
turndown.remove(['script', 'style', 'noscript', 'iframe', 'svg', 'img', 'video', 'footer', 'nav', 'aside']);

function distill(html, url) {
    const doc = new JSDOM(html, { url });
    const article = new Readability(doc.window.document).parse();
    if (!article) return null;
    const md = turndown.turndown(article.content);
    return {
        title: article.title,
        markdown: md,
        stats: {
            raw_chars: html.length,
            distilled_chars: md.length,
            savings: Math.round((1 - (md.length / html.length)) * 100) + "%"
        }
    };
}

async function scrapeSmart(url) {
    // 1. FAST PATH: Wikipedia (Solves the 20-second delay)
    if (url.includes('wikipedia.org')) {
        console.log("⚡ Fast Path: Axios with Browser Identity");
        const { data: html } = await axios.get(url, { 
            timeout: 10000,
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0' 
            }
        });
        return distill(html, url);
    }

    // 2. FIREFOX STEALTH PATH
    const browser = await firefox.launch({ 
        headless: true, 
        args: ['--no-sandbox'] 
    });
    const page = await browser.newPage();

    try {
        await page.route('**/*', (route) => {
            if (['image', 'media', 'font', 'stylesheet'].includes(route.request().resourceType())) {
                return route.abort();
            }
            route.continue();
        });

        // Use 'domcontentloaded' to avoid the 45s timeout seen in your logs
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
        
        // Wait for content or max 5 seconds
        await page.waitForSelector('p', { timeout: 5000 }).catch(() => null);

        const html = await page.content();
        return distill(html, url);
    } finally {
        await browser.close();
    }
}

app.get('/scrape', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "URL is required" });
    try {
        const data = await scrapeSmart(url);
        res.json({ success: true, ...data });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("🚀 Firefox Engine Live"));