// ---------- BASIC METRICS ----------

function getWordCount(text) {
  return String(text || "")
    .split(/\s+/)
    .filter(Boolean).length;
}

function getParagraphCount(html) {
  return (String(html || "").match(/<p/gi) || []).length;
}

function getHeadingCount(html) {
  return (String(html || "").match(/<h[1-6]/gi) || []).length;
}

function getLinkDensity(html) {
  const links = (html.match(/<a /gi) || []).length;
  const textLength = html.replace(/<[^>]*>/g, "").length;

  if (textLength === 0) return 0;
  return links / textLength;
}

// ---------- SCORING ENGINE ----------

function scoreArticle(article) {
  if (!article) return 0;

  const text = article.textContent || "";
  const html = article.content || "";

  const words = getWordCount(text);
  const paragraphs = getParagraphCount(html);
  const headings = getHeadingCount(html);
  const linkDensity = getLinkDensity(html);

  let score = 0;

  // core signals
  score += words;
  score += paragraphs * 80;
  score += headings * 20;

  // penalties
  if (linkDensity > 0.05) score -= 200; // too many links → nav page
  if (words < 100) score -= 300;
  if (paragraphs < 3) score -= 200;

  return score;
}

// ---------- QUALITY CHECK ----------

function isGoodArticle(article) {
  const score = scoreArticle(article);

  return score > 300;
}

// ---------- RETRY DECISION ----------

function shouldRetry(article, source) {
  if (!article) return true;

  const words = getWordCount(article.textContent);

  // weak extraction
  if (words < 120) return true;

  // already used browserless → don't loop
  if (source && source.includes("browserless")) return false;

  return !isGoodArticle(article);
}

module.exports = {
  scoreArticle,
  isGoodArticle,
  shouldRetry,
  getWordCount,
};