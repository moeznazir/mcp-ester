import { Router } from "express";
import * as anthropicService from "../services/anthropicService.js";
import * as geminiService from "../services/geminiService.js";

const router = Router();

router.post("/chat", async (req, res) => {
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

    return res.json({
      reply,
      provider: normalizedProvider,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/chat]", msg);
    return res.status(500).json({ error: msg });
  }
});

export default router;
