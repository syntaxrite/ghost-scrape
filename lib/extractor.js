import { load } from "cheerio";

/**
 * Extracts clean content and metadata from raw HTML.
 * @param {string} html - Raw HTML string.
 * @param {string} url - The URL being scraped.
 * @returns {object} Cleaned data including title, content, and metadata.
 */
export function extractContent(html, url) {
  if (!html) return null;

  const $ = load(html);

  // 1. Remove non-content elements
  $("script, style, noscript, iframe, nav, footer, header, .ads, #ads, .sidebar").remove();

  // 2. Extract Metadata
  const title = $("title").text().trim() || 
                $("meta[property='og:title']").attr("content") || 
                $("h1").first().text().trim();

  const author = $("meta[name='author']").attr("content") || 
                 $("meta[property='article:author']").attr("content") || "";

  const excerpt = $("meta[name='description']").attr("content") || 
                  $("meta[property='og:description']").attr("content") || "";

  // 3. Find Main Content
  // We look for common content containers if article tag isn't present
  let contentSelector = "article, .post-content, .article-body, main, #content";
  let contentHtml = "";

  if ($(contentSelector).length > 0) {
    contentHtml = $(contentSelector).first().html();
  } else {
    // Fallback: Use body if no clear container is found
    contentHtml = $("body").html();
  }

  // 4. Extract Headings for the API response
  const headings = [];
  $("h1, h2, h3").each((i, el) => {
    headings.push({
      level: el.tagName.toLowerCase(),
      text: $(el).text().trim()
    });
  });

  return {
    title,
    author,
    excerpt,
    content: contentHtml,
    headings: headings.slice(0, 10), // Limit to top 10
    text: $.text(), // Raw text for word count
    sourceType: $("article").length > 0 ? "article" : "webpage"
  };
}
