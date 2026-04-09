import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = Number(process.env.PORT || 3000);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
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

async function callOpenAI({ apiKey, model, prompt, text }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: `${prompt}\n\nData:\n${text}` }]
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI error: ${response.status} ${await response.text()}`);
  }

  const json = await response.json();
  return json.output_text || "";
}

async function callClaude({ apiKey, model, prompt, text }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: model || "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `${prompt}\n\nData:\n${text}`
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Claude error: ${response.status} ${await response.text()}`);
  }

  const json = await response.json();
  return (json.content || []).map((item) => item.text || "").join("");
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

  if (req.url === "/api/run-column" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const { provider, apiKey, model, prompt, text } = body;
      if (!provider || !apiKey || !prompt) {
        send(res, 400, { error: "provider, apiKey, and prompt are required" });
        return;
      }

      const result =
        provider === "claude"
          ? await callClaude({ apiKey, model, prompt, text })
          : await callOpenAI({ apiKey, model, prompt, text });

      send(res, 200, { result });
    } catch (error) {
      send(res, 500, { error: error.message || "Unknown error" });
    }
    return;
  }

  await serveStatic(req, res);
});

server.listen(port, () => {
  console.log(`CSV AI Spreadsheet running on http://localhost:${port}`);
});
