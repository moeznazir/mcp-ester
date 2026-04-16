import { Router } from "express";
import * as anthropicService from "../services/anthropicService.js";
import * as geminiService from "../services/geminiService.js";
import { getMcpDebugAuthPayload } from "../services/mcpService.js";
import { runWithClientMcpBearer } from "../services/mcpRequestContext.js";

const router = Router();

function bearerFromRequest(req) {
  const h = req.headers.authorization;
  if (typeof h !== "string" || !h.startsWith("Bearer ")) return null;
  const t = h.slice(7).trim();
  return t || null;
}

router.post("/chat", async (req, res) => {
  const clientBearer = bearerFromRequest(req);
  await runWithClientMcpBearer(clientBearer, async () => {
    try {
      const { message, provider = "anthropic", history } = req.body || {};

      if (message == null || !String(message).trim()) {
        return res.status(400).json({ error: "message is required and cannot be empty" });
      }

      const normalizedProvider =
        provider === "gemini" ? "gemini" : "anthropic";

      let reply;
      if (normalizedProvider === "gemini") {
        reply = await geminiService.chat(String(message).trim(), history);
      } else {
        reply = await anthropicService.chat(String(message).trim(), history);
      }

      const payload = {
        reply,
        provider: normalizedProvider,
      };
      if (
        process.env.DEBUG_BROWSER_MCP_TOKEN === "1" &&
        req.body?.debugMcp === true
      ) {
        const dbg = getMcpDebugAuthPayload();
        if (dbg) payload.debug = dbg;
      }
      return res.json(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[/api/chat]", msg);
      return res.status(500).json({ error: msg });
    }
  });
});

export default router;
