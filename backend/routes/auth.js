import { Router } from "express";
import { extractTokensFromLoginResponse } from "../services/xanoLoginSession.js";

const router = Router();

const DEFAULT_LOGIN_URL =
  "https://api.dealdetails.com/api:e_5dMhMN:mcp-v1/auth/login";

function loginUrl() {
  const u = process.env.USER_AUTH_LOGIN_URL?.trim();
  return u || DEFAULT_LOGIN_URL;
}

router.post("/auth/login", async (req, res) => {
  try {
    const email =
      req.body?.email != null ? String(req.body.email).trim() : "";
    const password =
      req.body?.password != null ? String(req.body.password) : "";

    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }
    if (!password) {
      return res.status(400).json({ error: "password is required" });
    }

    const url = loginUrl();
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    const text = await upstream.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      return res.status(502).json({
        error: "Login service returned invalid JSON",
      });
    }

    if (!upstream.ok) {
      const msg =
        (data && typeof data === "object" && data.message) ||
        (data && typeof data === "object" && data.error) ||
        `Login failed (HTTP ${upstream.status})`;
      return res.status(upstream.status === 401 ? 401 : 400).json({
        error: typeof msg === "string" ? msg : String(msg),
      });
    }

    const tokens = extractTokensFromLoginResponse(data);
    if (!tokens?.accessToken) {
      return res.status(502).json({
        error:
          "Login succeeded but no auth token was found in the response. Check API response shape.",
      });
    }

    return res.json({
      token: tokens.accessToken,
      expiresInSeconds: tokens.expiresInSeconds ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/auth/login]", msg);
    return res.status(500).json({ error: msg });
  }
});

export default router;
