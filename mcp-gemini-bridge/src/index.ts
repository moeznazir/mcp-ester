export { loadConfig, authHeaders, mcpStaticHeaders, maskUrl } from "./config.js";
export type { BridgeEnv, McpTransportName, XanoAuthMode } from "./config.js";
export { GeminiMcpBridge } from "./geminiMcpBridge.js";
export { createMcpTransport } from "./transport.js";
export { AuthSession } from "./authSession.js";
export { createAuthenticatedFetch } from "./authenticatedFetch.js";
export { loginWithPassword, refreshAccessToken } from "./xanoAuthClient.js";
export { redactSecrets } from "./errorSanitize.js";
export { XanoMcpClient } from "./xanoMcpClient.js";
export { mcpToolsToGeminiDeclarations } from "./schemaMapper.js";
export { callToolResultToGeminiResponse } from "./responseMapper.js";
export { log } from "./logger.js";

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { GeminiMcpBridge } from "./geminiMcpBridge.js";
import { log } from "./logger.js";

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const here = path.resolve(fileURLToPath(import.meta.url));
  return path.resolve(entry) === here;
}

async function runCli(): Promise<void> {
  const message = process.argv.slice(2).join(" ").trim();
  if (!message) {
    console.error("Usage: npm run chat -- \"Your question here\"");
    console.error("   or: node dist/index.js \"Your question here\"");
    process.exit(1);
  }

  log.step("cli.start", { argvMessageLen: message.length });

  const cfg = loadConfig();
  const bridge = new GeminiMcpBridge(cfg);
  const reply = await bridge.chat(message);

  process.stdout.write(`${reply}\n`);
}

if (isMainModule()) {
  runCli().catch((e) => {
    log.error("cli.fatal", e);
    process.exit(1);
  });
}
