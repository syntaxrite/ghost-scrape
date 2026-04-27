const axios = require("axios");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const TurndownService = require("turndown");
const { gfm } = require("turndown-plugin-gfm");

// ---------- CONFIG ----------
const BROWSERLESS_URL = process.env.BROWSERLESS_URL; 
// example: https://chrome.browserless.io/content?token=YOUR_TOKEN

// ---------- AXIOS ----------
const client = axios.create({
    timeout: 12000,
    maxContentLength: 5 * 1024 * 1024,
    headers: {
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36",
    },
});

// ---------- MARKDOWN ----------
const turndownService = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
}).use(gfm);

turndownService.addRule("remove-images", {
    filter: ["img", "picture"],
    replacement: () => "",
});

turndownService.addRule("remove-links", {
    filter: "a",
    replacement: (content) => content,
});

// ---------- SITE DETECTION ----------
function getSiteType(domain) {
    if (domain.includes("medium.com")) return "medium";
    if (domain.includes("bbc.com")) return "bbc";
    if (domain.includes("wikipedia.org")) return "wiki";
    return "generic";
}

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
        ".sidebar",
        ".promo",
        ".popup",
        ".banner",
    ];

    removeSelectors.forEach((sel) => {
        doc.querySelectorAll(sel).forEach((el) => el.remove());
    });

    return doc;
}

// ---------- MEDIUM ----------
function extractMedium(doc) {
    const title = doc.querySelector("h1")?.innerText || "Untitled";

    const paragraphs = doc.querySelectorAll("article p");
    let content = "";

    paragraphs.forEach(p => {
        content += `<p>${p.innerHTML}</p>`;
    });

    return { title, content };
}

// ---------- BBC ----------
function extractBBC(doc) {
    const title = doc.querySelector("h1")?.innerText || "Untitled";

    const paragraphs = doc.querySelectorAll('[data-component="text-block"] p');
    let content = "";

    paragraphs.forEach(p => {
        content += `<p>${p.innerHTML}</p>`;
    });

    return { title, content };
}

// ---------- WIKIPEDIA ----------
function cleanWikipedia(doc) {
    doc.querySelectorAll(".reference").forEach(el => el.remove());
    doc.querySelectorAll(".mw-editsection").forEach(el => el.remove());
    return doc;
}

// ---------- BROWSERLESS ----------
async function fetchWithBrowserless(url) {
    if (!BROWSERLESS_URL) throw new Error("Browserless not configured");

    const response = await axios.post(
        BROWSERLESS_URL,
        { url },
        { timeout: 20000 }
    );

    return response.data;
}

// ---------- MAIN ----------
module.exports = async (req, res) => {
    let { url, mode } = req.query;

    if (!url) {
        return res.status(400).json({ error: "URL required" });
    }

    if (!/^https?:\/\//i.test(url)) {
        url = "https://" + url;
    }

    let dom;

    try {
        // ---------- FETCH ----------
        let html;

        if (mode === "deep") {
            html = await fetchWithBrowserless(url);
        } else {
            const response = await client.get(url);
            html = response.data;
        }

        // ---------- PARSE ----------
        dom = new JSDOM(html, { url });
        let doc = dom.window.document;

        const domain = new URL(url).hostname;
        const siteType = getSiteType(domain);

        doc = cleanDocument(doc);

        if (siteType === "wiki") {
            doc = cleanWikipedia(doc);
        }

        // ---------- EXTRACT ----------
        let article;

        if (siteType === "medium") {
            article = extractMedium(doc);
        } 
        else if (siteType === "bbc") {
            article = extractBBC(doc);
        } 
        else {
            const reader = new Readability(doc);
            article = reader.parse();
        }

        if (!article || !article.content) {
            throw new Error("Extraction failed");
        }

        // ---------- MARKDOWN ----------
        let markdown = turndownService.turndown(article.content);

        markdown = markdown
            .replace(/\[\d+\]/g, "") // remove citations
            .replace(/\n{3,}/g, "\n\n")
            .trim();

        // ---------- META ----------
        const wordCount = (article.textContent || markdown)
            .split(/\s+/)
            .filter(Boolean).length;

        const readingTime = Math.ceil(wordCount / 200) + " min";

        return res.status(200).json({
            success: true,
            title: article.title || "Untitled",
            domain,
            wordCount,
            readingTime,
            markdown,
        });

    } catch (error) {
        console.error("SCRAPE ERROR:", error.message);

        return res.status(500).json({
            success: false,
            error: error.message,
        });
    } finally {
        if (dom) dom.window.close();
    }
};