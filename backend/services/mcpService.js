/**
 * Shared MCP client: JSON-RPC 2.0 over HTTP to Xano MCP.
 */

let toolsCache = null;
let toolsCachePromise = null;

/** @type {string | null} */
let mcpSessionId = null;
let mcpSessionReady = false;
/** @type {Promise<void> | null} */
let mcpInitPromise = null;

const MCP_PROTOCOL_VERSION = "2024-11-05";

function resetMcpSession() {
  mcpSessionId = null;
  mcpSessionReady = false;
  mcpInitPromise = null;
}

function getMcpConfig() {
  const url = process.env.XANO_MCP_URL;
  const token = process.env.XANO_MCP_TOKEN;
  if (!url || !String(url).trim()) {
    throw new Error("XANO_MCP_URL must be set");
  }
  const trimmedToken = token && String(token).trim() ? String(token).trim() : null;
  return { url: String(url).trim(), token: trimmedToken };
}

function nextRpcId() {
  return Date.now() + Math.floor(Math.random() * 1000);
}

/**
 * Plain JSON-RPC body, or SSE (`data: {...}`) / NDJSON from streamable MCP gateways.
 * @returns {object|null|undefined} parsed JSON-RPC object; null if body empty; undefined if unparseable
 */
function parseMcpResponseBody(text, contentType) {
  const raw = text == null ? "" : String(text);
  if (!raw.trim()) return null;

  try {
    return JSON.parse(raw.trim());
  } catch {
    /* fall through */
  }

  const ct = contentType || "";
  const looksLikeSse =
    ct.includes("text/event-stream") || /^data:\s*\{/m.test(raw) || /^data:\s*\[/m.test(raw);

  if (looksLikeSse || raw.includes("data:")) {
    const lines = raw.split(/\r?\n/);
    let lastRpc = null;
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const obj = JSON.parse(payload);
        if (
          obj &&
          typeof obj === "object" &&
          ("jsonrpc" in obj || "result" in obj || "error" in obj)
        ) {
          lastRpc = obj;
        }
      } catch {
        /* ignore line */
      }
    }
    if (lastRpc) return lastRpc;
  }

  const ndLines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = ndLines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(ndLines[i]);
      if (
        obj &&
        typeof obj === "object" &&
        ("result" in obj || "error" in obj || obj.jsonrpc === "2.0")
      ) {
        return obj;
      }
    } catch {
      /* continue */
    }
  }

  return undefined;
}

function buildMcpHeaders() {
  const { token } = getMcpConfig();
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (mcpSessionId) {
    headers["Mcp-Session-Id"] = mcpSessionId;
  }
  return headers;
}

function readSessionIdFromResponse(res, json) {
  const fromHeader =
    res.headers.get("mcp-session-id") ||
    res.headers.get("Mcp-Session-Id") ||
    res.headers.get("MCP-Session-Id");
  if (fromHeader) return fromHeader.trim();

  const r = json?.result;
  if (r && typeof r === "object") {
    if (typeof r.sessionId === "string") return r.sessionId;
    if (typeof r.session_id === "string") return r.session_id;
  }
  return null;
}

/**
 * MCP requires initialize + notifications/initialized before tools/list and tools/call.
 */
async function ensureMcpSession() {
  if (mcpSessionReady) return;
  if (!mcpInitPromise) {
    mcpInitPromise = (async () => {
      try {
        const { url } = getMcpConfig();
        const baseHeaders = buildMcpHeaders();

        const initBody = {
          jsonrpc: "2.0",
          id: nextRpcId(),
          method: "initialize",
          params: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: {
              name: "xano-mcp-ai-chat",
              version: "1.0.0",
            },
          },
        };

        let res;
        try {
          res = await fetch(url, {
            method: "POST",
            headers: baseHeaders,
            body: JSON.stringify(initBody),
          });
        } catch (err) {
          throw new Error(
            `MCP server unreachable: ${err instanceof Error ? err.message : String(err)}`
          );
        }

        const initText = await res.text();
        const initContentType = res.headers.get("content-type") || "";
        const initJson = parseMcpResponseBody(initText, initContentType);

        if (initJson === undefined && initText.trim()) {
          throw new Error(
            `MCP initialize: invalid response (${res.status}): ${initText.slice(0, 200)}`
          );
        }

        if (!res.ok) {
          const msg =
            initJson?.error?.message ||
            initJson?.message ||
            `HTTP ${res.status}: ${initText.slice(0, 200)}`;
          throw new Error(`MCP HTTP error: ${msg}`);
        }

        if (initJson?.error) {
          const e = initJson.error;
          const msg =
            typeof e === "string" ? e : e.message || JSON.stringify(e);
          throw new Error(`MCP error: ${msg}`);
        }

        const sid = readSessionIdFromResponse(res, initJson);
        if (sid) mcpSessionId = sid;

        const notifHeaders = buildMcpHeaders();
        const notifBody = {
          jsonrpc: "2.0",
          method: "notifications/initialized",
          params: {},
        };

        try {
          res = await fetch(url, {
            method: "POST",
            headers: notifHeaders,
            body: JSON.stringify(notifBody),
          });
        } catch (err) {
          throw new Error(
            `MCP server unreachable (initialized): ${err instanceof Error ? err.message : String(err)}`
          );
        }

        const notifText = await res.text();
        const notifCt = res.headers.get("content-type") || "";
        const notifJson = notifText.trim()
          ? parseMcpResponseBody(notifText, notifCt)
          : null;

        if (!res.ok) {
          const msg =
            notifJson?.error?.message ||
            notifJson?.message ||
            `HTTP ${res.status}: ${notifText.slice(0, 200)}`;
          throw new Error(`MCP HTTP error (initialized): ${msg}`);
        }

        if (notifJson?.error) {
          const e = notifJson.error;
          const msg =
            typeof e === "string" ? e : e.message || JSON.stringify(e);
          throw new Error(`MCP error (initialized): ${msg}`);
        }

        mcpSessionReady = true;
      } catch (err) {
        mcpSessionId = null;
        mcpSessionReady = false;
        throw err;
      } finally {
        mcpInitPromise = null;
      }
    })();
  }
  await mcpInitPromise;
}

