import dotenv from "dotenv";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import authRouter from "./routes/auth.js";
import chatRouter from "./routes/chat.js";
import debugRouter from "./routes/debug.js";
import { fetchMcpTools } from "./services/mcpService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error(
      `Missing required environment variable: ${name}. Set it in backend/.env or the process environment.`
    );
  }
}

async function validateStartup() {
  requireEnv("ANTHROPIC_API_KEY");
  requireEnv("GEMINI_API_KEY");
  requireEnv("XANO_MCP_URL");

  const hasStaticMcpToken = Boolean(process.env.XANO_MCP_TOKEN?.trim());
  const hasLoginAuth = Boolean(
    process.env.XANO_AUTH_ENDPOINT?.trim() &&
      process.env.XANO_USERNAME?.trim() &&
      process.env.XANO_PASSWORD?.trim()
  );
  if (!hasStaticMcpToken && !hasLoginAuth) {
    console.warn(
      "[startup] MCP: no Authorization — set XANO_MCP_TOKEN and/or XANO_AUTH_ENDPOINT + XANO_USERNAME + XANO_PASSWORD so Xano sees a Bearer on MCP requests."
    );
  }

  let toolCount = 0;
  try {
    const tools = await fetchMcpTools();
    toolCount = Array.isArray(tools) ? tools.length : 0;
  } catch (err) {
    console.error(
      "[startup] MCP tools/list failed:",
      err instanceof Error ? err.message : err
    );
    toolCount = 0;
  }

  const port = Number(process.env.PORT) || 3000;
  const app = express();

  app.use(express.json({ limit: "2mb" }));

  app.use("/api", authRouter);
  app.use("/api", debugRouter);
  app.use("/api", chatRouter);

  const frontendDir = path.join(__dirname, "..", "frontend");
  app.use(express.static(frontendDir));

  const loginPage = path.join(frontendDir, "login.html");
  function sendLoginPage(_req, res) {
    res.sendFile(loginPage);
  }
  app.get("/login", sendLoginPage);
  app.get("/login.html", sendLoginPage);

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(frontendDir, "index.html"));
  });

  app.listen(port, () => {
    console.log(
      `Server running on port ${port} | MCP tools loaded: ${toolCount}`
    );
  });
}

validateStartup().catch((err) => {
  console.error("Startup failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
