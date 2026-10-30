// Revocation processing for the `google_revocations` queue (tokens still to be revoked at
// Google after an unlink or a revoked connection). Extracted from google-integration so the
// disconnect routes and the Phase 2 crons share one body. Spec §4.2.
//
// Contract: nothing here throws. A revocation that cannot be completed stays in the table with
// `attempts` bumped and `last_error` set; the cron-side retry stops at `maxAttempts` and keeps
// the row for manual follow-up (plan ruling P5).

import { type DbClient, decryptGoogleToken, revokeGoogleToken } from "./google.ts";

type RevokeFn = typeof revokeGoogleToken;

export type RevocationOutcome = "revoked" | "failed" | "missing";

/**
 * Revokes the queued token at Google. Success deletes the `google_revocations` row, failure bumps
 * `attempts` and records `last_error`. "missing" means no such row (already processed).
 */
export async function processRevocation(
  svc: DbClient,
  revocationId: string,
  deps: { revoke?: RevokeFn } = {},
): Promise<RevocationOutcome> {
  const revoke = deps.revoke ?? revokeGoogleToken;
  try {
    const { data: row, error } = await svc
      .from("google_revocations")
      .select("id, encrypted_token, token_kind, attempts")
      .eq("id", revocationId)
      .maybeSingle();
    if (error) {
      console.error(`[google-revocations] revocation ${revocationId} not readable: ${error.message}`);
      return "failed";
    }
    if (!row) {
      console.error(`[google-revocations] revocation ${revocationId} not readable: missing`);
      return "missing";
    }

    let lastError: string | null = null;
    try {
      const token = await decryptGoogleToken(row.encrypted_token, row.token_kind === "access" ? "access" : "refresh");
      if (!(await revoke(token))) lastError = "revoke_failed";
    } catch {
      lastError = "decrypt_failed";
    }

    if (lastError === null) {
      const { error: delError } = await svc.from("google_revocations").delete().eq("id", revocationId);
      if (delError) console.error(`[google-revocations] revocation ${revocationId} delete failed: ${delError.message}`);
      return "revoked";
    }
    const { error: updError } = await svc
      .from("google_revocations")
      .update({ attempts: (Number(row.attempts) || 0) + 1, last_error: lastError })
      .eq("id", revocationId);
    if (updError) console.error(`[google-revocations] revocation ${revocationId} update failed: ${updError.message}`);
    return "failed";
  } catch (err) {
    console.error(`[google-revocations] revocation ${revocationId} failed:`, (err as Error).message);
    return "failed";
  }
}

/**
 * Runs after an unlink RPC committed. Reads `(should_revoke, revocation_id)` from the RPC data
 * (a one-row array or a bare object) and, when it decided to revoke, processes that row. Never
 * throws: the unlink already happened.
 */
export async function processUnlinkDecisionData(svc: DbClient, data: unknown): Promise<void> {
  const decision = (Array.isArray(data) ? data[0] : data) as
    | { should_revoke?: boolean; revocation_id?: string | null }
    | null
    | undefined;
  if (!decision?.should_revoke || !decision.revocation_id) return;
  await processRevocation(svc, decision.revocation_id);
}

/**
 * Cron-side retry of queued revocations, oldest first, skipping rows that already used up their
 * attempts. A row whose failed attempt reaches `maxAttempts` is counted as `gaveUp` and logged
 * once (it is never selected again; the row stays for manual follow-up).
 */
export async function retryPendingRevocations(
  svc: DbClient,
  opts: { limit: number; maxAttempts: number; revoke?: RevokeFn },
): Promise<{ revoked: number; failed: number; gaveUp: number }> {
  const out = { revoked: 0, failed: 0, gaveUp: 0 };
  const { data, error } = await svc
    .from("google_revocations")
    .select("id, attempts")
    .lt("attempts", opts.maxAttempts)
    .order("created_at", { ascending: true })
    .limit(opts.limit);
  if (error) {
    console.error(`[google-revocations] pending listing failed: ${error.message}`);
    return out;
  }

  for (const row of (data ?? []) as Array<{ id: string; attempts: number | null }>) {
    const attempts = Number(row.attempts) || 0;
    if (attempts >= opts.maxAttempts) {
      out.gaveUp += 1;
      console.error(`[google-revocations] revocation ${row.id} gave up after ${attempts} attempts; row kept for manual follow-up`);
      continue;
    }
    const result = await processRevocation(svc, row.id, { revoke: opts.revoke });
    if (result === "revoked") {
      out.revoked += 1;
    } else if (result === "failed") {
      if (attempts + 1 >= opts.maxAttempts) {
        out.gaveUp += 1;
        console.error(
          `[google-revocations] revocation ${row.id} gave up after ${attempts + 1} attempts; row kept for manual follow-up`,
        );
      } else {
        out.failed += 1;
      }
    }
  }
  return out;
}
