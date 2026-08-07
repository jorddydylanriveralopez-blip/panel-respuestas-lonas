require("dotenv").config({ path: ".env.local" });
require("dotenv").config();
const path = require("path");
const express = require("express");
const {
  fetchAllSubmissions,
} = require("./lib/fillout");

const app = express();
const PORT = process.env.PORT || 3000;

const ALLOWED_HOSTS = [
  "fillout.com",
  "amazonaws.com",
  "cloudfront.net",
  "filloutusercontent.com",
];

function isAllowedUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    return ALLOWED_HOSTS.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
}

app.get("/api/submissions", async (_req, res) => {
  try {
    const data = await fetchAllSubmissions();
    res.json({
      ...data,
      fetchedAt: new Date().toISOString(),
      configured: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    const missingKey = message.includes("FILLOUT_API_KEY");
    res.status(missingKey ? 503 : 502).json({
      error: message,
      configured: !missingKey,
      responses: [],
      totalResponses: 0,
      pageCount: 0,
      fetchedAt: new Date().toISOString(),
    });
  }
});

app.get("/api/download", async (req, res) => {
  const target = req.query.url;
  const filename = req.query.filename || "archivo-adjunto";

  if (!target || typeof target !== "string" || !isAllowedUrl(target)) {
    return res.status(400).json({ error: "URL no permitida" });
  }

  try {
    const upstream = await fetch(target);
    if (!upstream.ok || !upstream.body) {
      return res
        .status(502)
        .json({ error: `No se pudo descargar (${upstream.status})` });
    }

    const contentType =
      upstream.headers.get("content-type") || "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.setHeader("Cache-Control", "private, max-age=60");

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.send(buffer);
  } catch {
    res.status(502).json({ error: "Error al descargar el archivo" });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Panel escuchando en http://0.0.0.0:${PORT}`);
});
