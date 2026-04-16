import { GoogleGenerativeAI } from "@google/generative-ai";
import type { BridgeEnv } from "./config.js";
import { createMcpTransport } from "./transport.js";
import { XanoMcpClient } from "./xanoMcpClient.js";
import { mcpToolsToGeminiDeclarations } from "./schemaMapper.js";
import { callToolResultToGeminiResponse } from "./responseMapper.js";
import { log } from "./logger.js";
import { withGemini429Retry } from "./geminiRetry.js";
import { AuthSession } from "./authSession.js";
import { redactSecrets } from "./errorSanitize.js";

const MAX_TOOL_ROUNDS = 32;

export class GeminiMcpBridge {
  private readonly mcp = new XanoMcpClient();

  constructor(private readonly cfg: BridgeEnv) {}

  /**
   * Connect MCP transport, list tools, run Gemini with function calling,
   * forward each call to Xano MCP, return final natural-language reply.
   */
  async chat(userMessage: string): Promise<string> {
    log.step("bridge.chat.start", { messagePreview: userMessage.slice(0, 120) });

    const authSession = this.cfg.xanoAuthEndpoint ? new AuthSession(this.cfg) : null;
    const transport = createMcpTransport(this.cfg, authSession);

    try {
      await this.mcp.connect(transport);
    } catch (e) {
      const msg = redactSecrets(e instanceof Error ? e.message : String(e));
      throw new Error(
        `MCP connection failed: ${msg}. If login is enabled, verify XANO_AUTH_ENDPOINT and credentials.`
      );
    }

    try {
      const tools = await this.mcp.listTools();
      const declarations = mcpToolsToGeminiDeclarations(tools);

      const genAI = new GoogleGenerativeAI(this.cfg.geminiApiKey);
      const model = genAI.getGenerativeModel({
        model: this.cfg.geminiModel,
        tools:
          declarations.length > 0
            ? [{ functionDeclarations: declarations }]
            : undefined,
      });

      const chat = model.startChat({ history: [] });
      log.step("bridge.gemini.send_message");
      let result = await withGemini429Retry("sendMessage(user)", () =>
        chat.sendMessage(userMessage)
      );
      let response = result.response;

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const calls = extractFunctionCalls(response);
        if (calls.length === 0) {
          const text = readText(response);
          log.step("bridge.chat.final_text", { rounds: round, length: text.length });
          return text || "(empty model reply)";
        }

        log.step("bridge.gemini.function_calls", {
          round,
          names: calls.map((c) => c.name),
        });

        const responseParts: {
          functionResponse: { name: string; response: Record<string, unknown> };
        }[] = [];

        for (const call of calls) {
          let mcpResult;
          try {
            mcpResult = await this.mcp.callTool(call.name, call.args);
          } catch (e) {
            const msg = redactSecrets(e instanceof Error ? e.message : String(e));
            throw new Error(`MCP tool "${call.name}" failed: ${msg}`);
          }
          const geminiPayload = callToolResultToGeminiResponse(mcpResult);
          responseParts.push({
            functionResponse: {
              name: call.name,
              response: geminiPayload,
            },
          });
        }

        log.step("bridge.gemini.send_function_responses", { count: responseParts.length });
        result = await withGemini429Retry("sendMessage(functionResponse)", () =>
          chat.sendMessage(responseParts)
        );
        response = result.response;
      }

      throw new Error(`Tool loop exceeded ${MAX_TOOL_ROUNDS} rounds`);
    } catch (e) {
      const msg = redactSecrets(e instanceof Error ? e.message : String(e));
      throw new Error(msg);
    } finally {
      await this.mcp.close();
      log.step("bridge.chat.done");
    }
  }
}

function extractFunctionCalls(response: {
  candidates?: { content?: { parts?: unknown[] } }[];
}): { name: string; args: Record<string, unknown> }[] {
  const parts = response.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return [];
  const out: { name: string; args: Record<string, unknown> }[] = [];
  for (const p of parts) {
    if (!p || typeof p !== "object") continue;
    const fc = (p as { functionCall?: { name?: string; args?: unknown } }).functionCall;
    if (fc?.name) {
      const args =
        fc.args && typeof fc.args === "object" && !Array.isArray(fc.args)
          ? (fc.args as Record<string, unknown>)
          : {};
      out.push({ name: fc.name, args });
    }
  }
  return out;
}

function readText(response: { text?: () => string; candidates?: unknown }): string {
  try {
    const t = response.text?.();
    if (t && String(t).trim()) return String(t);
  } catch {
    /* only function calls */
  }
  const parts = (response as { candidates?: { content?: { parts?: { text?: string }[] } }[] })
    .candidates?.[0]?.content?.parts;
  if (!parts) return "";
  return parts.map((p) => p.text ?? "").join("");
}
