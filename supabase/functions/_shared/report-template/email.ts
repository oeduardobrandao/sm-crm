import { escapeHtml } from "./escape.ts";
import { sanitizeFromName } from "../email-headers.ts";
import { formatCompactPtBr, type EmailKpis } from "./brand-header.ts";
import { brandedEmail } from "../email/shell.ts";
import { button, heading, link, paragraphHtml, quote } from "../email/blocks.ts";
import { EMAIL } from "../email/tokens.ts";
import { corSegura, linkSeguro } from "../email/safe.ts";

export const REPORT_FROM_ADDRESS = "relatorios@mesaas.com.br";

/** From header for the monthly report email; the workspace name is tenant-editable. */
export function buildReportFrom(workspaceName: string | null | undefined): string {
  return `${sanitizeFromName(workspaceName ?? "Mesaas")} <${REPORT_FROM_ADDRESS}>`;
}

interface ReportEmailParams {
  clientName: string;
  month: string;         // "YYYY-MM" format
  workspaceName: string;
  brandColor: string;
  logoUrl: string | null;
  aiSummary: string | null;
  pdfUrl: string;
  hubUrl: string;
}

function formatMonthLabel(month: string): string {
  const [year, mm] = month.split('-');
  const date = new Date(parseInt(year, 10), parseInt(mm, 10) - 1, 1);
  const label = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const KPI_TILES: Array<{ key: keyof EmailKpis; label: string }> = [
  { key: "views", label: "Visualizações" },
  { key: "interactions", label: "Interações" },
  { key: "followers_gained", label: "Seguidores" },
];

/** `{sign}{magnitude}%` de um `pct_change`, com a cor que vai junto. Positivo
 * ESTRITO (>0) ganha "+" e verde; negativo ESTRITO (<0) ganha "-" e cinza
 * neutro (spec §10: nunca vermelho); zero é neutro nos dois eixos -- sem
 * sinal ("0%", nunca "+0%") e cinza, não verde. Compartilhado por
 * `kpiDeltaLine` (tile) e `buildReportPreheaderText` (sentença da prévia) para
 * que as duas superfícies apliquem exatamente a mesma regra de zero. */
function formatPctDelta(pctChange: number): { text: string; color: string } {
  if (pctChange === 0) return { text: "0%", color: EMAIL.deltaNeutral };
  const positive = pctChange > 0;
  return {
    text: `${positive ? "+" : "-"}${Math.abs(pctChange)}%`,
    color: positive ? EMAIL.positive : EMAIL.deltaNeutral,
  };
}

/** Delta em `+x%`/`-x%`/`0%` (hífen no negativo, nunca em-dash); ausente sem pct_change. */
function kpiDeltaLine(pctChange: number | undefined): string {
  if (typeof pctChange !== "number") return "";
  const { text, color } = formatPctDelta(pctChange);
  return `<p style="margin: 4px 0 0; font-size: 12px; font-weight: 600; color: ${color};">${text}</p>`;
}

/** Up to 3 bordered tiles; a missing metric drops alone; no kpis drops the row. */
function buildKpiRow(kpis: EmailKpis | null | undefined): string {
  if (!kpis) return "";
  const cells = KPI_TILES
    .map(({ key, label }) => {
      const entry = kpis[key];
      if (!entry || typeof entry.value !== "number") return "";
      return `<td class="m-kpi" width="33%" align="center" valign="top" style="padding: 14px 6px; border: 1px solid ${EMAIL.border}; border-radius: 10px;">
        <p style="margin: 0; font-size: 20px; line-height: 26px; font-weight: 700; color: ${EMAIL.ink};">${escapeHtml(formatCompactPtBr(entry.value))}</p>
        <p style="margin: 2px 0 0; font-size: 12px; line-height: 18px; color: ${EMAIL.muted};">${escapeHtml(label)}</p>
        ${kpiDeltaLine(entry.pct_change)}
      </td>`;
    })
    .filter(Boolean);
  if (cells.length === 0) return "";
  const withGaps = cells.map((c, i) => (i === cells.length - 1 ? c : `${c}<td class="m-kpi-gap" width="12"></td>`)).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: separate;"><tr>${withGaps}</tr></table>`;
}

function buildReportPreheaderText(monthLabel: string, kpis: EmailKpis | null | undefined): string {
  const pctChange = kpis?.views?.pct_change;
  if (typeof pctChange === "number") {
    return `Visualizações ${formatPctDelta(pctChange).text} em ${monthLabel}. Veja o relatório completo.`;
  }
  return `Seu relatório de ${monthLabel} está pronto.`;
}

export function buildReportEmail(params: ReportEmailParams & { emailKpis?: EmailKpis | null }): string {
  const { clientName, month, workspaceName, logoUrl, aiSummary, pdfUrl, hubUrl, emailKpis } = params;
  const brandColor = corSegura(params.brandColor);
  const monthLabel = formatMonthLabel(month);
  const firstName = clientName.split(" ")[0];

  const sections: string[] = [
    `<p style="margin: 0 0 6px; font-size: 13px; line-height: 18px; font-weight: 600; color: ${EMAIL.muted};">Relatório mensal · ${escapeHtml(monthLabel)}</p>` +
      heading(`Olá, ${firstName}!`),
  ];
  const kpiRow = buildKpiRow(emailKpis);
  if (kpiRow) sections.push(kpiRow);
  if (typeof aiSummary === "string" && aiSummary) sections.push(quote("Destaque do mês", aiSummary.substring(0, 300)));
  const cta = button(hubUrl, "Ver relatório completo", { brandColor });
  const pdf = linkSeguro(pdfUrl) ? paragraphHtml(link(pdfUrl, "Baixar em PDF", EMAIL.muted), "small", cta ? "12px 0 0" : "0") : "";
  if (cta || pdf) sections.push(cta + pdf);

  return brandedEmail({
    preheader: buildReportPreheaderText(monthLabel, emailKpis),
    workspaceName,
    brandColor,
    logoUrl,
    sections,
    footerHtml: [`Enviado por ${escapeHtml(workspaceName)} via Mesaas`],
  });
}
