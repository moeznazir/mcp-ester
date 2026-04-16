import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { BridgeEnv } from "./config.js";
import { mcpStaticHeaders } from "./config.js";
import type { AuthSession } from "./authSession.js";
import { createAuthenticatedFetch } from "./authenticatedFetch.js";
import { log } from "./logger.js";

/**
 * Build MCP SDK {@link Transport}: Streamable HTTP (default for Xano), legacy SSE, or stdio.
 * When `authSession` is set, MCP HTTP requests use login Bearer + 401 re-auth (stdio unchanged).
 */
export function createMcpTransport(cfg: BridgeEnv, authSession: AuthSession | null): Transport {
  if (cfg.mcpTransport === "stdio") {
    log.step("transport.stdio", { command: cfg.mcpStdioCommand, args: cfg.mcpStdioArgs });
    if (authSession?.enabled()) {
      log.step("transport.stdio.auth_skipped", {
        note: "Password auth injection applies to HTTP transports only",
      });
    }
    return new StdioClientTransport({
      command: cfg.mcpStdioCommand,
      args: cfg.mcpStdioArgs.length ? cfg.mcpStdioArgs : undefined,
    });
  }

  const authedFetch = createAuthenticatedFetch(cfg, authSession);

  if (cfg.mcpTransport === "sse") {
    const url = new URL(cfg.xanoMcpUrl);
    log.step("transport.sse", { url: url.origin + url.pathname });
    return new SSEClientTransport(url, {
      requestInit: { headers: mcpStaticHeaders(cfg) },
      fetch: authedFetch,
      eventSourceInit: {
        fetch: authedFetch,
      },
    });
  }

  const url = new URL(cfg.xanoMcpUrl);
  log.step("transport.streamable_http", { url: url.origin + url.pathname });
  return new StreamableHTTPClientTransport(url, {
    requestInit: { headers: mcpStaticHeaders(cfg) },
    fetch: authedFetch,
  });
}
