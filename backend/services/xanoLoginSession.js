/**
 * In-memory Xano login session for the Express MCP client.
 * When XANO_AUTH_ENDPOINT + credentials are set, obtains a Bearer access token
 * and uses it on every MCP request (Xano request logs should show Authorization).
 */

let accessToken = null;
let refreshToken = null;
let accessExpiresAt = null;

function loginConfigured() {
  const ep = process.env.XANO_AUTH_ENDPOINT?.trim();
  const u = process.env.XANO_USERNAME?.trim();
  const p = process.env.XANO_PASSWORD?.trim();
  return Boolean(ep && u && p);
}

function tokenExpirySeconds() {
  const raw = process.env.TOKEN_EXPIRY_SECONDS;
  if (raw == null || String(raw).trim() === "") return 3600;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) ? Math.max(60, n) : 3600;
}

function decodeJwtExpMs(jwt) {
  const parts = String(jwt).split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (typeof payload.exp === "number" && Number.isFinite(payload.exp)) {
      return payload.exp * 1000;
    }
  } catch {
    return null;
  }
  return null;
}

function pickString(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function dig(obj, path) {
  let cur = obj;
  for (const p of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

export function extractTokensFromLoginResponse(data) {
  if (!data || typeof data !== "object") return null;
  const root = data;
  const candidates = [
    pickString(root, ["access_token", "accessToken", "token", "authToken", "auth_token", "jwt"]),
    typeof dig(data, ["data", "token"]) === "string" ? String(dig(data, ["data", "token"])) : undefined,
    typeof dig(data, ["auth", "access_token"]) === "string"
      ? String(dig(data, ["auth", "access_token"]))
      : undefined,
    typeof dig(data, ["result", "authToken"]) === "string"
      ? String(dig(data, ["result", "authToken"]))
      : undefined,
  ].filter(Boolean);

  const tok = candidates[0];
  if (!tok) return null;

  const refresh =
    pickString(root, ["refresh_token", "refreshToken"]) ||
    (typeof dig(data, ["data", "refresh_token"]) === "string"
      ? String(dig(data, ["data", "refresh_token"]))
      : undefined);

  let expiresInSeconds;
  const expRaw = root.expires_in ?? root.expiresIn ?? dig(data, ["data", "expires_in"]);
  if (typeof expRaw === "number" && Number.isFinite(expRaw)) {
    expiresInSeconds = Math.max(1, Math.floor(expRaw));
  } else if (typeof expRaw === "string" && /^\d+$/.test(expRaw)) {
    expiresInSeconds = Math.max(1, parseInt(expRaw, 10));
  }

  return { accessToken: tok, refreshToken: refresh, expiresInSeconds };
}

function buildLoginBody() {
  const template = process.env.XANO_AUTH_LOGIN_BODY?.trim();
  const user = process.env.XANO_USERNAME?.trim() ?? "";
  const pass = process.env.XANO_PASSWORD?.trim() ?? "";
  if (template) {
    const json = template.replaceAll("{{USERNAME}}", user).replaceAll("{{PASSWORD}}", pass);
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("XANO_AUTH_LOGIN_BODY must be a JSON object");
    }
    return parsed;
  }
  const userField = process.env.XANO_AUTH_USER_FIELD?.trim() || "email";
  return { [userField]: user, password: pass };
}

async function refreshAccessToken() {
  const url = process.env.XANO_REFRESH_ENDPOINT?.trim();
  if (!url || !refreshToken) throw new Error("refresh not configured");
  const tpl = process.env.XANO_REFRESH_BODY?.trim();
  let body;
  if (tpl) {
    body = JSON.parse(tpl.replaceAll("{{REFRESH_TOKEN}}", refreshToken));
  } else {
    body = { refresh_token: refreshToken };
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`refresh HTTP ${res.status}`);
  const data = text ? JSON.parse(text) : null;
  const t = extractTokensFromLoginResponse(data);
  if (!t?.accessToken) throw new Error("refresh: no access token");
  return t;
}

async function passwordLogin() {
  const url = process.env.XANO_AUTH_ENDPOINT?.trim();
  const body = buildLoginBody();
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Xano login failed (HTTP ${res.status}). Check XANO_AUTH_ENDPOINT, XANO_USERNAME, XANO_PASSWORD.`
    );
  }
  const data = text ? JSON.parse(text) : null;
  const t = extractTokensFromLoginResponse(data);
  if (!t?.accessToken) {
    throw new Error(
      "Xano login succeeded but no access token was found in JSON. Set XANO_AUTH_LOGIN_BODY if the shape differs."
    );
  }
  return t;
}

function storeTokens(t) {
  accessToken = t.accessToken;
  if (t.refreshToken) refreshToken = t.refreshToken;
  const ttl =
    typeof t.expiresInSeconds === "number" && t.expiresInSeconds > 0
      ? t.expiresInSeconds
      : tokenExpirySeconds();
  let expiresAt = Date.now() + ttl * 1000;
  const jwtExp = decodeJwtExpMs(t.accessToken);
  if (jwtExp != null) expiresAt = Math.min(expiresAt, jwtExp);
  accessExpiresAt = expiresAt;
}

function hasValidToken() {
  if (!accessToken) return false;
  if (!accessExpiresAt) return true;
  return Date.now() < accessExpiresAt - 5000;
}

export function loginSessionEnabled() {
  return loginConfigured();
}

export function invalidateXanoLoginSession() {
  accessToken = null;
  refreshToken = null;
  accessExpiresAt = null;
}

/**
 * Bearer from login session (if enabled). Does not include XANO_MCP_TOKEN.
 */
export function getLoginSessionBearer() {
  if (!loginConfigured()) return null;
  return hasValidToken() ? accessToken : null;
}

/**
 * Ensures login access token is present when password auth is configured.
 */
export async function ensureXanoAccessToken() {
  if (!loginConfigured()) return;
  if (hasValidToken()) return;

  if (refreshToken && process.env.XANO_REFRESH_ENDPOINT?.trim()) {
    try {
      const t = await refreshAccessToken();
      storeTokens(t);
      return;
    } catch {
      refreshToken = null;
    }
  }

  const t = await passwordLogin();
  storeTokens(t);
}
