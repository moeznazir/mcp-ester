/** Remove bearer tokens from strings before logging or returning to Gemini. */
export function redactSecrets(message: string): string {
  return message
    .replace(/Bearer\s+[\w-._~+/]+=*\b/gi, "Bearer <redacted>")
    .replace(/"access_token"\s*:\s*"[^"]+"/gi, '"access_token":"<redacted>"')
    .replace(/"token"\s*:\s*"[^"]+"/gi, '"token":"<redacted>"');
}
