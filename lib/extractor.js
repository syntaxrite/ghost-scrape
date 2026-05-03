export function extractContent(html, url, fetchResult) {
  // Basic extractor logic; you can integrate Readability.js here later
  return {
    title: "Extracted Page",
    content: html,
    text: html.replace(/<[^>]*>/g, ' '),
    excerpt: "",
    author: "",
    publishedAt: new Date().toISOString()
  };
}

