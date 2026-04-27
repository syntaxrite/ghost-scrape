const axios = require("axios");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const TurndownService = require("turndown");
const { gfm } = require("turndown-plugin-gfm");
const { HttpProxyAgent } = require("http-proxy-agent");

// ---------- PROXY SETUP (SAFE) ----------
let agent = null;

if (process.env.PROXY_URL) {
    const proxyUrl = `http://${process.env.PROXY_USER}:${process.env.PROXY_PASS}@${process.env.PROXY_URL}`;
    agent = new HttpProxyAgent(proxyUrl, {
        keepAlive: true,
        timeout: 10000,
    });
}

// ---------- AXIOS INSTANCE ----------
const client = axios.create({
    timeout: 12000,
    maxContentLength: 5 * 1024 * 1024,
    headers: {
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36",
        "Accept-Encoding": "gzip, deflate, br",
    },
});

// ---------- TURNDOWN SETUP ----------
const turndownService = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
})
    .use(gfm);

// Remove junk elements
turndownService.addRule("remove-images", {
    filter: ["img", "picture"],
    replacement: () => "",
});

turndownService.addRule("remove-links", {
    filter: "a",
    replacement: (content) => content, // keep text only
});

// Clean excessive whitespace
turndownService.addRule("clean-whitespace", {
    filter: ["p"],
    replacement: (content) => `\n\n${content.trim()}\n\n`,
});

// ---------- CLEANING FUNCTION ----------
function cleanDocument(doc) {
    const selectors = [
        "script",
        "style",
        "iframe",
        "footer",
        "nav",
        "header",
        "aside",
        ".ads",
        ".advertisement",
        ".promo",
        ".sidebar",
        ".subscribe",
        ".popup",
        ".banner",
        ".cookie",
        ".modal",
        "svg",
    ];

    selectors.forEach((sel) => {
        doc.querySelectorAll(sel).forEach((el) => el.remove());
    });

    return doc;
}

// ---------- MAIN HANDLER ----------
module.exports = async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({
            success: false,
            error: "URL is required",
        });
    }

    let dom;

    try {
        // ---------- FETCH (WITH PROXY + FALLBACK) ----------
        let response;

        try {
            response = await client.get(url, {
                httpAgent: agent,
                httpsAgent: agent,
            });
        } catch (proxyError) {
            console.warn("Proxy failed, retrying without proxy...");
            response = await client.get(url);
        }

        // ---------- PARSE ----------
        dom = new JSDOM(response.data, { url });
        let doc = dom.window.document;

        doc = cleanDocument(doc);

        // ---------- READABILITY ----------
        const reader = new Readability(doc);
        const article = reader.parse();

        if (!article || !article.content) {
            throw new Error("Failed to extract readable content");
        }

        // ---------- MARKDOWN ----------
        let markdown = turndownService.turndown(article.content);

        // Extra cleanup
        markdown = markdown
            .replace(/\n{3,}/g, "\n\n")
            .replace(/[ \t]+/g, " ")
            .trim();

        // ---------- WORD COUNT ----------
        const wordCount = article.textContent
            .split(/\s+/)
            .filter((w) => w.length > 0).length;

        // ---------- RESPONSE ----------
        res.status(200).json({
            success: true,
            title: article.title || "Untitled",
            siteName: article.siteName || new URL(url).hostname,
            wordCount,
            markdown,
        });
    } catch (error) {
        console.error("SCRAPE ERROR:", error.message);

        res.status(500).json({
            success: false,
            error: error.message,
        });
    } finally {
        if (dom) {
            dom.window.close();
        }
    }
};