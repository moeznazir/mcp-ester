import { GoogleGenerativeAI } from "@google/generative-ai";
import { fetchMcpTools, callMcpTool } from "./mcpService.js";

function geminiModelId() {
  const fallback = "gemini-3-flash-preview";
  const m = (process.env.GEMINI_MODEL || fallback).trim();
  return m || fallback;
}

function parseRetryAfterSeconds(message) {
  const m = String(message);
  const prose = m.match(/retry in ([\d.]+)\s*s/i);
  if (prose) return Math.min(120, Math.ceil(parseFloat(prose[1]) + 1));
  const jsonDelay = m.match(/"retryDelay"\s*:\s*"(\d+)s"/i);
  if (jsonDelay) return Math.min(120, parseInt(jsonDelay[1], 10) + 1);
  return null;
}

/**
 * True only for **per-day** (or explicit per-day project/model) caps.
 * Do NOT match generic `free_tier` / `generate_content_free_tier_requests` alone — those
 * strings also appear on **per-minute** free-tier 429s where waiting and retrying works
 * (same behavior as a single Postman call after a short pause).
 */
function isNonRetryableGeminiQuotaError(message) {
  const m = String(message);
  return (
    m.includes("GenerateRequestsPerDay") ||
    m.includes("PerDayPerProjectPerModel") ||
    m.includes("generate_requests_per_day")
  );
}

function userFacingGeminiQuotaMessage(rawMessage) {
  const model = geminiModelId();
  return [
    "Gemini API quota limit reached for your Google Cloud / AI Studio project.",
    `Model in use: ${model} (set GEMINI_MODEL in backend/.env to switch).`,
    "Free tier includes a small number of requests per day per model; when that is exhausted, retries after a few seconds will not succeed until the quota resets or you enable billing.",
    "Details: https://ai.google.dev/gemini-api/docs/rate-limits",
    `Technical: ${String(rawMessage).slice(0, 500)}${String(rawMessage).length > 500 ? "…" : ""}`,
  ].join(" ");
}

async function withGemini429Retry(label, fn, maxAttempts = 4) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const is429 =
        msg.includes("429") ||
        msg.includes("Too Many Requests") ||
        msg.includes("RESOURCE_EXHAUSTED");
      if (is429 && isNonRetryableGeminiQuotaError(msg)) {
        throw new Error(userFacingGeminiQuotaMessage(msg));
      }
      if (!is429 || attempt === maxAttempts - 1) {
        throw err;
      }
      const fromApi = parseRetryAfterSeconds(msg);
      const waitSec =
        fromApi ?? Math.min(90, 5 * 2 ** attempt);
      await new Promise((r) => setTimeout(r, waitSec * 1000));
    }
  }
  throw lastErr;
}

const GEMINI_TYPE_MAP = {
  object: "OBJECT",
  array: "ARRAY",
  string: "STRING",
  number: "NUMBER",
  integer: "INTEGER",
  boolean: "BOOLEAN",
};

/**
 * Best-effort JSON Schema (MCP) → Gemini function parameters shape.
 */
function jsonSchemaToGeminiParameters(schema) {
  if (!schema || typeof schema !== "object") {
    return { type: "OBJECT", properties: {} };
  }

  function convert(node) {
    if (!node || typeof node !== "object") {
      return { type: "STRING" };
    }

    const t = String(node.type || "object").toLowerCase();
    const geminiType = GEMINI_TYPE_MAP[t] || "OBJECT";

    if (geminiType === "OBJECT") {
      const props = {};
      const propsIn = node.properties;
      if (propsIn && typeof propsIn === "object") {
        for (const key of Object.keys(propsIn)) {
          props[key] = convert(propsIn[key]);
        }
      }
      const out = {
        type: "OBJECT",
        properties: props,
      };
      if (Array.isArray(node.required) && node.required.length) {
        out.required = node.required.map(String);
      }
      if (node.description) out.description = String(node.description);
      return out;
    }

    if (geminiType === "ARRAY") {
      const out = {
        type: "ARRAY",
        items: node.items ? convert(node.items) : { type: "STRING" },
      };
      if (node.description) out.description = String(node.description);
      return out;
    }

    const out = { type: geminiType };
    if (node.description) out.description = String(node.description);
    if (node.enum) out.enum = node.enum;
    return out;
  }

  try {
    return convert(schema);
  } catch {
    return { type: "OBJECT", properties: {} };
  }
}

