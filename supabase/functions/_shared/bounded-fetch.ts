// Todas as chamadas PostgREST do report-docs passam por aqui: a geração é
// síncrona e sem retry de fila, então uma query travada não pode segurar o
// request até o runtime matar a função (o catch/log seria pulado).
export const DB_TIMEOUT_MS = 20_000;

export function makeBoundedFetch(timeoutMs: number = DB_TIMEOUT_MS): typeof fetch {
  return (input, init) =>
    fetch(input, {
      ...init,
      // Respeita um signal explícito do chamador; senão, impõe o teto.
      signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
    });
}
