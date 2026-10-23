// Deploy Hook da Vercel que reconstrói o site com os posts do blog (spec
// 2026-10-23-blog-automatico §7). A URL é segredo (quem a tem dispara builds): nunca logar.
// Lida a cada chamada, não no load do módulo, para que o resto do platform-admin funcione sem ela.

export const DEPLOY_HOOK_TIMEOUT_MS = 8_000;

function hookUrl(): string | null {
  const raw = Deno.env.get("VERCEL_BLOG_DEPLOY_HOOK")?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

export function isDeployHookConfigured(): boolean {
  return hookUrl() !== null;
}

/** Dispara o build. true só quando a Vercel respondeu 2xx dentro do prazo. Nunca lança. */
export async function fireHook(
  fetchFn: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<boolean> {
  const url = hookUrl();
  if (!url) return false;
  try {
    const res = await fetchFn(url, { method: "POST", signal: AbortSignal.timeout(DEPLOY_HOOK_TIMEOUT_MS) });
    await res.body?.cancel().catch(() => undefined);
    if (!res.ok) console.error("[vercel-deploy-hook] hook answered", res.status);
    return res.ok;
  } catch (e) {
    console.error("[vercel-deploy-hook] hook request failed:", e instanceof Error ? e.name : "unknown");
    return false;
  }
}
