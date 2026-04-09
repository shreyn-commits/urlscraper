const MODEL_FAMILIES = {
  openai: [
    { key: "gpt-5.2", label: "GPT-5.2", match: /^gpt-5\.2($|[-.])/i },
    { key: "gpt-5", label: "GPT-5", match: /^gpt-5($|[-.])/i },
    { key: "gpt-5-mini", label: "GPT-5 mini", match: /^gpt-5-mini($|[-.])/i },
    { key: "gpt-5-nano", label: "GPT-5 nano", match: /^gpt-5-nano($|[-.])/i },
    { key: "gpt-4.1", label: "GPT-4.1", match: /^gpt-4\.1($|[-.])/i },
    { key: "gpt-4.1-mini", label: "GPT-4.1 mini", match: /^gpt-4\.1-mini($|[-.])/i }
  ],
  claude: [
    { key: "claude-opus-4", label: "Claude Opus 4", match: /^claude-opus-4-/i },
    { key: "claude-sonnet-4", label: "Claude Sonnet 4", match: /^claude-sonnet-4-/i },
    { key: "claude-3-7-sonnet", label: "Claude 3.7 Sonnet", match: /^claude-3-7-sonnet-/i },
    { key: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet", match: /^claude-3-5-sonnet-/i },
    { key: "claude-3-5-haiku", label: "Claude 3.5 Haiku", match: /^claude-3-5-haiku-/i }
  ]
};

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

export async function listSupportedModels({ provider, apiKey }) {
  if (!provider) {
    throw new Error("provider is required");
  }

  const key =
    apiKey || (provider === "claude" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY);
  if (!key) {
    throw new Error("API key missing");
  }

  const models = provider === "claude" ? await fetchClaudeModels(key) : await fetchOpenAiModels(key);
  const supported = MODEL_FAMILIES[provider] || [];

  const curated = supported
    .map((family) => {
      const matches = models
        .filter((model) => family.match.test(model.id))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

      if (!matches.length) return null;
      return {
        id: matches[0].id,
        label: `${family.label} (${matches[0].id})`
      };
    })
    .filter(Boolean);

  return curated;
}

async function fetchOpenAiModels(apiKey) {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });

  if (!response.ok) {
    throw new Error(`OpenAI models error: ${response.status} ${await response.text()}`);
  }

  const json = await response.json();
  return (json.data || []).map((model) => ({
    id: model.id,
    createdAt: Number(model.created || 0)
  }));
}

async function fetchClaudeModels(apiKey) {
  const response = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    }
  });

  if (!response.ok) {
    throw new Error(`Claude models error: ${response.status} ${await response.text()}`);
  }

  const json = await response.json();
  return (json.data || []).map((model) => ({
    id: model.id,
    createdAt: model.created_at || ""
  }));
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
