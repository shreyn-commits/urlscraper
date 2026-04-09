import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listSupportedModels, runAiRequest } from "./lib/ai.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = Number(process.env.PORT || 3000);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8"
};

function send(res, status, body, contentType = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function serveStatic(req, res) {
  const urlPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const filePath = path.join(__dirname, urlPath);
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(__dirname)) {
    send(res, 403, { error: "Forbidden" });
    return;
  }

  try {
    const data = await fs.readFile(normalized);
    const ext = path.extname(normalized);
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    send(res, 404, { error: "Not found" });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
    });
    res.end();
    return;
  }

  if (req.url === "/api/models" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const models = await listSupportedModels(body);
      send(res, 200, {
        models,
        message: models.length
          ? "Loaded supported models for this API key."
          : "No supported models from the curated list were available for this key."
      });
    } catch (error) {
      send(res, 500, { error: error.message || "Unknown error" });
    }
    return;
  }

  if ((req.url === "/api/run-column" || req.url === "/api/run-ai") && req.method === "POST") {
    try {
      const body = await readBody(req);
      const result = await runAiRequest(body);
      send(res, 200, { result });
    } catch (error) {
      send(res, 500, { error: error.message || "Unknown error" });
    }
    return;
  }

  await serveStatic(req, res);
});

server.listen(port, () => {
  console.log(`AI Spreadsheet running on http://localhost:${port}`);
});
