const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const TurndownService = require("turndown");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const dns = require("dns").promises;

require("dotenv").config();

const app = express();

/* ---------------- SECURITY ---------------- */
app.use(helmet());
app.use(cors({ origin: "*" }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 30 }));

/* ---------------- CACHE ---------------- */
const cache = new Map();
const CACHE_TTL = 1000 * 60 * 30; // 30 min

/* ---------------- TURNDOWN CONFIG ---------------- */
// Initialize once outside to be efficient
const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    hr: "---"
});

/* ---------------- HELPERS ---------------- */
async function validateUrl(input) {
    try {
        const parsed = new URL(input);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only HTTP/HTTPS allowed");
        
        const hostname = parsed.hostname.toLowerCase();
        if (["localhost", "127.0.0.1", "0.0.0.0"].includes(hostname)) throw new Error("Blocked host");

        const { address } = await dns.lookup(hostname);
        if (address.startsWith("10.") || address.startsWith("192.168.") || address.startsWith("172.")) {
            throw new Error("Private network blocked");
        }
        return parsed.toString();
    } catch (e) {
        throw new Error(e.message || "Invalid URL");
    }
}

/* ---------------- DISTILL ENGINE ---------------- */
function distill(html, url) {
    const rawChars = html.length;
    const dom = new JSDOM(html, { url });
    const doc = dom.window.document;

    // Use Readability first to find the "meat" of the page
    const reader = new Readability(doc);
    const article = reader.parse();

    let title = "Untitled";
    let markdown = "";
    let mode = "fallback";

    if (article && article.content) {
        title = article.title;
        markdown = turndown.turndown(article.content);
        mode = "readability";
    } else {
        // Fallback: Just grab body text if Readability fails
        title = doc.title || "Untitled";
        markdown = doc.body?.textContent?.slice(0, 20000) || "";
    }

    return {
        title,
        markdown,
        mode,
        stats: {
            raw_chars: rawChars,
            distilled_chars: markdown.length
        }
    };
}

/* ---------------- ROUTES ---------------- */
app.get("/", (req, res) => res.send("👻 GhostScrape API active"));

app.get("/scrape", async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) return res.status(400).json({ success: false, error: "Missing URL" });

        const safeUrl = await validateUrl(url);

        // Cache Check
        if (cache.has(safeUrl)) {
            const cached = cache.get(safeUrl);
            if (Date.now() - cached.time < CACHE_TTL) {
                return res.json({ success: true, ...cached.data, cached: true });
            }
        }

        const start = Date.now();
        
        // Fetch
        const response = await axios.get(safeUrl, {
            headers: { "User-Agent": "Mozilla/5.0 GhostScrape/1.0" },
            timeout: 15000
        });

        // Distill
        const result = distill(response.data, safeUrl);
        const processingTime = Date.now() - start;

        const finalResponse = {
            success: true,
            time_ms: processingTime,
            ...result
        };

        // Save to cache
        cache.set(safeUrl, { data: finalResponse, time: Date.now() });

        res.json(finalResponse);

    } catch (err) {
        console.error("Scrape Error:", err.message);
        res.status(500).json({
            success: false,
            error: err.message || "Failed to process page"
        });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));