function buildFunctionDeclarations(mcpTools) {
  return (mcpTools || []).map((tool) => ({
    name: tool.name,
    description: (tool.description || "").slice(0, 2048),
    parameters: jsonSchemaToGeminiParameters(tool.inputSchema),
  }));
}

function buildGeminiHistory(conversationHistory) {
  const history = [];
  for (const turn of conversationHistory || []) {
    if (!turn || !turn.role) continue;
    const text =
      typeof turn.content === "string" ? turn.content : String(turn.content ?? "");
    if (!text.trim()) continue;
    if (turn.role === "user") {
      history.push({ role: "user", parts: [{ text }] });
    } else if (turn.role === "assistant") {
      history.push({ role: "model", parts: [{ text }] });
    }
  }
  return history;
}

function extractFunctionCallsFromResponse(response) {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!parts || !Array.isArray(parts)) return [];
  return parts
    .filter((p) => p.functionCall && p.functionCall.name)
    .map((p) => ({
      name: p.functionCall.name,
      args:
        p.functionCall.args && typeof p.functionCall.args === "object"
          ? p.functionCall.args
          : {},
    }));
}

function extractTextFromResponse(response) {
  try {
    const t = response.text?.();
    if (t && String(t).trim()) return String(t);
  } catch {
    /* may throw when response is only function calls */
  }

  const parts = response?.candidates?.[0]?.content?.parts;
  if (!parts) return "";

  const texts = [];
  for (const p of parts) {
    if (p.text) texts.push(String(p.text));
  }
  return texts.join("");
}

/**
 * @param {string} userMessage
 * @param {Array<{ role: string, content: string }>} conversationHistory
 */
export async function chat(userMessage, conversationHistory) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const mcpTools = await fetchMcpTools();
  const functionDeclarations = buildFunctionDeclarations(mcpTools);

  const modelId = geminiModelId();
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelId,
    tools:
      functionDeclarations.length > 0
        ? [{ functionDeclarations }]
        : undefined,
  });

  const history = buildGeminiHistory(conversationHistory);

  let chatSession;
  try {
    chatSession = model.startChat({ history });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Gemini could not start chat: ${msg}`);
  }

  let loopGuard = 0;
  const maxLoops = 24;
  let result = await withGemini429Retry("sendMessage(user)", () =>
    chatSession.sendMessage(userMessage)
  );
  let response = result.response;

  while (loopGuard < maxLoops) {
    loopGuard += 1;

    if (!response?.candidates?.length) {
      const fb = response?.promptFeedback?.blockReason;
      return fb
        ? `(Response blocked: ${fb})`
        : "(No candidates in Gemini response)";
    }

    const calls = extractFunctionCallsFromResponse(response);
    if (!calls.length) {
      const text = extractTextFromResponse(response);
      return text || "(Empty text from Gemini)";
    }

    const responseParts = [];
    for (const call of calls) {
      const toolResult = await callMcpTool(call.name, call.args);
      responseParts.push({
        functionResponse: {
          name: call.name,
          response: { result: toolResult },
        },
      });
    }

    try {
      result = await withGemini429Retry("sendMessage(functionResponse)", () =>
        chatSession.sendMessage(responseParts)
      );
      response = result.response;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Gemini sendMessage failed: ${msg}`);
    }
  }

  throw new Error("Gemini tool loop exceeded safety limit");
}
