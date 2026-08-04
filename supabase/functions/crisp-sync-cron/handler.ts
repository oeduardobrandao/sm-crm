/**
 * Sweep logic for the Crisp customer sync, dependency-injected so tests can
 * drive it without a network.
 *
 * Per candidate:
 *   record_crisp_contact (email only, atomic, refuses when a deletion is owed)
 *   -> resolve identity (GET by people_id or email)
 *   -> create, or read-modify-write the existing profile
 *   -> PATCH custom data
 *   -> confirm_crisp_sync (people_id + fingerprint) ONLY on success
 *
 * Spec: docs/superpowers/specs/2026-08-03-crisp-customer-sync-design.md
 */

import type { CrispPerson, CrispProfile, CrispProfileWrite } from "../_shared/crisp.ts";

interface DbResult<T> {
  data: T | null;
  error: { message: string } | null;
}

export interface CandidateRow {
  user_id: string;
  email: string;
  nome: string | null;
  phone: string | null;
  papel: string;
  plano: string | null;
  assinatura: string;
  plan_source: string | null;
  workspaces: string | null;
  workspace_count: number;
  clientes: number;
  cliente_desde: string | null;
  primary_workspace_id: string | null;
  segments: string[];
  fingerprint: string;
  people_id: string | null;
}

interface DeletionRow {
  id: string;
  synced_email: string;
  /**
   * Returned by get_crisp_contact_deletions and deliberately NOT used to
   * address the vendor DELETE — see the sweep below for why the cached id must
   * never be preferred over synced_email on the erasure path. Kept on the type
   * because it describes the RPC's actual return shape.
   */
  synced_people_id: string | null;
}

export interface CrispCronDeps {
  rpc: (name: string) => Promise<DbResult<unknown>>;
  /** False means a deletion is still owed for a different address: skip entirely. */
  recordContact: (userId: string, email: string) => Promise<boolean>;
  /**
   * Returns FALSE when it matched no row: the deletion sweep swept this person
   * while our vendor call was in flight. The caller must then delete the
   * profile it just wrote. See the call site.
   */
  confirmSync: (
    userId: string,
    email: string,
    peopleId: string | null,
    fingerprint: string,
  ) => Promise<boolean>;
  /**
   * Stamps deletion only when the row still matches the caller's observed
   * state (its synced_email, still not deleted). Returns FALSE when it
   * matched no row: another run already handled this row's deletion, and this
   * run's vendor delete was idempotent (the client treats a 404 as success).
   */
  markContactDeleted: (id: string, expectedEmail: string) => Promise<boolean>;
  getProfile: (ref: string) => Promise<CrispProfile | null>;
  createProfile: (p: CrispProfileWrite) => Promise<string | null>;
  saveProfile: (peopleId: string, p: CrispProfileWrite) => Promise<void>;
  saveData: (peopleId: string, data: Record<string, unknown>) => Promise<void>;
  deleteProfile: (ref: string) => Promise<void>;
  adminUrlFor: (workspaceId: string | null) => string | null;
  report: (
    detail: { failed: number; errors: Array<{ accountId?: string; error?: string }> },
  ) => Promise<void>;
  /**
   * Wall clock, injected so the deadline below is testable without a real
   * sleep. Production wires Date.now.
   */
  now: () => number;
}

/**
 * Wall-clock budget for the UPSERT sweep only, measured from the top of the
 * invocation (so the deletion sweep's own time counts against it).
 *
 * A worst-case sweep is 200 candidates at up to four vendor calls each, every
 * one bounded at 10s -- far past the edge runtime's wall clock. The realistic
 * terminal state of such a run is an isolate kill, which discards every
 * accumulated error along with the single deps.report call at the end, so a
 * chronically failing backfill looks exactly like a healthy one in
 * cron_failures. Stopping early keeps the reporting path reachable.
 *
 * Unprocessed candidates are not lost: the sweep is ordered
 * `synced_at asc nulls first`, so the next run picks up where this one stopped.
 */
export const UPSERT_BUDGET_MS = 60_000;

/**
 * Wall clock for the deletion sweep, checked between candidates.
 *
 * get_crisp_contact_deletions is limit 50 and every vendor call is bounded at
 * 10s, so a hanging Crisp gives ~500s here -- past the edge runtime's ceiling,
 * which kills the isolate before deps.report fires and before a single upsert
 * runs. Bounding this does NOT drop an erasure: an unswept row keeps
 * deleted_at is null and is re-selected next tick, so the obligation is
 * deferred by one 15-minute cycle either way. The difference is that this way
 * the failures get reported.
 *
 * Deletions keep FIRST claim on the clock: this budget is larger than the
 * upsert one, and UPSERT_BUDGET_MS is measured from run start, so time spent
 * here is already charged against the upserts.
 */
export const DELETION_BUDGET_MS = 120_000;

