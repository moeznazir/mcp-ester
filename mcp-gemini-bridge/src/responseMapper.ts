import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { log } from "./logger.js";

/**
 * Turn an MCP {@link CallToolResult} into a plain object suitable for
 * Gemini {@link FunctionResponse.response} (structured output the model can read).
 */
export function callToolResultToGeminiResponse(result: CallToolResult): Record<string, unknown> {
  log.step("responseMapper.call_tool_result", {
    isError: result.isError ?? false,
    contentBlocks: result.content?.length ?? 0,
  });

  const textParts: string[] = [];
  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      if (!block || typeof block !== "object") continue;
      const b = block as { type?: string; text?: string };
      if (b.type === "text" && typeof b.text === "string") {
        textParts.push(b.text);
      } else {
        textParts.push(JSON.stringify(block));
      }
    }
  }

  const out: Record<string, unknown> = {
    result: textParts.join("\n").trim() || "(empty MCP tool result)",
  };

  if (result.isError) {
    out.mcpError = true;
  }

  const structured = (result as { structuredContent?: unknown }).structuredContent;
  if (structured !== undefined && structured !== null) {
    out.structuredContent = structured as Record<string, unknown>;
  }

  log.step("responseMapper.done", { keys: Object.keys(out) });
  return out;
}
