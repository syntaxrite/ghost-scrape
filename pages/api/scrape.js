import { fetchSmart } from "../../lib/engine";
import { getWordCount, cleanMarkdown, markdownParser } from "../../lib/utils";
import { MONTHLY_LIMIT, checkMonthlyUsage, logUsage } from "../../lib/usage";
import { validateKey } from "../../lib/auth";
import { getApiKey, getClientIp } from "../../lib/request";

export default async function handler(req, res) {
  const startTime = Date.now();
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  try {
    const apiKey = getApiKey(req);
    const ip = getClientIp(req);
    if (!apiKey) return res.status(401).json({ error: "API key required" });
    
    const keyRow = await validateKey(apiKey);
    if (!keyRow) return res.status(403).json({ error: "Invalid key" });

    const used = await checkMonthlyUsage(apiKey, ip);
    if (used >= MONTHLY_LIMIT) return res.status(429).json({ error: "Limit reached" });

    const { url } = req.body;
    const result = await fetchSmart(url);
    
    let markdown = markdownParser.turndown(result.html || "");
    markdown = cleanMarkdown(markdown).slice(0, 20000);

    const response = {
      success: true,
      title: "Scraped Page",
      markdown,
      wordCount: getWordCount(markdown),
      duration_ms: Date.now() - startTime
    };

    logUsage(apiKey, ip, "scrape");
    return res.status(200).json(response);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
