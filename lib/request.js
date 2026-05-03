// Safely parse JSON body (Next.js auto-parses JSON into req.body)
export function parseJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return null;
}

// Get API key from Authorization header or x-api-key
export function getApiKey(req) {
  const auth = req.headers["x-api-key"] || req.headers.authorization || "";
  const value = String(auth).trim();
  if (!value) return null;
  const parts = value.split(/\s+/);
  // Supports "Bearer token" or bare key
  if (parts[0].toLowerCase() === "bearer" && parts[1]) {
    return parts[1].trim();
  }
  return value;
}

// Get client IP, using x-forwarded-for or socket address
export function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.headers["x-real-ip"] || req.socket.remoteAddress;
}
