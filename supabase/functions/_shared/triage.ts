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

  // Step 3 — atomic claim + fire a GitHub repository_dispatch (independent of step 1).
  try {
    const DISPATCH_TOKEN = Deno.env.get("GITHUB_DISPATCH_TOKEN");
    const REPO = Deno.env.get("GITHUB_TRIAGE_REPO"); // "owner/repo"
    if (!DISPATCH_TOKEN || !REPO) return;

    const cooldownSeconds =
      (Number(Deno.env.get("TRIAGE_COOLDOWN_HOURS") ?? "24") || 24) * 3600;

    const { data: claimed, error } = await supabase.rpc("claim_cron_triage", {
      p_hash: hash, p_cron_name: cronName, p_cooldown_seconds: cooldownSeconds,
    });
    if (error) { console.error(`[triage] claim rpc failed: ${error.message ?? "unknown"}`); return; }
    // claim_cron_triage `returns boolean`: PostgREST yields bare `true` when the
    // claim is won, or HTTP 204 → data:null when the cooldown WHERE no-ops.
    if (claimed !== true) return;

    const res = await fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DISPATCH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "mesaas-cron-triage",
      },
      body: JSON.stringify({
        event_type: "cron-failure",
        client_payload: {
          cron_name: cronName,
          signature,
          signature_hash: hash,
          error_message: String(errorMessage).slice(0, 1000),
          errors: (detail.errors ?? []).slice(0, 50),
          stack: detail.stack ? detail.stack.slice(0, 4000) : undefined,
          occurred_at: new Date().toISOString(),
        },
      }),
    });
    if (!res.ok) console.error(`[triage] repository_dispatch non-2xx: ${res.status}`);
  } catch (_e) {
    console.error("[triage] claim/dispatch threw");
  }
}
