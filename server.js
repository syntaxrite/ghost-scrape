const express = require("express");
const path = require("node:path");

const app = express();
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 3000);

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(publicDir, { extensions: ["html"] }));

const routes = {
  "/": "index.html",
  "/login": "login.html",
  "/dashboard": "dashboard.html",
  "/docs": "docs.html",
  "/privacy": "privacy.html",
  "/terms": "terms.html",
  "/status": "status.html",
};

for (const [route, file] of Object.entries(routes)) {
  app.get(route, (_req, res) => res.sendFile(path.join(publicDir, file)));
}

app.use("/api/scrape", require("./api/scrape"));
app.use("/api/demo", require("./api/demo"));
app.use("/api/auth/request-otp", require("./api/auth/request-otp"));
app.use("/api/auth/verify-otp", require("./api/auth/verify-otp"));
app.use("/api/user/stats", require("./api/user/stats"));

app.get("/healthz", (_req, res) => res.json({ ok: true, service: "ghost-scrape" }));

app.use((req, res) => {
  if (req.accepts("html")) {
    return res.status(404).sendFile(path.join(publicDir, "index.html"));
  }
  return res.status(404).json({ success: false, error: "Not found" });
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Ghost Scrape listening on http://localhost:${port}`);
  });
}

module.exports = app;
