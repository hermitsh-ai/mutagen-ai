/**
 * Mutagen-AI — LLM Providers
 *
 * Raw HTTP calls to LLM APIs. No SDKs — just fetch().
 * This is intentional: SDKs inject framework context and abstractions
 * that can pollute test results. We need to replicate exactly what
 * the production system sends.
 */

export interface ProviderConfig {
  provider: string;
  model: string;
  apiKeyEnv: string;
  temperature?: number;
  maxTokens?: number;
  endpoint?: string;
}

export interface ApiResponse {
  text: string;
  metadata: {
    inputTokens?: number;
    outputTokens?: number;
    model?: string;
  };
}

export interface MultimodalInput {
  text: string;
  images?: string[];
}

export type UserInput = string | MultimodalInput;

function getApiKey(envVar: string): string {
  const key = process.env[envVar];
  if (!key) {
    throw new Error(
      `API key not found. Set the ${envVar} environment variable.\n` +
      `  export ${envVar}=your-key-here`,
    );
  }
  return key;
}

function isMultimodal(input: UserInput): input is MultimodalInput {
  return typeof input === "object" && "text" in input;
}

async function readImageAsBase64(imagePath: string): Promise<{ data: string; mime: string }> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const ext = path.extname(imagePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
  };
  const mime = mimeMap[ext] ?? "image/jpeg";
  const buf = await fs.readFile(imagePath);
  return { data: buf.toString("base64"), mime };
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

async function callGemini(
  systemPrompt: string,
  userInput: UserInput,
  config: ProviderConfig,
): Promise<ApiResponse> {
  const apiKey = getApiKey(config.apiKeyEnv);
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${apiKey}`;

  // Build user content parts
  const parts: unknown[] = [];
  if (isMultimodal(userInput)) {
    if (userInput.text) parts.push({ text: userInput.text });
    for (const imgPath of userInput.images ?? []) {
      const { data, mime } = await readImageAsBase64(imgPath);
      parts.push({ inline_data: { mime_type: mime, data } });
    }
  } else {
    parts.push({ text: userInput });
  }

  const payload = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: config.temperature ?? 1.0,
      maxOutputTokens: config.maxTokens ?? 8192,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = (await res.json()) as Record<string, unknown>;
  if (!("candidates" in json)) {
    throw new Error(`Gemini API error: ${JSON.stringify(json, null, 2)}`);
  }

  const candidates = json["candidates"] as Array<Record<string, unknown>>;
  const content = candidates[0]["content"] as Record<string, unknown>;
  const respParts = content["parts"] as Array<Record<string, unknown>>;
  const text = respParts[0]["text"] as string;

  const metadata: ApiResponse["metadata"] = { model: config.model };
  const usage = json["usageMetadata"] as Record<string, number> | undefined;
  if (usage) {
    metadata.inputTokens = usage["promptTokenCount"];
    metadata.outputTokens = usage["candidatesTokenCount"];
  }

  return { text, metadata };
}

// ---------------------------------------------------------------------------
// OpenAI (and compatible APIs)
// ---------------------------------------------------------------------------

async function callOpenai(
  systemPrompt: string,
  userInput: UserInput,
  config: ProviderConfig,
): Promise<ApiResponse> {
  const apiKey = getApiKey(config.apiKeyEnv);
  const endpoint = config.endpoint ?? "https://api.openai.com/v1/chat/completions";

  let content: unknown;
  if (isMultimodal(userInput)) {
    const parts: unknown[] = [];
    if (userInput.text) parts.push({ type: "text", text: userInput.text });
    for (const imgPath of userInput.images ?? []) {
      const { data, mime } = await readImageAsBase64(imgPath);
      parts.push({
        type: "image_url",
        image_url: { url: `data:${mime};base64,${data}` },
      });
    }
    content = parts;
  } else {
    content = userInput;
  }

  const payload = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content },
    ],
    temperature: config.temperature ?? 0.7,
    max_tokens: config.maxTokens ?? 4096,
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const json = (await res.json()) as Record<string, unknown>;
  if (!("choices" in json)) {
    throw new Error(`OpenAI API error: ${JSON.stringify(json, null, 2)}`);
  }

  const choices = json["choices"] as Array<Record<string, unknown>>;
  const message = choices[0]["message"] as Record<string, unknown>;
  const text = message["content"] as string;

  const metadata: ApiResponse["metadata"] = { model: config.model };
  const usage = json["usage"] as Record<string, number> | undefined;
  if (usage) {
    metadata.inputTokens = usage["prompt_tokens"];
    metadata.outputTokens = usage["completion_tokens"];
  }

  return { text, metadata };
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

async function callAnthropic(
  systemPrompt: string,
  userInput: UserInput,
  config: ProviderConfig,
): Promise<ApiResponse> {
  const apiKey = getApiKey(config.apiKeyEnv);

  let content: unknown;
  if (isMultimodal(userInput)) {
    const parts: unknown[] = [];
    if (userInput.text) parts.push({ type: "text", text: userInput.text });
    for (const imgPath of userInput.images ?? []) {
      const { data, mime } = await readImageAsBase64(imgPath);
      parts.push({
        type: "image",
        source: { type: "base64", media_type: mime, data },
      });
    }
    content = parts;
  } else {
    content = userInput;
  }

  const payload: Record<string, unknown> = {
    model: config.model,
    max_tokens: config.maxTokens ?? 4096,
    system: systemPrompt,
    messages: [{ role: "user", content }],
  };
  if (config.temperature !== undefined) {
    payload["temperature"] = config.temperature;
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(payload),
  });

  const json = (await res.json()) as Record<string, unknown>;
  if (!("content" in json)) {
    throw new Error(`Anthropic API error: ${JSON.stringify(json, null, 2)}`);
  }

  const respContent = json["content"] as Array<Record<string, unknown>>;
  const text = respContent[0]["text"] as string;

  const metadata: ApiResponse["metadata"] = { model: config.model };
  const usage = json["usage"] as Record<string, number> | undefined;
  if (usage) {
    metadata.inputTokens = usage["input_tokens"];
    metadata.outputTokens = usage["output_tokens"];
  }

  return { text, metadata };
}

// ---------------------------------------------------------------------------
// Provider Registry
// ---------------------------------------------------------------------------

type ProviderFn = (
  systemPrompt: string,
  userInput: UserInput,
  config: ProviderConfig,
) => Promise<ApiResponse>;

const PROVIDERS: Record<string, ProviderFn> = {
  gemini: callGemini,
  google: callGemini,
  openai: callOpenai,
  anthropic: callAnthropic,
};

export function callApi(
  systemPrompt: string,
  userInput: UserInput,
  config: ProviderConfig,
): Promise<ApiResponse> {
  const provider = config.provider.toLowerCase();
  const fn = PROVIDERS[provider];
  if (!fn) {
    throw new Error(
      `Unknown provider: '${config.provider}'. Available: ${Object.keys(PROVIDERS).join(", ")}`,
    );
  }
  return fn(systemPrompt, userInput, config);
}

export function listProviders(): string[] {
  return Object.keys(PROVIDERS);
}
