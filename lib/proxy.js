import crypto from "crypto";

// Parse comma/line-separated proxies from env: "host:port:user:pass"
export function parseResidentialProxies(raw) {
  const value = String(raw || "").trim();
  if (!value) return [];
  return value
    .split(/[\n,;]/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(entry => {
      const parts = entry.split(":");
      if (parts.length < 2) return null;
      const [host, port, user, pass] = parts;
      if (!host || !port) return null;
      return {
        host: host.trim(),
        port: Number(port.trim()),
        protocol: host.trim().startsWith("https") ? "https" : "http",
        auth: user && pass ? { username: user.trim(), password: pass.trim() } : undefined,
      };
    })
    .filter(Boolean);
}

// Pick a proxy based on session ID (hash to index)
export function pickProxy(sessionId) {
  const PROXIES = parseResidentialProxies(process.env.RESIDENTIAL_PROXIES);
  if (!PROXIES.length) return null;
  const id = sessionId || crypto.randomBytes(6).toString("hex");
  const hash = crypto.createHash("sha256").update(id).digest().readUInt32BE(0);
  return PROXIES[hash % PROXIES.length];
}

// Return Axios proxy config object for a given session ID
export function getAxiosProxyConfig(sessionId) {
  const proxy = pickProxy(sessionId);
  return proxy ? { proxy } : null;
}
