import { escapeHtml } from "./escape.ts";

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

export function buildReportEmail(params: ReportEmailParams): string {
  const {
    clientName, month, workspaceName, brandColor,
    logoUrl, aiSummary, pdfUrl, hubUrl,
  } = params;

  const monthLabel = formatMonthLabel(month);
  const safeName = escapeHtml(clientName.split(' ')[0]);
  const safeWorkspace = escapeHtml(workspaceName);

  const logoSection = logoUrl
    ? `<tr><td align="center" style="padding: 30px 0 20px;"><img src="${escapeHtml(logoUrl)}" alt="${safeWorkspace}" style="max-height: 48px; max-width: 180px;" /></td></tr>`
    : `<tr><td align="center" style="padding: 30px 0 20px; font-size: 20px; font-weight: 700; color: ${escapeHtml(brandColor)};">${safeWorkspace}</td></tr>`;

  const aiSection = aiSummary
    ? `<tr><td style="padding: 20px 30px; background: #f8f9fa; border-radius: 8px; margin: 0 30px;">
        <p style="margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; font-weight: 600;">Destaque do mês</p>
        <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #374151;">${escapeHtml(typeof aiSummary === 'string' ? aiSummary.substring(0, 300) : '')}</p>
       </td></tr>
       <tr><td style="height: 16px;"></td></tr>`
    : '';

  const hubButton = hubUrl
    ? `<a href="${escapeHtml(hubUrl)}" style="display: inline-block; background: ${escapeHtml(brandColor)}; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600; margin-right: 8px;">Ver Relatório Completo</a>`
    : '';

  const pdfButton = pdfUrl
    ? `<a href="${escapeHtml(pdfUrl)}" style="display: inline-block; background: #1f2937; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600;">Baixar PDF</a>`
    : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f3f4f6; padding: 40px 20px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
${logoSection}
<tr><td style="padding: 0 30px;">
  <h1 style="margin: 0 0 8px; font-size: 22px; font-weight: 700; color: #111827;">Olá, ${safeName}!</h1>
  <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.5; color: #4b5563;">Seu relatório de <strong>${escapeHtml(monthLabel)}</strong> está pronto para visualização.</p>
</td></tr>
${aiSection}
<tr><td align="center" style="padding: 24px 30px 30px;">
  ${hubButton}${pdfButton}
</td></tr>
<tr><td style="padding: 20px 30px; border-top: 1px solid #e5e7eb;">
  <p style="margin: 0; font-size: 12px; color: #9ca3af; text-align: center;">Enviado por ${safeWorkspace} via Mesaas</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
