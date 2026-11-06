// Pure helpers for blog-view. Spec: docs/superpowers/specs/2026-10-27-blog-metrics-design.md §3.

// Crawlers, link-preview fetchers, headless browsers and scripting clients. Matching one drops
// the view; an empty User-Agent is treated the same way (real browsers always send one).
const BOT_UA_RE =
  /bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|facebookexternalhit|whatsapp|telegram|curl|wget|python/i;

export function isBotUserAgent(ua: string | null): boolean {
  if (!ua || !ua.trim()) return true;
  return BOT_UA_RE.test(ua);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
