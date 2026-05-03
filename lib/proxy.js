const axios = require("axios");

function parseResidentialProxies(raw) {
  const value = String(raw || "").trim();
  if (!value) return [];

  return value
    .split(/[\n,;]/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.split(":");
      if (parts.length < 2) return null;

      const [host, port, username, password] = parts;
      const proxy = {
        protocol: "http",
        host,
        port: Number(port),
      };

      if (username || password) {
        proxy.auth = {
          username: username || "",
          password: password || "",
        };
      }

      if (!proxy.host || !Number.isFinite(proxy.port)) return null;
      return proxy;
    })
    .filter(Boolean);
}

const PROXIES = parseResidentialProxies(process.env.RESIDENTIAL_PROXIES);

function hashString(input) {
  let hash = 2166136261;
  const str = String(input || "");
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0);
}

function pickProxy(sessionId) {
  if (!PROXIES.length) return null;
  const index = hashString(sessionId || Math.random().toString(36).slice(2)) % PROXIES.length;
  return PROXIES[index];
}

function getAxiosProxyConfig(sessionId) {
  const proxy = pickProxy(sessionId);
  if (!proxy) return null;
  return { proxy };
}

module.exports = {
  parseResidentialProxies,
  getAxiosProxyConfig,
};
