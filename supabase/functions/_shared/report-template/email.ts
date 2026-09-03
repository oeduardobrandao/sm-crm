import { escapeHtml } from "./escape.ts";
import {
  buildBrandHeaderBand,
  buildPreheader,
  pickHeaderTextColor,
  formatCompactPtBr,
  type EmailKpis,
} from "./brand-header.ts";

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

/** Delta em `+x%`/`-x%` (hífen no negativo, nunca em-dash); ausente sem pct_change. */
function kpiDeltaLine(pctChange: number | undefined): string {
  if (typeof pctChange !== "number") return "";
  const positive = pctChange >= 0;
  const color = positive ? "#16a34a" : "#6b7280";
  const sign = positive ? "+" : "-";
  const magnitude = Math.abs(pctChange);
  return `<p style="margin: 4px 0 0; font-size: 12px; font-weight: 600; color: ${color};">${sign}${magnitude}%</p>`;
}

/** Fila de 3 tiles Visualizações/Interações/Seguidores. Some inteira sem `kpis`; tile sem entry some sozinho. */
function buildKpiRow(kpis: EmailKpis | null | undefined): string {
  if (!kpis) return "";
  const cells = KPI_TILES
    .map(({ key, label }) => {
      const entry = kpis[key];
      if (!entry || typeof entry.value !== "number") return "";
      return `<td width="33%" align="center" valign="top" style="padding: 12px 6px; background: #f8f9fa; border-radius: 8px;">
        <p style="margin: 0; font-size: 18px; font-weight: 700; color: #111827;">${escapeHtml(formatCompactPtBr(entry.value))}</p>
        <p style="margin: 2px 0 0; font-size: 12px; color: #6b7280;">${escapeHtml(label)}</p>
        ${kpiDeltaLine(entry.pct_change)}
      </td>`;
    })
    .filter(Boolean);
  if (cells.length === 0) return "";
  const spacerCells = cells.map((cell, i) => (i === cells.length - 1 ? cell : `${cell}<td width="12"></td>`)).join("");
  return `<tr><td style="padding: 0 30px 20px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${spacerCells}</tr></table>
  </td></tr>`;
}

/** Preheader do relatório: usa o delta de views quando presente; senão o fallback genérico. */
function buildReportPreheader(monthLabel: string, kpis: EmailKpis | null | undefined): string {
  const pctChange = kpis?.views?.pct_change;
  if (typeof pctChange === "number") {
    const positive = pctChange >= 0;
    const sign = positive ? "+" : "-";
    const magnitude = Math.abs(pctChange);
    return buildPreheader(`Visualizações ${sign}${magnitude}% em ${monthLabel}. Veja o relatório completo.`);
  }
  return buildPreheader(`Seu relatório de ${monthLabel} está pronto.`);
}

export function buildReportEmail(params: ReportEmailParams & { emailKpis?: EmailKpis | null }): string {
  const {
    clientName, month, workspaceName, brandColor,
    logoUrl, aiSummary, pdfUrl, hubUrl, emailKpis,
  } = params;

  const monthLabel = formatMonthLabel(month);
  const safeName = escapeHtml(clientName.split(' ')[0]);

  const headerBand = buildBrandHeaderBand({ workspaceName, brandColor, logoUrl });
  const preheader = buildReportPreheader(monthLabel, emailKpis);
  const kpiRow = buildKpiRow(emailKpis);

  const aiSection = aiSummary
    ? `<tr><td style="padding: 20px 30px; background: #f8f9fa; border-radius: 8px; margin: 0 30px;">
        <p style="margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; font-weight: 600;">Destaque do mês</p>
        <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #374151;">${escapeHtml(typeof aiSummary === 'string' ? aiSummary.substring(0, 300) : '')}</p>
       </td></tr>
       <tr><td style="height: 16px;"></td></tr>`
    : '';

  const textColor = pickHeaderTextColor(brandColor);
  const hubButton = hubUrl
    ? `<a href="${escapeHtml(hubUrl)}" style="display: inline-block; background: ${brandColor}; color: ${textColor}; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600;">Ver Relatório Completo</a>`
    : '';

  const pdfLink = pdfUrl
    ? `<p style="margin: ${hubButton ? '12px' : '0'} 0 0;"><a href="${escapeHtml(pdfUrl)}" style="color: #6b7280; text-decoration: underline; font-size: 13px;">Baixar em PDF</a></p>`
    : '';

  const ctaSection = (hubButton || pdfLink)
    ? `<tr><td align="center" style="padding: 24px 30px 30px;">
  ${hubButton}${pdfLink}
</td></tr>`
    : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f3f4f6; padding: 40px 20px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
${headerBand}
<tr><td style="padding: 24px 30px 0;">
  <p style="margin: 0 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; font-weight: 600;">Relatório mensal · ${escapeHtml(monthLabel)}</p>
  <h1 style="margin: 0 0 16px; font-size: 22px; font-weight: 700; color: #111827;">Olá, ${safeName}!</h1>
</td></tr>
${kpiRow}
${aiSection}
${ctaSection}
<tr><td style="padding: 20px 30px; background: #f5f3ee; text-align: center;">
  <p style="margin: 0; font-size: 12px; color: #888780;">Enviado por ${escapeHtml(workspaceName)} via Mesaas</p>
  <p style="margin: 4px 0 0; font-size: 12px; color: #888780;">Mesaas · gestão inteligente para social media managers</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