/**
 * The segments this sync owns. Anything outside this list was added by an
 * operator and must survive every write.
 */
export const MANAGED_SEGMENTS = [
  "owner",
  "membro",
  "trial",
  "pagante",
  "free",
  "inadimplente",
];

export function mergeSegments(
  existing: string[] | undefined,
  managed: string[],
): string[] {
  const vocab = new Set(MANAGED_SEGMENTS);
  const kept = (existing ?? []).filter((s) => !vocab.has(s));
  return Array.from(new Set([...kept, ...managed]));
}

export function buildPerson(row: CandidateRow): CrispPerson {
  // Crisp REQUIRES a nickname on create and on replace, and profiles.nome is
  // nullable (20260301_baseline_schema.sql:27). The RPC already applies this
  // fallback; repeated here so the handler cannot emit a 4xx-guaranteed body if
  // the two ever drift. Same expression handle_new_user_workspace() uses.
  const person: CrispPerson = {
    nickname: (row.nome ?? "").trim() || row.email.split("@")[0],
  };
  // The RPC already trims and NULLIFs. Repeated here because sending an empty
  // phone is worse than sending none: Crisp renders it as a real, blank contact
  // method. When we have no phone the field is OMITTED, which leaves any
  // operator-entered number on the profile intact.
  const phone = (row.phone ?? "").trim();
  if (phone) person.phone = phone;
  return person;
}

export function buildData(
  row: CandidateRow,
  adminUrl: string | null,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    plano: row.plano ?? "",
    assinatura: row.assinatura,
    plan_source: row.plan_source ?? "",
    papel: row.papel,
    workspaces: row.workspaces ?? "",
    workspace_count: row.workspace_count,
    clientes: row.clientes,
    cliente_desde: row.cliente_desde ?? "",
  };
  if (adminUrl) data.admin_url = adminUrl;
  return data;
}

