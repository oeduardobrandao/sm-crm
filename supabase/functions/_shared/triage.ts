import type { CronFailureDetail } from "./notify.ts";

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
