const Parser = require("rss-parser");
const parser = new Parser();

function extractUsername(url) {
  const match = url.match(/medium\.com\/@([^\/]+)/);
  return match ? match[1] : null;
}

async function handleMedium(url) {
  try {
    const username = extractUsername(url);

    if (!username) {
      throw new Error("Only Medium user profiles supported");
    }

    const feedUrl = `https://medium.com/feed/@${username}`;

    const feed = await parser.parseURL(feedUrl);

    return {
      type: "medium-feed",
      items: feed.items.map((item) => ({
        title: item.title,
        link: item.link,
        content: item.contentSnippet,
      })),
    };

  } catch (err) {
    throw new Error("Medium RSS fetch failed");
  }
}

module.exports = { handleMedium };