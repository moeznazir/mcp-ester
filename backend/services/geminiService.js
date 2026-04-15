import { GoogleGenerativeAI } from "@google/generative-ai";
import { fetchMcpTools, callMcpTool } from "./mcpService.js";

function geminiModelId() {
  const fallback = "gemini-3-flash-preview";
  const m = (process.env.GEMINI_MODEL || fallback).trim();
  return m || fallback;
}

function parseRetryAfterSeconds(message) {
  const m = String(message).match(/retry in ([\d.]+)\s*s/i);
  if (m) return Math.min(120, Math.ceil(parseFloat(m[1]) + 1));
  return null;
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
  const apiKey = process.env.GEMINI_API_KEY;
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
