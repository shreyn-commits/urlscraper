export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method not allowed");
    return;
  }

  try {
    const body = await readBody(req);
    const { provider, apiKey, model, prompt, text } = body;
    if (!provider || !apiKey || !prompt) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "provider, apiKey, and prompt are required" }));
      return;
    }

    const result =
      provider === "claude"
        ? await callClaude({ apiKey, model, prompt, text })
        : await callOpenAI({ apiKey, model, prompt, text });

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ result }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: error.message || "Unknown error" }));
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
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
