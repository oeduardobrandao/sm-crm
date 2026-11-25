/**
 * Falhas transitórias do Supabase/PostgREST: vale tentar de novo.
 *
 * O postgrest-js devolve (como objeto simples, não `Error`) dois formatos que
 * importam aqui:
 * - queda de rede ou fetch abortado: `{ message: 'TypeError: Failed to fetch', code: '' }`;
 * - resposta do gateway que não é JSON (502/503/504 com corpo `text/plain`):
 *   `{ message: <corpo> }`, sem `code`.
 * Erro do Postgres ou do PostgREST sempre traz `code` (42501, PGRST116...) e
 * não muda numa nova tentativa, com três exceções: cancelamento por
 * `statement_timeout` (57014), falha de serialização (40001) e deadlock (40P01).
 */
const TRANSIENT_PG_CODES = new Set(['57014', '40001', '40P01']);

export function isTransientDbError(err: unknown): boolean {
  // fetch que estourou fora do postgrest-js ("Failed to fetch")
  if (err instanceof TypeError) return true;
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  if (code === undefined || code === null || code === '') {
    // Um Error do próprio app sem código é bug de lógica, não de transporte.
    return !(err instanceof Error) && 'message' in err;
  }
  return typeof code === 'string' && TRANSIENT_PG_CODES.has(code);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Executa `fn` e, se falhar com erro transitório, tenta de novo depois de cada
 * intervalo de `delaysMs`. Erro não transitório sobe na hora. Use só com
 * operações idempotentes: um 504 pode ter gravado no banco mesmo assim.
 */
export async function retryTransient<T>(
  fn: () => Promise<T>,
  delaysMs: readonly number[] = [1000, 3000],
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= delaysMs.length || !isTransientDbError(err)) throw err;
      await sleep(delaysMs[attempt]);
    }
  }
}
