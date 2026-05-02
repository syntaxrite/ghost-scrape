// lib/proxy.js

const PROXIES = (process.env.RESIDENTIAL_PROXIES || "")
  .split(",")
  .map(p => p.trim())
  .filter(Boolean)
  .map(parseProxy);

function parseProxy(proxyString) {
  // format: host:port:username:password
  const [host, port, username, password] = proxyString.split(":");

  if (!host || !port) return null;

  return {
    host,
    port: Number(port),
    auth: username && password ? { username, password } : undefined
  };
}

function getRandomProxy() {
  if (!PROXIES.length) return null;
  return PROXIES[Math.floor(Math.random() * PROXIES.length)];
}

// 🔑 STICKY SESSION (important for retries)
const sessionMap = new Map();

function getProxyForSession(sessionId) {
  if (!PROXIES.length) return null;

  if (sessionMap.has(sessionId)) {
    return sessionMap.get(sessionId);
  }

  const proxy = getRandomProxy();
  sessionMap.set(sessionId, proxy);

  // expire after 2 minutes
  setTimeout(() => {
    sessionMap.delete(sessionId);
  }, 120000);

  return proxy;
}

function getAxiosProxyConfig(sessionId) {
  const proxy = sessionId
    ? getProxyForSession(sessionId)
    : getRandomProxy();

  if (!proxy) return {};

  return {
    proxy: {
      host: proxy.host,
      port: proxy.port,
      auth: proxy.auth
    }
  };
}

module.exports = {
  getAxiosProxyConfig
};