/**
 * POST JSON-RPC to MCP endpoint (after session is initialized).
 * @param {string} method
 * @param {object} params
 */
async function mcpRequestOnce(method, params = {}) {
  const { url } = getMcpConfig();
  const id = nextRpcId();
  const body = {
    jsonrpc: "2.0",
    id,
    method,
    params,
  };

  const headers = buildMcpHeaders();

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `MCP server unreachable: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const text = await res.text();
  const contentType = res.headers.get("content-type") || "";
  const json = parseMcpResponseBody(text, contentType);
  if (json === undefined) {
    throw new Error(
      `MCP invalid JSON response (${res.status}): ${text.slice(0, 200)}`
    );
  }

  if (!res.ok) {
    const msg =
      json?.error?.message ||
      json?.message ||
      `HTTP ${res.status}: ${text.slice(0, 200)}`;
    throw new Error(`MCP HTTP error: ${msg}`);
  }

  if (json?.error) {
    const e = json.error;
    const msg =
      typeof e === "string"
        ? e
        : e.message || JSON.stringify(e);
    throw new Error(`MCP error: ${msg}`);
  }

  return json?.result;
}

async function mcpRequest(method, params = {}) {
  await ensureMcpSession();
  try {
    return await mcpRequestOnce(method, params);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not initialized") || msg.includes("Server not initialized")) {
      resetMcpSession();
      toolsCache = null;
      toolsCachePromise = null;
      await ensureMcpSession();
      return await mcpRequestOnce(method, params);
    }
    throw err;
  }
}

/**
 * Normalize tools/list result to an array of { name, description, inputSchema }.
 */
function normalizeToolsList(result) {
  if (!result) return [];
  if (Array.isArray(result.tools)) return result.tools;
  if (Array.isArray(result)) return result;
  return [];
}

/**
 * Extract usable text/content from tools/call result for the model.
 */
function stringifyToolResult(result) {
  if (result == null) return "";
  if (typeof result === "string") return result;

  const content = result.content;
  if (Array.isArray(content)) {
    const parts = content.map((c) => {
      if (typeof c === "string") return c;
      if (c?.type === "text" && c.text != null) return String(c.text);
      if (c?.text != null) return String(c.text);
      return JSON.stringify(c);
    });
    return parts.join("\n");
  }

  if (result.isError && result.message) {
    return String(result.message);
  }

  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

/**
 * @returns {Promise<Array<{ name: string, description?: string, inputSchema?: object }>>}
 */
export async function fetchMcpTools({ forceRefresh = false } = {}) {
  if (!forceRefresh && toolsCache) {
    return toolsCache;
  }
  if (!forceRefresh && toolsCachePromise) {
    return toolsCachePromise;
  }

  const run = async () => {
    const result = await mcpRequest("tools/list", {});
    const tools = normalizeToolsList(result);
    toolsCache = tools;
    return tools;
  };

  toolsCachePromise = run()
    .catch((err) => {
      toolsCachePromise = null;
      throw err;
    })
    .finally(() => {
      toolsCachePromise = null;
    });

  return toolsCachePromise;
}

/**
 * @param {string} toolName
 * @param {object} toolArgs
 * @returns {Promise<string>}
 */
export async function callMcpTool(toolName, toolArgs) {
  try {
    const result = await mcpRequest("tools/call", {
      name: toolName,
      arguments: toolArgs && typeof toolArgs === "object" ? toolArgs : {},
    });
    return stringifyToolResult(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `MCP tool error (${toolName}): ${msg}`;
  }
}

export function clearToolsCache() {
  toolsCache = null;
  toolsCachePromise = null;
  resetMcpSession();
}
