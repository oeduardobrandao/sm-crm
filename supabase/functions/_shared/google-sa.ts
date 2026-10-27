// Google OAuth access token from a service-account key (RS256 JWT bearer grant) using only
// WebCrypto. Nothing here ever puts the private key, the signed JWT or the token endpoint's
// response body into an error message or a log line: callers log `error.message` freely.

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const TOKEN_TIMEOUT_MS = 10_000;
const JWT_LIFETIME_SECONDS = 3600;

/** Parses the downloaded JSON key. Throws a fixed message and never echoes the input. */
export function parseServiceAccount(json: string): ServiceAccountKey {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("invalid service account");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid service account");
  const o = raw as Record<string, unknown>;
  if (typeof o.client_email !== "string" || !o.client_email) throw new Error("invalid service account");
  if (typeof o.private_key !== "string" || !o.private_key) throw new Error("invalid service account");
  if (o.token_uri !== undefined && typeof o.token_uri !== "string") throw new Error("invalid service account");
  const sa: ServiceAccountKey = { client_email: o.client_email, private_key: o.private_key };
  if (typeof o.token_uri === "string") sa.token_uri = o.token_uri;
  return sa;
}

function base64url(input: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const b64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function signJwt(sa: ServiceAccountKey, scope: string, aud: string, now: Date): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({ iss: sa.client_email, scope, aud, iat, exp: iat + JWT_LIFETIME_SECONDS }));
  const signingInput = `${header}.${claims}`;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      pemToPkcs8(sa.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    // Deliberately drop the underlying error: it can carry key material.
    throw new Error("invalid service account key");
  }
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64url(sig)}`;
}

export async function getGoogleAccessToken(
  sa: ServiceAccountKey,
  scope: string,
  deps: { fetch?: typeof fetch; now?: () => Date } = {},
): Promise<string> {
  const doFetch = deps.fetch ?? fetch;
  const now = (deps.now ?? (() => new Date()))();
  const tokenUri = sa.token_uri ?? DEFAULT_TOKEN_URI;
  const assertion = await signJwt(sa, scope, tokenUri, now);

  let res: Response;
  try {
    res = await doFetch(tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
  } catch {
    throw new Error("google token exchange failed: network");
  }
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`google token exchange failed: ${res.status}`);
  }
  let token: unknown;
  try {
    token = ((await res.json()) as { access_token?: unknown }).access_token;
  } catch {
    throw new Error("google token exchange failed: bad response");
  }
  if (typeof token !== "string" || !token) throw new Error("google token exchange failed: bad response");
  return token;
}
