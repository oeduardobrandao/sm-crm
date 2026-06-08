import { type CronFailureDetail, sendCronFailureEmail } from "./notify.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Normalize a cron error into a stable dedup signature + a short,
 * GitHub-label-safe hash. Pure and synchronous (no Web Crypto) so it stays
 * trivially unit-testable.
 */
export function computeSignature(
  cronName: string,
  errorMessage: string,
): { signature: string; hash: string } {
  const signature = `${cronName}:${String(errorMessage ?? "unknown")}`
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
    .replace(/\d{4}-\d{2}-\d{2}t[\d:.]+(?:z|[+-]\d{2}:\d{2})?/g, "<ts>")
    .replace(/\b[0-9a-f]{16,}\b/g, "<hex>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  return { signature, hash: fnv1a(signature) };
}

/** 32-bit FNV-1a → base36. Non-crypto; just a stable short key for dedup/labels. */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function renderFailureReport(
  cronName: string,
  detail: CronFailureDetail,
  signature: string,
  hash: string,
): string {
  const lines = [
    `Cron failure: ${cronName}`,
    `Signature: ${signature}`,
    `Signature hash (apply the GitHub label "cron-triage:<hash>"): ${hash}`,
    `Occurred at: ${new Date().toISOString()}`,
    `Total: ${detail.total ?? "?"}  Failed: ${detail.failed ?? "?"}`,
    "",
    "Errors:",
    ...(detail.errors ?? []).map(
      (e) => `- account ${e.accountId ?? "?"}: ${e.error ?? "unknown"}`,
    ),
  ];
  if (detail.context) lines.push("", `Context: ${JSON.stringify(detail.context)}`);
  if (detail.stack) lines.push("", "Stack:", detail.stack);
  return lines.join("\n");
}

export async function reportCronFailure(
  supabase: SupabaseClient,
  cronName: string,
  detail: CronFailureDetail,
): Promise<void> {
  const errorMessage = detail.errors?.[0]?.error ?? detail.stack?.split("\n")[0] ?? "unknown";
  const { signature, hash } = computeSignature(cronName, String(errorMessage));

  // Step 1 — best-effort insert (failure here must NOT block email or triage).
  try {
    const { error } = await supabase.from("cron_failures").insert({
      cron_name: cronName,
      signature,
      signature_hash: hash,
      error_message: String(errorMessage).slice(0, 1000),
      error_detail: detail,
    });
    if (error) console.error(`[triage] insert failed: ${error.message ?? "unknown"}`);
  } catch (_e) {
    console.error("[triage] insert threw");
  }

  // Step 2 — ALWAYS attempt the email, regardless of step 1.
  try {
    await sendCronFailureEmail(cronName, detail);
  } catch (_e) {
    console.error("[triage] email threw");
  }

  // Step 3 — atomic claim + fire (independent of step 1; uses cron_triage_state).
  try {
    const ROUTINE_URL = Deno.env.get("TRIAGE_ROUTINE_URL");
    const ROUTINE_TOKEN = Deno.env.get("TRIAGE_ROUTINE_TOKEN");
    if (!ROUTINE_URL || !ROUTINE_TOKEN) return;

    const cooldownSeconds =
      (Number(Deno.env.get("TRIAGE_COOLDOWN_HOURS") ?? "24") || 24) * 3600;
    // NOTE: verify the current routine beta header against Anthropic docs before
    // shipping — it is dated/versioned and may differ from the default below.
    const betaHeader =
      Deno.env.get("TRIAGE_ROUTINE_BETA") ?? "experimental-cc-routine-2026-04-01";

    const { data: claimed, error } = await supabase.rpc("claim_cron_triage", {
      p_hash: hash,
      p_cron_name: cronName,
      p_cooldown_seconds: cooldownSeconds,
    });
    if (error) {
      console.error(`[triage] claim rpc failed: ${error.message ?? "unknown"}`);
      return;
    }
    // claim_cron_triage `returns boolean`: PostgREST yields bare `true` when the
    // claim is won, or HTTP 204 → data:null when the cooldown WHERE no-ops. Not array-wrapped.
    if (claimed !== true) return; // within cooldown — another failure already triaged this signature

    const res = await fetch(ROUTINE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ROUTINE_TOKEN}`,
        "anthropic-beta": betaHeader,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: renderFailureReport(cronName, detail, signature, hash) }),
    });
    if (!res.ok) console.error(`[triage] routine /fire non-2xx: ${res.status}`);
  } catch (_e) {
    console.error("[triage] claim/fire threw");
  }
}
