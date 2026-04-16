import type { BridgeEnv } from "./config.js";
import { maskUrl } from "./config.js";
import { log } from "./logger.js";

export type LoginTokens = {
  accessToken: string;
  refreshToken?: string;
  /** Server hint; falls back to env default */
  expiresInSeconds?: number;
};

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function dig(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const p of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/**
 * Best-effort extraction of access / refresh / expiry from typical Xano or OAuth-shaped JSON.
 */
export function extractTokensFromLoginResponse(data: unknown): LoginTokens | null {
  if (!data || typeof data !== "object") return null;
  const root = data as Record<string, unknown>;

  const candidates = [
    pickString(root, ["access_token", "accessToken", "token", "authToken", "auth_token", "jwt"]),
    typeof dig(data, ["data", "token"]) === "string"
      ? String(dig(data, ["data", "token"]))
      : undefined,
    typeof dig(data, ["auth", "access_token"]) === "string"
      ? String(dig(data, ["auth", "access_token"]))
      : undefined,
    typeof dig(data, ["result", "authToken"]) === "string"
      ? String(dig(data, ["result", "authToken"]))
      : undefined,
  ].filter(Boolean) as string[];

  const accessToken = candidates[0];
  if (!accessToken) return null;

  const refresh =
    pickString(root, ["refresh_token", "refreshToken"]) ||
    (typeof dig(data, ["data", "refresh_token"]) === "string"
      ? String(dig(data, ["data", "refresh_token"]))
      : undefined);

  let expiresInSeconds: number | undefined;
  const expRaw =
    root.expires_in ?? root.expiresIn ?? dig(data, ["data", "expires_in"]);
  if (typeof expRaw === "number" && Number.isFinite(expRaw)) {
    expiresInSeconds = Math.max(1, Math.floor(expRaw));
  } else if (typeof expRaw === "string" && /^\d+$/.test(expRaw)) {
    expiresInSeconds = Math.max(1, parseInt(expRaw, 10));
  }

  return { accessToken, refreshToken: refresh, expiresInSeconds };
}

function buildLoginBody(cfg: BridgeEnv): Record<string, unknown> {
  const template = cfg.xanoAuthLoginBodyTemplate?.trim();
  if (template) {
    const json = template
      .replaceAll("{{USERNAME}}", cfg.xanoUsername ?? "")
      .replaceAll("{{PASSWORD}}", cfg.xanoPassword ?? "");
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error("XANO_AUTH_LOGIN_BODY must be valid JSON after placeholder substitution.");
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error("XANO_AUTH_LOGIN_BODY must be a JSON object");
  }
  const userField = cfg.xanoAuthUserField || "email";
  return {
    [userField]: cfg.xanoUsername,
    password: cfg.xanoPassword,
  };
}

export async function loginWithPassword(cfg: BridgeEnv): Promise<LoginTokens> {
  const url = cfg.xanoAuthEndpoint;
  if (!url) {
    throw new Error("XANO_AUTH_ENDPOINT is not configured");
  }
  const body = buildLoginBody(cfg);
  log.step("xano.auth.login.request", {
    url: maskUrl(url),
    bodyKeys: Object.keys(body),
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    log.step("xano.auth.login.http_error", { status: res.status });
    throw new Error(
      `Xano authentication failed (HTTP ${res.status}). Check credentials and XANO_AUTH_ENDPOINT.`
    );
  }

  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("Xano authentication response was not valid JSON.");
  }

  const tokens = extractTokensFromLoginResponse(data);
  if (!tokens?.accessToken) {
    log.step("xano.auth.login.parse_error", { hint: "no access token field recognized" });
    throw new Error(
      "Xano authentication succeeded but no access token was found in the response. Set XANO_AUTH_LOGIN_BODY or adjust the API response shape."
    );
  }

  log.step("xano.auth.login.ok", {
    hasRefresh: Boolean(tokens.refreshToken),
    expiresInSeconds: tokens.expiresInSeconds,
    tokenChars: tokens.accessToken.length,
  });
  return tokens;
}

export async function refreshAccessToken(
  cfg: BridgeEnv,
  refreshToken: string
): Promise<LoginTokens> {
  const url = cfg.xanoRefreshEndpoint;
  if (!url || !refreshToken) {
    throw new Error("Refresh not configured or missing refresh token");
  }
  log.step("xano.auth.refresh.request", { url: maskUrl(url) });

  let body: Record<string, unknown>;
  const tpl = cfg.xanoRefreshBodyTemplate?.trim();
  if (tpl) {
    try {
      const json = tpl.replaceAll("{{REFRESH_TOKEN}}", refreshToken);
      const parsed = JSON.parse(json) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("not an object");
      }
      body = parsed as Record<string, unknown>;
    } catch {
      throw new Error("XANO_REFRESH_BODY must be valid JSON with optional {{REFRESH_TOKEN}} placeholder.");
    }
  } else {
    body = { refresh_token: refreshToken };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    log.step("xano.auth.refresh.http_error", { status: res.status });
    throw new Error(`Xano token refresh failed (HTTP ${res.status}).`);
  }

  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("Token refresh response was not valid JSON.");
  }
  const tokens = extractTokensFromLoginResponse(data);
  if (!tokens?.accessToken) {
    throw new Error("Token refresh response did not include an access token.");
  }
  log.step("xano.auth.refresh.ok", { tokenChars: tokens.accessToken.length });
  return tokens;
}
