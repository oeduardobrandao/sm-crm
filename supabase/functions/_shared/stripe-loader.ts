// Loader injetável do cliente Stripe. Os módulos compartilhados do platform-admin (pricing,
// workspace-detail) chamavam `await import("../_shared/stripe.ts")` direto; o bundler remoto do
// `--use-api` quebra quando esse import dinâmico coexiste com _shared/r2.ts (aws-sdk) no mesmo
// grafo (mcp-admin). Quem quer Stripe ao vivo registra o loader no seu index.ts; quem não
// registra (mcp-admin) cai no fallback do espelho/catálogo, o que também é o comportamento
// desejado para tools somente leitura.
import type { StripeClient } from "./stripe-amount.ts";

type Loader = () => Promise<StripeClient>;
let loader: Loader | null = null;

export function setStripeLoader(fn: Loader | null): void {
  loader = fn;
}

/** Cliente Stripe se um loader foi registrado e carregou; null caso contrário (fallback). */
export async function loadStripe(): Promise<StripeClient | null> {
  if (!loader) return null;
  try {
    return await loader();
  } catch (err) {
    console.error("[stripe-loader] falha ao carregar Stripe:", (err as Error).message);
    return null;
  }
}
