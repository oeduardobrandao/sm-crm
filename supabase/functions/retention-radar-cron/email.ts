import { escapeHtml } from "../_shared/report-template/escape.ts";
import type { RadarBucket } from "../_shared/radar-logic.ts";

export interface RadarRow {
  bucket: RadarBucket;
  workspaceName: string;
  ownerEmail: string;
  planId: string | null;
  status: string | null;
  lastActivityAt: string | null;
  failedPaymentCount: number;
}

// Ordered most-urgent-first — this is the order a human should work the list in.
const SECTIONS: Array<{ bucket: RadarBucket; title: string; hint: string }> = [
  { bucket: "past_due", title: "Pagamento falhando", hint: "Stripe está tentando cobrar. Fale antes do cancelamento." },
  { bucket: "trial_ending", title: "Trial acabando", hint: "Menos de 7 dias para converter." },
  { bucket: "dormant", title: "Dormentes", hint: "Mais de 30 dias sem uso real." },
  { bucket: "cooling", title: "Esfriando", hint: "Mais de 7 e até 30 dias sem uso real." },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "Nunca";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function renderSection(title: string, hint: string, rows: RadarRow[]): string {
  if (rows.length === 0) return "";
  const body = rows
    .map(
      (r) =>
        `<tr>` +
        `<td>${escapeHtml(r.workspaceName)}</td>` +
        `<td>${escapeHtml(r.ownerEmail)}</td>` +
        `<td>${escapeHtml(r.planId ?? "—")}</td>` +
        `<td>${escapeHtml(r.status ?? "—")}</td>` +
        `<td>${escapeHtml(fmtDate(r.lastActivityAt))}</td>` +
        `<td>${escapeHtml(String(r.failedPaymentCount))}</td>` +
        `</tr>`,
    )
    .join("");
  return (
    `<h3 style="margin:24px 0 4px">${escapeHtml(title)} (${rows.length})</h3>` +
    `<p style="margin:0 0 8px;color:#888780;font-size:12px">${escapeHtml(hint)}</p>` +
    `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px">` +
    `<tr><th>Workspace</th><th>Dono</th><th>Plano</th><th>Status</th><th>Última atividade</th><th>Falhas</th></tr>` +
    `${body}</table>`
  );
}

export function buildRadarEmail(rows: RadarRow[]): string {
  if (rows.length === 0) {
    return `<p>Nenhum workspace em risco esta semana.</p>`;
  }
  const sections = SECTIONS.map((s) =>
    renderSection(s.title, s.hint, rows.filter((r) => r.bucket === s.bucket)),
  ).join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a3d2b">
    <p>${rows.length} workspace(s) precisam de atenção.</p>
    ${sections}
  </div>`;
}
