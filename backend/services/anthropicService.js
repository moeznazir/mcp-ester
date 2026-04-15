import Anthropic from "@anthropic-ai/sdk";
import { fetchMcpTools, callMcpTool } from "./mcpService.js";

const MODEL = "claude-sonnet-4-5";

function buildAnthropicTools(mcpTools) {
  return (mcpTools || []).map((tool) => ({
    name: tool.name,
    description: tool.description || "",
    input_schema: tool.inputSchema || {
      type: "object",
      properties: {},
    },
  }));
}

function buildMessages(conversationHistory, userMessage) {
  const messages = [];

  for (const turn of conversationHistory || []) {
    if (!turn || !turn.role) continue;
    const content =
      typeof turn.content === "string" ? turn.content : String(turn.content ?? "");
    if (!content.trim()) continue;
    if (turn.role === "user") {
      messages.push({ role: "user", content });
    } else if (turn.role === "assistant") {
      messages.push({ role: "assistant", content });
    }
  }

  messages.push({ role: "user", content: userMessage });
  return messages;
}

function extractTextFromContent(content) {
  if (!content || !Array.isArray(content)) return "";
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("");
}

/**
 * @param {string} userMessage
 * @param {Array<{ role: string, content: string }>} conversationHistory
 */
export async function chat(userMessage, conversationHistory) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const mcpTools = await fetchMcpTools();
  const tools = buildAnthropicTools(mcpTools);
  const client = new Anthropic({ apiKey });
  const messages = buildMessages(conversationHistory, userMessage);

  let loopGuard = 0;
  const maxLoops = 24;

  while (loopGuard < maxLoops) {
    loopGuard += 1;

    let response;
    try {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        tools: tools.length ? tools : undefined,
        messages,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Anthropic request failed: ${msg}`);
    }

    if (response.stop_reason === "end_turn") {
      const text = extractTextFromContent(response.content);
      return text || "(No text in response)";
    }

    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });

      const toolResultBlocks = [];
      for (const block of response.content) {
        if (block.type === "tool_use") {
          const rawInput = block.input;
          const args =
            rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
              ? rawInput
              : {};
          const resultText = await callMcpTool(block.name, args);
          toolResultBlocks.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: resultText,
          });
        }
      }

      if (toolResultBlocks.length === 0) {
        const text = extractTextFromContent(response.content);
        return text || "(Model requested tools but none were executed)";
      }

      messages.push({ role: "user", content: toolResultBlocks });
      continue;
    }

    const text = extractTextFromContent(response.content);
    if (text) return text;
    return `(Stopped: ${response.stop_reason || "unknown"})`;
  }

  throw new Error("Anthropic tool loop exceeded safety limit");
}
