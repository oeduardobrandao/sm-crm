interface FetchRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  retryableStatus?: (status: number) => boolean;
}

const DEFAULT_RETRYABLE = (s: number) => s >= 500 || s === 408 || s === 429;
const SAFE_METHODS = new Set(['GET', 'HEAD']);

function resolveMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: FetchRetryOptions,
): Promise<Response> {
  const { maxAttempts = 3, baseDelayMs = 500, retryableStatus = DEFAULT_RETRYABLE } = options ?? {};

  const method = resolveMethod(input, init);
  const canRetry = SAFE_METHODS.has(method);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(input, init);
      if (res.ok) return res;

      if (!canRetry || !retryableStatus(res.status)) {
        throw new Error(`HTTP ${res.status}`);
      }
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (isAbortError(err)) throw err;
      if (err instanceof Error && err.message.startsWith('HTTP ')) throw err;
      lastError = err;
      if (!canRetry) throw err;
    }

    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** (attempt - 1)));
    }
  }

  throw lastError;
}
