
console.log("NEW VERSION DEPLOYED");
const axios = require("axios");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const TurndownService = require("turndown");
const { gfm } = require("turndown-plugin-gfm");

// ---------- AXIOS ----------
const client = axios.create({
    timeout: 12000,
    maxContentLength: 5 * 1024 * 1024,
    headers: {
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36",
        "Accept-Encoding": "gzip, deflate, br",
    },
});

// ---------- MARKDOWN ----------
const turndownService = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
}).use(gfm);

// remove junk elements
turndownService.addRule("remove-images", {
    filter: ["img", "picture"],
    replacement: () => "",
});

// keep link text only
turndownService.addRule("remove-links", {
    filter: "a",
    replacement: (content) => content,
});

// cleaner paragraphs
turndownService.addRule("clean-paragraphs", {
    filter: "p",
    replacement: (content) => `\n\n${content.trim()}\n\n`,
});

// ---------- CLEAN DOM ----------
function cleanDocument(doc) {
    const removeSelectors = [
        "script",
        "style",
        "iframe",
        "footer",
        "nav",
        "header",
        "aside",
        "svg",
        ".ads",
        ".advertisement",
        ".promo",
        ".sidebar",
        ".subscribe",
        ".popup",
        ".banner",
        ".cookie",
        ".modal",
    ];

    removeSelectors.forEach((sel) => {
        doc.querySelectorAll(sel).forEach((el) => el.remove());
    });

    return doc;
}

// ---------- HANDLER ----------
module.exports = async (req, res) => {
    let { url } = req.query;

    if (!url) {
        return res.status(400).json({
            success: false,
            error: "URL is required",
        });
    }

    // fix missing protocol
    if (!/^https?:\/\//i.test(url)) {
        url = "https://" + url;
    }

    let dom;

    try {
        // ---------- FETCH ----------
        const response = await client.get(url);

        // ---------- PARSE ----------
        dom = new JSDOM(response.data, { url });
        let doc = dom.window.document;

        doc = cleanDocument(doc);

        // ---------- READABILITY ----------
        const reader = new Readability(doc);
        const article = reader.parse();

        if (!article || !article.content) {
            throw new Error("Could not extract article content");
        }

        // ---------- MARKDOWN ----------
        let markdown = turndownService.turndown(article.content);

        // extra cleanup
        markdown = markdown
            .replace(/\n{3,}/g, "\n\n")
            .replace(/[ \t]+/g, " ")
            .trim();

        // ---------- WORD COUNT ----------
        const wordCount = article.textContent
            .split(/\s+/)
            .filter((w) => w.length > 0).length;

        // ---------- RESPONSE ----------
        return res.status(200).json({
            success: true,
            title: article.title || "Untitled",
            siteName: article.siteName || new URL(url).hostname,
            wordCount,
            markdown,
        });

    } catch (error) {
        console.error("SCRAPE ERROR:", error);

        return res.status(500).json({
            success: false,
            error: error.message || "Unknown error",
        });
    } finally {
        if (dom) dom.window.close();
    }
};