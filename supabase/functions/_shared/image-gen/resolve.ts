// Provider selection shared by BOTH image-gen entrypoints (generate-image + mcp) so they can
// never drift: OpenRouter wins when its key is configured (added 2026-07-05 after the direct
// Gemini API rejected our calls in prod — OpenRouter routes to the same underlying model),
// falling back to the direct Gemini adapter otherwise. Returns null when neither key is set;
// each entrypoint decides what that means (generate-image: boot error; mcp: degraded tool).
import { createGeminiProvider } from "./gemini.ts";
import { createOpenRouterProvider } from "./openrouter.ts";
import type { ImageGenProvider } from "./provider.ts";

export function resolveImageProvider(): ImageGenProvider | null {
  // Tolerate both spellings — the secret was added by hand as OPEN_ROUTER_API_KEY.
  const openRouterKey = Deno.env.get("OPEN_ROUTER_API_KEY") ??
    Deno.env.get("OPENROUTER_API_KEY");
  if (openRouterKey) return createOpenRouterProvider(openRouterKey);
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (geminiKey) return createGeminiProvider(geminiKey);
  return null;
}
