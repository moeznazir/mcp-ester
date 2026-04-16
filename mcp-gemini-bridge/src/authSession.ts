import type { BridgeEnv } from "./config.js";
import { loginWithPassword, refreshAccessToken, type LoginTokens } from "./xanoAuthClient.js";
import { log } from "./logger.js";

function decodeJwtExpMs(jwt: string): number | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      exp?: number;
    };
    if (typeof payload.exp === "number" && Number.isFinite(payload.exp)) {
      return payload.exp * 1000;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * In-memory session for Xano login tokens (never logged in full).
 */
export class AuthSession {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  /** epoch ms when access token should be treated as expired */
  private accessExpiresAt: number | null = null;

  constructor(private readonly cfg: BridgeEnv) {}

  enabled(): boolean {
    return Boolean(this.cfg.xanoAuthEndpoint);
  }

  hasValidToken(): boolean {
    if (!this.accessToken) return false;
    if (!this.accessExpiresAt) return true;
    return Date.now() < this.accessExpiresAt - 5000;
  }

  getBearerForMcp(): string | null {
    if (!this.enabled()) return null;
    return this.accessToken;
  }

  invalidate(): void {
    log.step("xano.auth.session.invalidate");
    this.accessToken = null;
    this.refreshToken = null;
    this.accessExpiresAt = null;
  }

  /**
   * Ensures a valid access token before MCP traffic. Login or refresh as needed.
   */
  async ensureValidToken(): Promise<void> {
    if (!this.enabled()) return;
    if (this.hasValidToken()) {
      log.step("xano.auth.session.token_ok");
      return;
    }
    await this.acquireFreshToken();
  }

  private setFromLoginTokens(t: LoginTokens): void {
    this.accessToken = t.accessToken;
    if (t.refreshToken) this.refreshToken = t.refreshToken;
    const ttl =
      typeof t.expiresInSeconds === "number" && t.expiresInSeconds > 0
        ? t.expiresInSeconds
        : this.cfg.tokenExpirySeconds;
    let expiresAt = Date.now() + ttl * 1000;
    const jwtExp = decodeJwtExpMs(t.accessToken);
    if (jwtExp != null) {
      expiresAt = Math.min(expiresAt, jwtExp);
    }
    this.accessExpiresAt = expiresAt;
    log.step("xano.auth.session.stored", {
      ttlSeconds: ttl,
      hasRefresh: Boolean(this.refreshToken),
      tokenLength: this.accessToken.length,
    });
  }

  private async acquireFreshToken(): Promise<void> {
    if (this.refreshToken && this.cfg.xanoRefreshEndpoint) {
      try {
        log.step("xano.auth.session.refresh_attempt");
        const t = await refreshAccessToken(this.cfg, this.refreshToken);
        this.setFromLoginTokens(t);
        return;
      } catch (e) {
        log.error("xano.auth.session.refresh_failed", e);
        this.refreshToken = null;
      }
    }

    log.step("xano.auth.session.password_login");
    const t = await loginWithPassword(this.cfg);
    this.setFromLoginTokens(t);
  }
}
