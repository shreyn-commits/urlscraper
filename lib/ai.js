export async function runAiRequest({ provider, apiKey, model, prompt, text }) {
  if (!provider || !prompt) {
    throw new Error("provider and prompt are required");
  }

  if (provider === "claude") {
    return callClaude({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
      model,
      prompt,
      text
    });
  }

  return callOpenAI({
    apiKey: apiKey || process.env.OPENAI_API_KEY,
    model,
    prompt,
    text
  });
}

async function callOpenAI({ apiKey, model, prompt, text }) {
  if (!apiKey) {
    throw new Error("OpenAI API key missing");
  }

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
  if (!apiKey) {
    throw new Error("Anthropic API key missing");
  }

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
