/**
 * Document shells for transactional e-mail (spec §3/§4).
 * - mesaasEmail: Mesaas logo header + category eyebrow; sent by Mesaas.
 * - brandedEmail: the agency's full brand band (buildBrandHeaderBand, unchanged);
 *   sent on the agency's behalf to its client.
 * Tables only; light scheme pinned; desktop padding inline, mobile via @media.
 */
import { escapeHtml } from "../report-template/escape.ts";
import { buildBrandHeaderBand, buildPreheader } from "../report-template/brand-header.ts";
import { EMAIL, EMAIL_LOGO_URL, FONT_STACK } from "./tokens.ts";
import { corSegura, linkSeguro } from "./safe.ts";
import { eyebrow as eyebrowBlock } from "./blocks.ts";

export const MESAAS_TAGLINE = "Mesaas · Plataforma de gestão para agências de social media";

// The element rule carries the font into nested cells for Outlook's Word engine,
// which does not inherit font-family from the wrapper table; other clients
// inherit it from the wrapper's inline style even if <style> is stripped.
const MOBILE_CSS = `body, table, td, p, a, li, h1, span, strong { font-family: ${FONT_STACK}; }
@media (max-width: 600px) {
  .m-px { padding-left: 24px !important; padding-right: 24px !important; }
  .m-h1 { font-size: 22px !important; line-height: 28px !important; }
  .m-btn { width: 100% !important; }
  .m-btn a { display: block !important; }
  .m-stack { display: block !important; width: 100% !important; padding: 0 0 12px 0 !important; }
  .m-kpi { display: block !important; width: auto !important; margin: 0 0 12px 0 !important; }
  .m-kpi-gap { display: none !important; }
}`;

function documentOpen(preheader: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<style>${MOBILE_CSS}</style>
</head>
<body style="margin: 0; padding: 0; background: ${EMAIL.page};">
${buildPreheader(preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${EMAIL.page}" style="background: ${EMAIL.page};">
<tr><td align="center" style="padding: 32px 12px 40px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width: 100%; max-width: 560px; font-family: ${FONT_STACK};">
<tr><td>`;
}

function cardOpen(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${EMAIL.card}" style="background: ${EMAIL.card}; border: 1px solid ${EMAIL.border}; border-radius: 12px; border-collapse: separate; overflow: hidden;">`;
}

function sectionRows(sections: string[], firstTop: number, firstPrefix = ""): string {
  const rows = sections.map((s, i) =>
    `<tr><td class="m-px" style="padding: ${i === 0 ? firstTop : 24}px 40px 0;">${i === 0 ? firstPrefix : ""}${s}</td></tr>`
  ).join("\n");
  return `${rows}\n<tr><td style="height: 36px; line-height: 36px; font-size: 0;">&nbsp;</td></tr>`;
}

function documentClose(footerRowsHtml: string): string {
  return `</table>
</td></tr>
<tr><td class="m-px" style="padding: 24px 40px 0; font-size: 12px; line-height: 18px; color: ${EMAIL.muted};">${footerRowsHtml}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export interface MesaasEmailInput {
  preheader: string;
  eyebrow: string;
  eyebrowTone?: "brand" | "danger";
  sections: string[];
  footerLines: string[];
}

export function mesaasEmail(p: MesaasEmailInput): string {
  const header = `<tr><td class="m-px" style="padding: 28px 40px 24px; border-bottom: 1px solid ${EMAIL.divider};"><img src="${EMAIL_LOGO_URL}" width="158" height="20" alt="Mesaas" style="display: block; border: 0; outline: none; color: ${EMAIL.ink}; font-size: 18px; line-height: 20px; font-weight: 700;"></td></tr>`;
  const footer = [...p.footerLines.map(escapeHtml), escapeHtml(MESAAS_TAGLINE)]
    .map((l, i, all) => `<p style="margin: 0 0 ${i === all.length - 1 ? 0 : 6}px;">${l}</p>`).join("");
  return documentOpen(p.preheader) + cardOpen() + header +
    sectionRows(p.sections, 36, eyebrowBlock(p.eyebrow, p.eyebrowTone ?? "brand")) +
    documentClose(footer);
}

export interface BrandedEmailInput {
  preheader: string;
  workspaceName: string;
  brandColor: string | null | undefined;
  logoUrl: string | null | undefined;
  sections: string[];
  footerHtml: string[];
}

export function brandedEmail(p: BrandedEmailInput): string {
  const band = buildBrandHeaderBand({
    workspaceName: p.workspaceName,
    brandColor: corSegura(p.brandColor),
    logoUrl: linkSeguro(p.logoUrl),
  });
  const footer = p.footerHtml
    .map((l, i, all) => `<p style="margin: 0 0 ${i === all.length - 1 ? 0 : 6}px;">${l}</p>`).join("");
  return documentOpen(p.preheader) + cardOpen() + band + sectionRows(p.sections, 32) + documentClose(footer);
}
