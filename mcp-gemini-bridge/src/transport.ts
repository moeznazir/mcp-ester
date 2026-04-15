import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { BridgeEnv } from "./config.js";
import { authHeaders } from "./config.js";
import { log } from "./logger.js";

/**
 * Build MCP SDK {@link Transport}: Streamable HTTP (default for Xano), legacy SSE, or stdio.
 */
export function createMcpTransport(cfg: BridgeEnv): Transport {
  const baseInit: RequestInit = {
    headers: authHeaders(cfg),
  };

  if (cfg.mcpTransport === "stdio") {
    log.step("transport.stdio", { command: cfg.mcpStdioCommand, args: cfg.mcpStdioArgs });
    return new StdioClientTransport({
      command: cfg.mcpStdioCommand,
      args: cfg.mcpStdioArgs.length ? cfg.mcpStdioArgs : undefined,
    });
  }

  if (cfg.mcpTransport === "sse") {
    const url = new URL(cfg.xanoMcpUrl);
    log.step("transport.sse", { url: url.origin + url.pathname });
    return new SSEClientTransport(url, {
      requestInit: baseInit,
      eventSourceInit: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            headers: {
              ...Object.fromEntries(new Headers(init?.headers)),
              ...authHeaders(cfg),
            },
          }),
      },
    });
  }

  const url = new URL(cfg.xanoMcpUrl);
  log.step("transport.streamable_http", { url: url.origin + url.pathname });
  return new StreamableHTTPClientTransport(url, {
    requestInit: baseInit,
  });
}
