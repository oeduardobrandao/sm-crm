/**
 * Pagar.me HTTP client module.
 *
 * Unlike _shared/stripe.ts (which throws at module load to fail fast if STRIPE_SECRET_KEY is unset),
 * this module throws the PAGARME_SECRET_KEY requirement INSIDE pagarmeFetch(), not at import time.
 * This allows the module to be imported by unit tests (which test buildPagarmeAuthHeader and
 * PagarmeApiError) without requiring environment variables.
 */

const PAGARME_API_BASE = "https://api.pagar.me/core/v5";

/**
 * Pagar.me API error with status and parsed body.
 * Never includes the secret key in the message.
 */
export class PagarmeApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`Pagar.me API error (${status})`);
    this.name = "PagarmeApiError";
  }
}

/**
 * Builds the Basic authentication header for Pagar.me API.
 * The API authenticates with Basic auth where the username is the secret key and password is empty.
 */
export function buildPagarmeAuthHeader(secretKey: string): string {
  return "Basic " + btoa(secretKey + ":");
}

/**
 * Helper to require the PAGARME_SECRET_KEY at runtime.
 * Throws if the key is not set.
 */
function requirePagarmeKey(): string {
  const key = Deno.env.get("PAGARME_SECRET_KEY");
  if (!key) {
    throw new Error("PAGARME_SECRET_KEY is required");
  }
  return key;
}

/**
 * Fetches from the Pagar.me API with automatic header setup and error handling.
 *
 * @param method HTTP method (GET, POST, etc.)
 * @param path API path (e.g., "/orders")
 * @param body Request body (optional)
 * @param opts Additional options (idempotencyKey for idempotent requests)
 * @returns Parsed JSON response
 * @throws PagarmeApiError on non-2xx response
 * @throws Error if PAGARME_SECRET_KEY is not set
 */
export async function pagarmeFetch<T>(
  method: string,
  path: string,
  body?: unknown,
  opts?: { idempotencyKey?: string },
): Promise<T> {
  const secretKey = requirePagarmeKey();
  const headers: Record<string, string> = {
    Authorization: buildPagarmeAuthHeader(secretKey),
    "Content-Type": "application/json",
  };

  if (opts?.idempotencyKey) {
    headers["Idempotency-key"] = opts.idempotencyKey;
  }

  const res = await fetch(PAGARME_API_BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    let parsedBody: unknown = null;
    try {
      parsedBody = await res.json();
    } catch {
      // JSON parse failed; body stays null
    }
    throw new PagarmeApiError(res.status, parsedBody);
  }

  try {
    return await res.json() as T;
  } catch (e) {
    // 2xx response with non-JSON body (e.g. 204 No Content) — return null as parsed result
    return null as T;
  }
}
