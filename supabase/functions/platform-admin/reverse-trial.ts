import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { insertAuditLog } from "../_shared/audit.ts";

// Admin actions on the reverse trial (spec 2026-11-24-reverse-trial-design, Part 4 "Admin
// extensions"). Both go through locked SQL functions that compare-and-set on
// plan_source = 'trial'; a false return means the trial is no longer running (converted,
// downgraded or already ended) and nothing changed.
//
// Audit rows carry no conta_id on purpose: an admin action must not count as workspace
// activity (admin_workspace_last_activity reads audit_log by conta_id).

/** Longest a reverse trial may run, counted from its start. Mirrors admin_extend_reverse_trial. */
export const MAX_TRIAL_DAYS = 30;
const DAY_MS = 86_400_000;

type Headers = Record<string, string>;

const json = (body: unknown, status: number, headers: Headers) =>
  new Response(JSON.stringify(body), { status, headers });

const NOT_IN_TRIAL = {
  error: "Este workspace não está mais no teste sem cartão. Atualize a página.",
  code: "not_in_trial",
};

export type ExtendValidation =
  | { ok: true; endsAt: string }
  | { ok: false; error: string };

/**
 * The new end must parse, be in the future and fall at most MAX_TRIAL_DAYS after the start
 * (inclusive). Returns the normalized ISO instant to send to the RPC.
 */
export function validateExtendEndsAt(
  endsAt: unknown,
  startedAt: string | null | undefined,
  now: Date,
): ExtendValidation {
  if (typeof endsAt !== "string" || endsAt.trim() === "") {
    return { ok: false, error: "Informe a nova data de término." };
  }
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime())) return { ok: false, error: "Data de término inválida." };
  if (end.getTime() <= now.getTime()) {
    return { ok: false, error: "A nova data de término precisa estar no futuro." };
  }
  const start = startedAt ? new Date(startedAt) : null;
  if (!start || Number.isNaN(start.getTime())) {
    return { ok: false, error: "Este workspace não tem início de teste registrado." };
  }
  if (end.getTime() > start.getTime() + MAX_TRIAL_DAYS * DAY_MS) {
    return { ok: false, error: `O teste pode durar no máximo ${MAX_TRIAL_DAYS} dias desde o início.` };
  }
  return { ok: true, endsAt: end.toISOString() };
}

export async function handleExtendReverseTrial(
  svc: SupabaseClient,
  body: { workspace_id?: string; ends_at?: unknown },
  adminUserId: string,
  headers: Headers,
  now: Date = new Date(),
) {
  const workspaceId = body.workspace_id;
  if (!workspaceId) return json({ error: "workspace_id is required" }, 400, headers);

  // Pre-read so a too-late date reads as a 400 with its reason, not as a misleading 409.
  const { data: ws, error: readErr } = await svc
    .from("workspaces")
    .select("plan_source, reverse_trial_started_at, reverse_trial_ends_at, reverse_trial_ended_at")
    .eq("id", workspaceId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!ws) return json({ error: "Workspace not found" }, 404, headers);
  if (ws.plan_source !== "trial") return json(NOT_IN_TRIAL, 409, headers);

  const check = validateExtendEndsAt(body.ends_at, ws.reverse_trial_started_at, now);
  if (!check.ok) return json({ error: check.error, code: "invalid_ends_at" }, 400, headers);

  const { data: changed, error } = await svc.rpc("admin_extend_reverse_trial", {
    p_workspace: workspaceId,
    p_ends_at: check.endsAt,
  });
  if (error) throw error;
  if (changed !== true) return json(NOT_IN_TRIAL, 409, headers);

  await insertAuditLog(svc, {
    action: "admin-extend-reverse-trial",
    actor_user_id: adminUserId,
    resource_type: "workspace",
    resource_id: workspaceId,
    metadata: { ends_at: check.endsAt, previous_ends_at: ws.reverse_trial_ends_at ?? null },
  });
  return json({ message: "Teste estendido", ends_at: check.endsAt }, 200, headers);
}

export async function handleEndReverseTrial(
  svc: SupabaseClient,
  body: { workspace_id?: string },
  adminUserId: string,
  headers: Headers,
) {
  const workspaceId = body.workspace_id;
  if (!workspaceId) return json({ error: "workspace_id is required" }, 400, headers);

  const ended = await endReverseTrialByAdmin(svc, workspaceId);
  if (!ended) return json(NOT_IN_TRIAL, 409, headers);

  await insertAuditLog(svc, {
    action: "admin-end-reverse-trial",
    actor_user_id: adminUserId,
    resource_type: "workspace",
    resource_id: workspaceId,
    metadata: { reason: "end_now" },
  });
  return json({ message: "Teste encerrado" }, 200, headers);
}

/**
 * end_reverse_trial(ws, 'ended_by_admin'): drops the workspace to Free without the Hub pause.
 * True when it ended a running trial, false when there was none (no change). Throws on error.
 */
export async function endReverseTrialByAdmin(svc: SupabaseClient, workspaceId: string): Promise<boolean> {
  const { data, error } = await svc.rpc("end_reverse_trial", {
    p_workspace: workspaceId,
    p_outcome: "ended_by_admin",
  });
  if (error) throw error;
  return data === true;
}
