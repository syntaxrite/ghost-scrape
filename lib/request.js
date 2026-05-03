function parseJsonBody(req) {
  if (req && typeof req.body === "object" && req.body !== null) {
    return req.body;
  }

  if (typeof req?.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }

  return null;
}

function getClientIp(req) {
  const raw =
    req?.headers?.["x-forwarded-for"] ||
    req?.headers?.["x-real-ip"] ||
    req?.socket?.remoteAddress ||
    "unknown";

  return String(raw).split(",")[0].trim();
}

function getApiKey(req) {
  const raw = req?.headers?.authorization || req?.headers?.Authorization || req?.headers?.["x-api-key"] || "";
  const value = String(raw).trim();
  if (!value) return null;
  if (/^bearer\s+/i.test(value)) return value.replace(/^bearer\s+/i, "").trim();
  return value;
}

module.exports = {
  parseJsonBody,
  getClientIp,
  getApiKey,
};
