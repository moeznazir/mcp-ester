import { Router } from "express";
import { getMcpDebugAuthPayload } from "../services/mcpService.js";
import {
  getClientMcpBearer,
  runWithClientMcpBearer,
} from "../services/mcpRequestContext.js";
import { ensureXanoAccessToken } from "../services/xanoLoginSession.js";

const router = Router();

function bearerFromRequest(req) {
  const h = req.headers.authorization;
  if (typeof h !== "string" || !h.startsWith("Bearer ")) return null;
  const t = h.slice(7).trim();
  return t || null;
}

/**
 * GET /api/debug/mcp-auth — only when DEBUG_BROWSER_MCP_TOKEN=1 in backend/.env.
 * Lets the frontend log the MCP Bearer in the browser console (unsafe; dev only).
 */
router.get("/debug/mcp-auth", async (req, res) => {
  if (process.env.DEBUG_BROWSER_MCP_TOKEN !== "1") {
    return res.status(404).json({ error: "MCP browser debug is disabled on the server." });
  }
  const clientBearer = bearerFromRequest(req);
  await runWithClientMcpBearer(clientBearer, async () => {
    try {
      if (!getClientMcpBearer()?.trim()) {
        await ensureXanoAccessToken();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return res.status(500).json({ error: `MCP auth not ready: ${msg}` });
    }
    const payload = getMcpDebugAuthPayload();
    if (!payload) {
      return res.status(500).json({ error: "MCP debug payload unavailable." });
    }
    return res.json(payload);
  });
});

export default router;
