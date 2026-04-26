const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const TurndownService = require('turndown');
const axios = require('axios'); // Added for high-speed Wikipedia fetching
require('dotenv').config();

chromium.use(stealth);
const app = express();
const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

// 1. DISTILLER LOGIC (Shared by both fast and slow paths)
function distill(html, url) {
    const doc = new JSDOM(html, { url });
    const article = new Readability(doc.window.document).parse();
    if (!article) return null;
    
    return {
        title: article.title,
        markdown: turndown.turndown(article.content),
        rawLength: html.length
    };
}

// 2. THE HYBRID ENGINE
async function scrapeSmart(url) {
    // --- FAST PATH: For Wikipedia and Static Sites ---
    if (url.includes('wikipedia.org') || url.includes('github.com')) {
        console.log("⚡ Turbo Path: Fetching without Browser");
        const { data: html } = await axios.get(url);
        return distill(html, url);
    }

    // --- STEALTH PATH: For Heavy Sites (TechCrunch/ZDNet) ---
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--single-process'] 
    });
    const page = await browser.newPage();

    try {
        // Block the "Trash" (Images/CSS/Ads)
        await page.route('**/*', (route) => {
            if (['image', 'media', 'font', 'stylesheet'].includes(route.request().resourceType())) {
                return route.abort();
            }
            route.continue();
        });

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        
        // Wait max 5 seconds for main content to appear
        await Promise.race([
            page.waitForSelector('article', { timeout: 5000 }),
            page.waitForSelector('p', { timeout: 5000 })
        ]).catch(() => console.log("Timeout waiting for selector, extracting anyway..."));

        const html = await page.content();
        return distill(html, url);
    } finally {
        await browser.close();
    }
}

// 3. ROUTES
app.get('/scrape', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "No URL provided" });
    try {
        const result = await scrapeSmart(url);
        if (!result) throw new Error("Could not extract content");
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(5000, () => console.log("🚀 Engine Live on Port 5000"));