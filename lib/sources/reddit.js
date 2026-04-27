const axios = require("axios");

async function handleReddit(url) {
  try {
    const jsonUrl = url.endsWith(".json") ? url : `${url}.json`;

    const res = await axios.get(jsonUrl, {
      headers: {
        "User-Agent": "GhostScrape/1.0",
      },
    });

    const data = res.data;

    // subreddit listing
    if (data?.data?.children) {
      return {
        type: "reddit-list",
        items: data.data.children.map((p) => ({
          title: p.data.title,
          url: p.data.url,
          upvotes: p.data.ups,
        })),
      };
    }

    // post + comments
    if (Array.isArray(data)) {
      const post = data[0]?.data?.children[0]?.data;

      return {
        type: "reddit-post",
        title: post?.title,
        content: post?.selftext,
      };
    }

    throw new Error("Invalid Reddit format");

  } catch (err) {
    throw new Error("Reddit fetch failed");
  }
}

module.exports = { handleReddit };