import type { BridgeEnv } from "./config.js";
import { mcpStaticHeaders } from "./config.js";
import type { AuthSession } from "./authSession.js";
import { log } from "./logger.js";

type FetchLike = typeof fetch;

/**
 * Wraps `fetch` so every MCP HTTP call:
 * - runs `AuthSession.ensureValidToken()` when password auth is enabled
 * - sends `Authorization: Bearer <session token>`
 * - on HTTP 401, invalidates session, re-authenticates once, retries the same request
 */
export function createAuthenticatedFetch(
  cfg: BridgeEnv,
  session: AuthSession | null,
  inner: FetchLike = globalThis.fetch.bind(globalThis)
): FetchLike {
  return async (input, init) => {
    const exec = async (allow401Retry: boolean): Promise<Response> => {
      if (session?.enabled()) {
        await session.ensureValidToken();
      }

      const headers = new Headers(init?.headers);
      const base = mcpStaticHeaders(cfg);
      for (const [k, v] of Object.entries(base)) {
        if (!headers.has(k)) headers.set(k, v);
      }

      if (session?.enabled()) {
        const bearer = session.getBearerForMcp();
        if (bearer) {
          headers.set("Authorization", `Bearer ${bearer}`);
        }
      }

      if (process.env.MCP_LOG_AUTH_HEADERS === "1") {
        const names = [...headers.keys()].sort();
        log.step("mcp.fetch.outgoing_headers", {
          url: String(input).slice(0, 160),
          headerNames: names,
          hasAuthorization: headers.has("authorization"),
          bearerLength: session?.enabled()
            ? session.getBearerForMcp()?.length ?? 0
            : 0,
        });
      }

      const res = await inner(input, { ...init, headers });

      if (res.status === 401 && session?.enabled() && allow401Retry) {
        log.step("xano.auth.mcp.401_retry", { url: String(input).slice(0, 120) });
        session.invalidate();
        await session.ensureValidToken();
        const headers2 = new Headers(init?.headers);
        for (const [k, v] of Object.entries(mcpStaticHeaders(cfg))) {
          if (!headers2.has(k)) headers2.set(k, v);
        }
        const bearer2 = session.getBearerForMcp();
        if (bearer2) headers2.set("Authorization", `Bearer ${bearer2}`);
        return inner(input, { ...init, headers: headers2 });
      }

      return res;
    };

    return exec(true);
  };
}
