const axios = require("axios");

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;
const BROWSERLESS_URL = "https://chrome.browserless.io/content";

/**
 * Superior Human-Mimic Fetcher
 * Bypasses Cloudflare using behavior simulation and fingerprint randomization
 */
async function fetchWithBrowser(url) {
  if (!BROWSERLESS_TOKEN) throw new Error("Missing BROWSERLESS_TOKEN");

  // 1. Randomize User Agent for every request
  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  ];
  const selectedUA = userAgents[Math.floor(Math.random() * userAgents.length)];

  try {
    const response = await axios.post(
      `${BROWSERLESS_URL}?token=${BROWSERLESS_TOKEN}`,
      {
        url: url,
        // The "Secret Sauce": Executing human-like behavior BEFORE grabbing content
        context: {
          userAgent: selectedUA,
          viewport: { width: 1920, height: 1080 }
        },
        config: {
          // Force wait for JS execution
          waitUntil: "networkidle2",
        },
        // RUN JAVASCRIPT inside the browser to mimic a human scrolling and moving mouse
        // Cloudflare tracks these events to verify "Humanity"
        scripts: [
          {
            code: `
              (async () => {
                // 1. Random mouse movement to trigger event listeners
                for(let i=0; i<5; i++) {
                  window.scrollTo(0, Math.random() * 500);
                  await new Promise(r => setTimeout(r, Math.random() * 500 + 200));
                }
                // 2. Click a neutral area to simulate engagement
                const body = document.querySelector('body');
                const evt = new MouseEvent('click', { view: window, bubbles: true, cancelable: true });
                body.dispatchEvent(evt);
              })();
            `
          }
        ]
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 30000 
      }
    );

    return {
      html: response.data,
      source: "ghost-stealth-v2"
    };
  } catch (error) {
    console.error("Superior Cloud Error:", error.response?.data || error.message);
    throw new Error(`Cloudflare bypass failed for ${url}`);
  }
}

module.exports = { fetchWithBrowser };