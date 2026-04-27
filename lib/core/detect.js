function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// ---------- SITE TYPE DETECTION ----------

function isWikipedia(domain) {
  return domain === "wikipedia.org" || domain.endsWith(".wikipedia.org");
}

function isMedium(domain) {
  return domain === "medium.com" || domain.endsWith(".medium.com");
}

function isBBC(domain) {
  return domain === "bbc.com" || domain.endsWith(".bbc.com");
}

function isNews(domain) {
  return (
    isBBC(domain) ||
    domain.includes("cnn.com") ||
    domain.includes("nytimes.com") ||
    domain.includes("theguardian.com")
  );
}

function isDocs(domain) {
  return (
    domain.includes("developer.mozilla.org") ||
    domain.includes("docs.python.org")
  );
}

function isBlog(domain) {
  // fallback heuristic
  return (
    !isWikipedia(domain) &&
    !isNews(domain) &&
    !isDocs(domain)
  );
}

// ---------- BOT / BLOCK DETECTION ----------

function looksLikeBlocked(html) {
  const s = String(html || "").toLowerCase();

  return (
    s.includes("cf-browser-verification") ||
    s.includes("checking your browser before accessing") ||
    s.includes("cloudflare ray id") ||
    (s.includes("access denied") && s.includes("server")) ||
    s.includes("captcha") ||
    s.includes("verify you are not a bot")
  );
}

// ---------- ARTICLE QUALITY SIGNALS ----------

function isProbablyArticle(url) {
  // simple heuristic: articles usually have slugs
  return url.split("/").length > 3 && url.includes("-");
}

function isHomepage(url) {
  try {
    const u = new URL(url);
    return u.pathname === "/" || u.pathname === "";
  } catch {
    return false;
  }
}

// ---------- DECISION ENGINE ----------

function getSiteType(domain) {
  if (isWikipedia(domain)) return "wikipedia";
  if (isMedium(domain)) return "medium";
  if (isNews(domain)) return "news";
  if (isDocs(domain)) return "docs";
  return "blog";
}

function getDomain(url) {
  return new URL(url).hostname.replace(/^www\./, "");
}

function isReddit(domain) {
  return domain.includes("reddit.com");
}

function isMedium(domain) {
  return domain.includes("medium.com");
}

module.exports = {
  getDomain,
  isReddit,
  isMedium,
};

function shouldForceBrowser(domain, mode) {
  return (
    isMedium(domain) ||
    mode === "deep"
  );
}

module.exports = {
  getDomain,

  isWikipedia,
  isMedium,
  isBBC,
  isNews,
  isDocs,
  isBlog,

  looksLikeBlocked,

  isProbablyArticle,
  isHomepage,

  getSiteType,
  shouldForceBrowser,
};