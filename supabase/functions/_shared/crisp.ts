/**
 * Crisp REST client. Pure I/O: no candidate selection, no ledger writes.
 *
 * Every call is bounded by AbortSignal.timeout — the edge runtime kills isolates
 * on unbounded I/O in ways that bypass catch entirely (documented repo failure
 * mode), and a hang must surface as a normal retryable throw instead.
 *
 * Errors carry the HTTP status and a STATIC route shape. Not the response body
 * (Crisp echoes the person's email in error reasons) and not the interpolated
 * path (the people ref IS often an email). Both would land in cron_failures and
 * in the alert e-mail.
 */

const BASE = "https://api.crisp.chat/v1";

function credentials(): { authorization: string; websiteId: string } {
  const identifier = Deno.env.get("CRISP_IDENTIFIER");
  const key = Deno.env.get("CRISP_KEY");
  const websiteId = Deno.env.get("CRISP_WEBSITE_ID");
  if (!identifier || !key || !websiteId) {
    throw new Error("Crisp credentials not configured");
  }
  return {
    authorization: `Basic ${btoa(`${identifier}:${key}`)}`,
    websiteId,
  };
}

/**
 * The index signatures are deliberate. PUT replaces the WHOLE profile, so the
 * caller has to spread back every field the GET returned -- avatar, address,
 * description, employment, geolocation, and anything Crisp adds after this was
 * written. A closed type would turn preserving them into a compile error, and an
 * allowlist of fields to keep is unmaintainable against a vendor schema we do
 * not control.
 */
export interface CrispPerson {
  nickname?: string;
  phone?: string;
  [key: string]: unknown;
}

export interface CrispProfileWrite {
  email: string;
  person: CrispPerson;
  segments: string[];
  [key: string]: unknown;
}

export interface CrispProfile {
  people_id: string;
  email?: string;
  person?: CrispPerson;
  segments?: string[];
  [key: string]: unknown;
}

async function call(
  method: string,
  path: string,
  routeShape: string,
  body: unknown,
  okStatuses: number[],
  fetchImpl: typeof fetch,
): Promise<Response> {
  const { authorization, websiteId } = credentials();

  const res = await fetchImpl(`${BASE}/website/${websiteId}${path}`, {
    method,
    headers: {
      Authorization: authorization,
      "X-Crisp-Tier": "plugin",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (res.ok || okStatuses.includes(res.status)) return res;
  throw new Error(`Crisp ${method} ${routeShape} failed: ${res.status}`);
}

const PROFILE_SHAPE = "/people/profile/:ref";
const DATA_SHAPE = "/people/data/:ref";

/** Resolve a profile by Crisp people_id or by email. null when absent. */
export async function getProfile(
  ref: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CrispProfile | null> {
  const res = await call(
    "GET",
    `/people/profile/${encodeURIComponent(ref)}`,
    PROFILE_SHAPE,
    undefined,
    [404],
    fetchImpl,
  );
  if (res.status === 404) return null;
  const body = await res.json();
  return (body?.data ?? null) as CrispProfile | null;
}

/**
 * Create a profile. Returns the new people_id, or null when Crisp reports the
 * profile already exists — which is expected for anyone who has used the chat
 * widget, and is a signal to re-read, not a failure.
 */
export async function createProfile(
  p: CrispProfileWrite,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const res = await call("POST", "/people/profile", "/people/profile", p, [409], fetchImpl);
  if (res.status === 409) return null;
  const body = await res.json();
  return (body?.data?.people_id ?? null) as string | null;
}

/**
 * Replace the profile. PUT is a full replace, so the caller MUST echo back any
 * operator-owned field (notepad, company) it read and does not intend to erase.
 */
export async function saveProfile(
  peopleId: string,
  p: CrispProfileWrite,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await call(
    "PUT",
    `/people/profile/${encodeURIComponent(peopleId)}`,
    PROFILE_SHAPE,
    p,
    [],
    fetchImpl,
  );
}

/**
 * Merge custom data keys. PATCH, not PUT: PUT replaces the whole data object and
 * would erase keys written by an operator or another integration. Our key set is
 * fixed and always sent in full, so a merge cannot leave one of ours stale.
 */
export async function saveData(
  peopleId: string,
  data: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await call(
    "PATCH",
    `/people/data/${encodeURIComponent(peopleId)}`,
    DATA_SHAPE,
    { data },
    [],
    fetchImpl,
  );
}

/** 404 means "already absent", which IS the goal state. */
export async function deleteProfile(
  ref: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await call(
    "DELETE",
    `/people/profile/${encodeURIComponent(ref)}`,
    PROFILE_SHAPE,
    undefined,
    [404],
    fetchImpl,
  );
}
