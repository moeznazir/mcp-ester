import { log } from "./logger.js";

function parseRetryAfterSeconds(message: string): number | null {
  const m = message.match(/retry in ([\d.]+)\s*s/i);
  if (!m) return null;
  return Math.min(120, Math.ceil(parseFloat(m[1]) + 1));
}

function isRateLimitError(message: string): boolean {
  return (
    message.includes("429") ||
    message.includes("Too Many Requests") ||
    message.includes("RESOURCE_EXHAUSTED")
  );
}

/** Retry Gemini SDK calls when Google returns 429 / quota backoff hints. */
export async function withGemini429Retry<T>(
  label: string,
  fn: () => Promise<T>,
  maxAttempts = 4
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!isRateLimitError(msg) || attempt === maxAttempts - 1) {
        throw err;
      }
      const fromApi = parseRetryAfterSeconds(msg);
      const waitSec = fromApi ?? Math.min(90, 5 * 2 ** attempt);
      log.step("gemini.retry_429", { label, attempt, waitSec });
      await new Promise((r) => setTimeout(r, waitSec * 1000));
    }
  }
  throw lastErr;
}
