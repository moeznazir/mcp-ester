import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { log } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type McpTransportName = "streamable" | "sse" | "stdio";
export type XanoAuthMode = "bearer" | "apikey";

export interface BridgeEnv {
  xanoMcpUrl: string;
  xanoApiKey: string;
  geminiApiKey: string;
  mcpTransport: McpTransportName;
  xanoAuthMode: XanoAuthMode;
  geminiModel: string;
  /** stdio transport only */
  mcpStdioCommand: string;
  mcpStdioArgs: string[];
}

function requireNonEmpty(name: string, value: string | undefined): string {
  const v = value?.trim();
  if (!v) {
    throw new Error(`Missing or empty required env: ${name}`);
  }
  return v;
}

export function loadConfig(): BridgeEnv {
  dotenv.config({ path: path.join(__dirname, "..", ".env") });
  dotenv.config(); // cwd fallback

  const rawTransport = (process.env.MCP_TRANSPORT ?? "streamable").toLowerCase();
  const mcpTransport: McpTransportName =
    rawTransport === "sse" ? "sse" : rawTransport === "stdio" ? "stdio" : "streamable";

  const xanoMcpUrl =
    mcpTransport === "stdio"
      ? (process.env.XANO_MCP_URL ?? "").trim()
      : requireNonEmpty("XANO_MCP_URL", process.env.XANO_MCP_URL);

  const geminiApiKey = requireNonEmpty("GEMINI_API_KEY", process.env.GEMINI_API_KEY);

  const xanoApiKey = (process.env.XANO_API_KEY ?? "").trim();

  const authRaw = (process.env.XANO_AUTH_MODE ?? "bearer").toLowerCase();
  const xanoAuthMode: XanoAuthMode = authRaw === "apikey" ? "apikey" : "bearer";

  const geminiModel = (process.env.GEMINI_MODEL ?? "gemini-3-flash-preview").trim();

  let mcpStdioCommand = (process.env.MCP_STDIO_COMMAND ?? "").trim();
  let mcpStdioArgs: string[] = [];
  if (process.env.MCP_STDIO_ARGS) {
    try {
      const parsed = JSON.parse(process.env.MCP_STDIO_ARGS) as unknown;
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
        mcpStdioArgs = parsed;
      }
    } catch {
      log.error("config", new Error("MCP_STDIO_ARGS must be a JSON array of strings"));
    }
  }

  if (mcpTransport === "stdio") {
    mcpStdioCommand = requireNonEmpty("MCP_STDIO_COMMAND", mcpStdioCommand);
  }

  log.step("config.loaded", {
    xanoMcpUrl: maskUrl(xanoMcpUrl),
    hasXanoApiKey: Boolean(xanoApiKey),
    mcpTransport,
    xanoAuthMode,
    geminiModel,
    mcpStdioCommand: mcpTransport === "stdio" ? mcpStdioCommand : undefined,
  });

  return {
    xanoMcpUrl,
    xanoApiKey,
    geminiApiKey,
    mcpTransport,
    xanoAuthMode,
    geminiModel,
    mcpStdioCommand,
    mcpStdioArgs,
  };
}

function maskUrl(u: string): string {
  try {
    const url = new URL(u);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "(invalid URL)";
  }
}

export function authHeaders(cfg: BridgeEnv): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/json, text/event-stream",
  };
  if (!cfg.xanoApiKey) return h;
  if (cfg.xanoAuthMode === "apikey") {
    h["X-API-Key"] = cfg.xanoApiKey;
  } else {
    h.Authorization = `Bearer ${cfg.xanoApiKey}`;
  }
  return h;
}
