/**
 * Structured stderr logging for debugging the MCP ↔ Gemini bridge.
 */

function ts(): string {
  return new Date().toISOString();
}

export const log = {
  step(phase: string, detail?: unknown): void {
    if (detail === undefined) {
      console.error(`[${ts()}] [mcp-gemini-bridge] ${phase}`);
    } else if (typeof detail === "string") {
      console.error(`[${ts()}] [mcp-gemini-bridge] ${phase}: ${detail}`);
    } else {
      console.error(`[${ts()}] [mcp-gemini-bridge] ${phase}:`, detail);
    }
  },

  error(phase: string, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${ts()}] [mcp-gemini-bridge] ERROR ${phase}: ${msg}`);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
  },
};