export async function runCrispSyncCron(
  deps: CrispCronDeps,
): Promise<{ upserted: number; deleted: number; failed: number; timedOut: boolean }> {
  let upserted = 0;
  let deleted = 0;
  let timedOut = false;
  const errors: Array<{ accountId?: string; error?: string }> = [];
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const startedAt = deps.now();

  // --- Deletions FIRST -------------------------------------------------------
  // These are erasure obligations, so they get first claim on the clock: this
  // loop's own budget (DELETION_BUDGET_MS) is larger than the upsert budget,
  // and both are measured from the same startedAt, so time spent here is
  // already charged against the upsert sweep too. A budget here does not drop
  // an erasure -- see DELETION_BUDGET_MS's comment -- it only keeps the
  // reporting path reachable instead of losing it to an isolate kill.
  const delRes = await deps.rpc("get_crisp_contact_deletions");
  if (delRes.error) {
    errors.push({ error: `contact deletions: ${delRes.error.message}` });
  } else {
    const deletions = (delRes.data ?? []) as DeletionRow[];
    for (let i = 0; i < deletions.length; i++) {
      // Checked BEFORE taking a new candidate, mirroring the upsert loop
      // below: never break mid-deletion, only between them.
      if (deps.now() - startedAt > DELETION_BUDGET_MS) {
        timedOut = true;
        console.error(
          `[crisp-sync-cron] deletion wall-clock budget (${DELETION_BUDGET_MS}ms) exhausted: ${
            deletions.length - i
          } of ${deletions.length} deletion candidate(s) left unprocessed; deleted_at stays null so they are re-selected next run`,
        );
        break;
      }
      const d = deletions[i];
      try {
        // DELETE BY EMAIL, UNCONDITIONALLY. synced_people_id is a CACHE;
        // synced_email is THE RECORD of what was pushed to the vendor (see the
        // ledger's header comment). Preferring the cached id here can silently
        // no-op the erasure: an operator deleting or merging the profile in the
        // Crisp dashboard invalidates the id, and the customer's next widget
        // message recreates a fresh profile at the same address. The
        // id-addressed DELETE then 404s, the client counts that as success,
        // markContactDeleted stamps deleted_at -- and the profile actually
        // living at synced_email keeps their name, email and phone forever,
        // because get_crisp_contact_deletions filters on deleted_at is null and
        // can never select that row again. Unerasable PII: the one outcome this
        // ledger exists to prevent. A DELETE costs the same either way, and
        // email addressing is supported on this route, so there is nothing to
        // trade off. `d.synced_people_id` is deliberately unused here.
        await deps.deleteProfile(d.synced_email);
        // FALSE here is not a failure: it means an overlapping run already
        // stamped (and likely reactivated) this row, so ours was a stale,
        // redundant deletion. Do not count it and do not report it -- the
        // vendor delete above is idempotent (a 404 there counts as success),
        // so nothing was lost.
        if (await deps.markContactDeleted(d.id, d.synced_email)) {
          deleted++;
        } else {
          console.error(
            `[crisp-sync-cron] stale deletion: ${d.id} was already handled by another run`,
          );
        }
      } catch (e) {
        errors.push({ accountId: d.id, error: msg(e) });
      }
    }
  }

  // --- Upserts ---------------------------------------------------------------
  const candRes = await deps.rpc("get_crisp_sync_candidates");
  if (candRes.error) {
    errors.push({ error: `sync candidates: ${candRes.error.message}` });
  } else {
    const candidates = (candRes.data ?? []) as CandidateRow[];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      // Checked BEFORE taking a new candidate, never mid-person: a partially
      // written person (vendor write done, confirm not) is exactly the
      // orphaned-profile state the confirm compensation exists to clean up.
      // Break, so the normal reporting path below still runs.
      if (deps.now() - startedAt > UPSERT_BUDGET_MS) {
        timedOut = true;
        console.error(
          `[crisp-sync-cron] wall-clock budget (${UPSERT_BUDGET_MS}ms) exhausted: ${
            candidates.length - i
          } of ${candidates.length} candidate(s) left unprocessed; they are re-offered next run`,
        );
        break;
      }
      try {
        // RECORD BEFORE THE VENDOR CALL. The call CREATES the profile, so a
        // success followed by a failed ledger write leaves a person's name,
        // email and phone at a foreign vendor with nothing able to erase them.
        // A refusal means a deletion is owed for their previous address.
        if (!(await deps.recordContact(c.user_id, c.email))) continue;

        const person = buildPerson(c);
        const data = buildData(c, deps.adminUrlFor(c.primary_workspace_id));

        let profile = await deps.getProfile(c.people_id ?? c.email);
        let peopleId: string;

        if (profile) {
          peopleId = profile.people_id;
        } else {
          const created = await deps.createProfile({
            email: c.email,
            person,
            segments: c.segments,
          });
          if (created !== null) {
            peopleId = created;
          } else {
            // Conflict: a chat-widget session already created this person. This
            // is expected, not a failure. Re-read once and fall through.
            profile = await deps.getProfile(c.email);
            if (!profile) {
              throw new Error("Crisp create conflicted but the re-read found no profile");
            }
            peopleId = profile.people_id;
          }
        }

        // Only an EXISTING profile needs the preserve-and-override write. One we
        // just created already carries exactly what we sent.
        //
        // PUT REPLACES the whole profile, so everything the GET returned is
        // spread back and only the fields this sync owns are overridden.
        // Preserve-by-default, override-by-exception: an allowlist of fields to
        // keep (an earlier draft named just notepad and company) silently erases
        // avatar, address, description, employment, geolocation and anything
        // Crisp adds later.
        //
        // people_id is dropped from the body: it is the route parameter, not a
        // profile field.
        if (profile) {
          const { people_id: _peopleId, ...preserved } = profile;
          await deps.saveProfile(peopleId, {
            ...preserved,
            email: c.email,
            // Nested spread for the same reason as the outer one: person carries
            // operator-owned sub-fields (avatar, geolocation) that a flat
            // override would drop.
            person: { ...(profile.person ?? {}), ...person },
            segments: mergeSegments(profile.segments, c.segments),
          });
        }

        await deps.saveData(peopleId, data);

        // THE MID-FLIGHT SWEEP RACE. record_crisp_contact's advisory lock is
        // transaction-scoped and released long before this point, so between it
        // and here the user can change their email and an overlapping run's
        // deletion sweep can delete this profile and stamp deleted_at. Our write
        // above then RECREATED it, and confirm now matches no row.
        //
        // If we merely counted that as success, the profile would sit at the
        // vendor holding a name, an email and a phone, and
        // get_crisp_contact_deletions could never select it -- it filters on the
        // same deleted_at. Unerasable, which is the one outcome this ledger
        // exists to prevent. So delete what we just wrote, then surface it.
        if (!(await deps.confirmSync(c.user_id, c.email, peopleId, c.fingerprint))) {
          try {
            await deps.deleteProfile(peopleId);
          } catch (delErr) {
            // The compensation ITSELF failed. Say so explicitly: this is the
            // unerasable-PII case, not a routine delete blip, and the operator
            // reading cron_failures needs to know which one they are looking at.
            throw new Error(
              `ledger row swept mid-sync AND the orphaned profile ${peopleId} could not be deleted: ${
                delErr instanceof Error ? delErr.message : String(delErr)
              }`,
            );
          }
          throw new Error("ledger row swept mid-sync; deleted the orphaned profile");
        }
        upserted++;
      } catch (e) {
        errors.push({ accountId: c.user_id, error: msg(e) });
      }
    }
  }

  if (errors.length > 0) {
    console.error(`[crisp-sync-cron] ${errors.length} failure(s)`, errors);
    await deps.report({ failed: errors.length, errors });
  }
  return { upserted, deleted, failed: errors.length, timedOut };
}
