import { AsyncLocalStorage } from "node:async_hooks";

const als = new AsyncLocalStorage();

/**
 * Runs `fn` so MCP calls use this Bearer (user login token) for Xano MCP requests.
 * When null/empty, MCP falls back to server env login / XANO_MCP_TOKEN.
 * @param {string | null | undefined} bearerToken
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function runWithClientMcpBearer(bearerToken, fn) {
  const trimmed =
    bearerToken && typeof bearerToken === "string" ? bearerToken.trim() : "";
  return als.run({ bearer: trimmed || null }, fn);
}

/** @returns {string | null} */
export function getClientMcpBearer() {
  const s = als.getStore();
  return s?.bearer ?? null;
}
