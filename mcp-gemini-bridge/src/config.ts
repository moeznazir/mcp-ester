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
  /** Optional Xano login URL — when set, username/password required */
  xanoAuthEndpoint: string;
  xanoUsername: string;
  xanoPassword: string;
  /** Default TTL when login response has no expires_in */
  tokenExpirySeconds: number;
  /** Optional refresh URL */
  xanoRefreshEndpoint: string;
  /** Optional JSON template for refresh POST body; use {{REFRESH_TOKEN}} */
  xanoRefreshBodyTemplate: string;
  /** Optional JSON for login; {{USERNAME}} / {{PASSWORD}} */
  xanoAuthLoginBodyTemplate: string;
  /** Field name for username in default login JSON (default `email`) */
  xanoAuthUserField: string;
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

  const xanoAuthEndpoint = (process.env.XANO_AUTH_ENDPOINT ?? "").trim();
  const xanoUsername = (process.env.XANO_USERNAME ?? "").trim();
  const xanoPassword = (process.env.XANO_PASSWORD ?? "").trim();
  const tokenExpirySecondsRaw = process.env.TOKEN_EXPIRY_SECONDS;
  let tokenExpirySeconds = 3600;
  if (tokenExpirySecondsRaw != null && String(tokenExpirySecondsRaw).trim() !== "") {
    const n = parseInt(String(tokenExpirySecondsRaw), 10);
    tokenExpirySeconds = Number.isFinite(n) ? Math.max(60, n) : 3600;
  }

  const xanoRefreshEndpoint = (process.env.XANO_REFRESH_ENDPOINT ?? "").trim();
  const xanoRefreshBodyTemplate = (process.env.XANO_REFRESH_BODY ?? "").trim();
  const xanoAuthLoginBodyTemplate = (process.env.XANO_AUTH_LOGIN_BODY ?? "").trim();
  const xanoAuthUserField = (process.env.XANO_AUTH_USER_FIELD ?? "email").trim() || "email";

  if (xanoAuthEndpoint) {
    requireNonEmpty("XANO_USERNAME", xanoUsername);
    requireNonEmpty("XANO_PASSWORD", xanoPassword);
  }

  log.step("config.loaded", {
    xanoMcpUrl: maskUrl(xanoMcpUrl),
    hasXanoApiKey: Boolean(xanoApiKey),
    mcpTransport,
    xanoAuthMode,
    geminiModel,
    mcpStdioCommand: mcpTransport === "stdio" ? mcpStdioCommand : undefined,
    xanoAuthEnabled: Boolean(xanoAuthEndpoint),
    tokenExpirySeconds,
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
    xanoAuthEndpoint,
    xanoUsername,
    xanoPassword,
    tokenExpirySeconds,
    xanoRefreshEndpoint,
    xanoRefreshBodyTemplate,
    xanoAuthLoginBodyTemplate,
    xanoAuthUserField,
  };
}

export function maskUrl(u: string): string {
  try {
    const url = new URL(u);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "(invalid URL)";
  }
}

/**
 * Static headers for MCP HTTP transports. When password login is configured,
 * `Authorization: Bearer` is added by the authenticated fetch + AuthSession, not here.
 */
export function mcpStaticHeaders(cfg: BridgeEnv): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/json, text/event-stream",
  };
  const passwordAuth = Boolean(cfg.xanoAuthEndpoint);
  if (!cfg.xanoApiKey) return h;
  if (cfg.xanoAuthMode === "apikey") {
    h["X-API-Key"] = cfg.xanoApiKey;
  } else if (!passwordAuth) {
    h.Authorization = `Bearer ${cfg.xanoApiKey}`;
  }
  return h;
}

/** @deprecated use {@link mcpStaticHeaders} */
export function authHeaders(cfg: BridgeEnv): Record<string, string> {
  return mcpStaticHeaders(cfg);
}
