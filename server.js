const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const TurndownService = require('turndown');
const rateLimit = require('express-rate-limit');

require('dotenv').config();

const app = express();
app.use(cors());

// 🚧 RATE LIMIT
app.use(rateLimit({
    windowMs: 60 * 1000,
    max: 30
}));

// 🧠 CACHE
const cache = new Map();
const CACHE_TTL = 1000 * 60 * 30;

// 🎭 USER AGENTS (basic anti-bot)
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/119 Safari/537.36'
];

function getHeaders() {
    return {
        'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
    };
}

// 🧹 CLEAN DOM
function cleanDom(document) {
    const selectors = [
        'script','style','noscript','iframe',
        'header','footer','nav','aside',
        '[class*="ad"]','[id*="ad"]',
        '.sidebar','.popup','.banner'
    ];

    selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => el.remove());
    });
}

// 🖼️ SIMPLIFY MEDIA
function simplifyMedia(document) {
    document.querySelectorAll('img').forEach(img => {
        const src = img.src || '';
        img.replaceWith(`![image](${src})`);
    });

    document.querySelectorAll('video').forEach(() => {
        const txt = document.createTextNode('[Video removed]');
        document.body.appendChild(txt);
    });
}

// 🧠 FORMAT MARKDOWN
function formatMarkdown(text) {
    text = text.replace(/\s+/g, ' ').trim();

    let sentences = text.split(/(?<=\.)\s+/);
    let result = [];
    let block = "";

    for (let s of sentences) {

        if (
            s.includes("Features of") ||
            s.includes("Working of") ||
            s.includes("Components of") ||
            s.includes("Use Cases") ||
            s.includes("Hello, World")
        ) {
            if (block) {
                result.push(block.trim());
                block = "";
            }
            result.push(`\n## ${s.trim()}\n`);
            continue;
        }

        if (s.includes(":") && s.length < 120) {
            result.push(`- ${s.trim()}`);
            continue;
        }

        block += s + " ";

        if (block.length > 300) {
            result.push(block.trim());
            block = "";
        }
    }

    if (block) result.push(block.trim());

    let final = result.join("\n\n");

    final = final.replace(/const .*?;/g, m => `\n\`\`\`js\n${m}\n\`\`\`\n`);

    return final.trim();
}

// 📄 MARKDOWN ENGINE
const turndown = new TurndownService();
turndown.remove(['script','style','iframe','svg']);

// 🎯 DISTILL
function distill(html, url) {

    const dom = new JSDOM(html, { url });
    const originalDoc = dom.window.document;

    if (!originalDoc || !originalDoc.body) {
        throw new Error("Invalid DOM");
    }

    // clone safely
    const cloned = new JSDOM(originalDoc.documentElement.outerHTML, { url });
    const doc = cloned.window.document;

    cleanDom(doc);
    simplifyMedia(doc);

    // 🔥 GFG special
    if (url.includes('geeksforgeeks.org')) {
        const main = doc.querySelector('.text');
        if (main && main.textContent.length > 200) {
            const md = turndown.turndown(main.innerHTML);
            return {
                title: doc.title,
                markdown: formatMarkdown(md),
                mode: "gfg",
                stats: {
                    raw_chars: html.length,
                    distilled_chars: md.length
                }
            };
        }
    }

    // 🧠 Readability
    let article;
    try {
        article = new Readability(doc).parse();
    } catch (e) {
        console.error("Readability error:", e.message);
    }

    if (article && article.textContent && article.textContent.length > 300) {
        const md = turndown.turndown(article.content);

        return {
            title: article.title,
            markdown: formatMarkdown(md),
            mode: "readability",
            stats: {
                raw_chars: html.length,
                distilled_chars: md.length
            }
        };
    }

    // 💀 fallback
    let text = originalDoc.body.textContent
        .replace(/\.\s+/g, '.\n\n')
        .slice(0, 20000);

    return {
        title: originalDoc.title || "Untitled",
        markdown: formatMarkdown(text),
        mode: "fallback",
        stats: {
            raw_chars: html.length,
            distilled_chars: text.length
        }
    };
}

// ⚡ FETCH
async function fetchPage(url) {
    const { data } = await axios.get(url, {
        timeout: 15000,
        headers: getHeaders()
    });
    return data;
}

// 🎯 SCRAPE
async function scrape(url) {

    const cached = cache.get(url);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
        return { ...cached.data, cached: true };
    }

    const html = await fetchPage(url);
    const result = distill(html, url);

    cache.set(url, {
        data: result,
        time: Date.now()
    });

    return result;
}

// 🌐 ROUTES
app.get('/', (req, res) => {
    res.send("👻 GhostScrape API alive");
});

app.get('/scrape', async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ success: false, error: "Missing URL" });
    }

    try {
        const start = Date.now();
        const data = await scrape(url);

        res.json({
            success: true,
            time_ms: Date.now() - start,
            ...data
        });

    } catch (e) {
        console.error("SCRAPE ERROR:", e.message);

        res.status(500).json({
            success: false,
            error: e.message
        });
    }
});

// 🚀 START
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 GhostScrape running on ${PORT}`);
});