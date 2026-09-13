import { escapeHtml } from "./escape.ts";

export interface EmailKpiEntry { value: number; pct_change?: number }
export interface EmailKpis {
  views?: EmailKpiEntry; interactions?: EmailKpiEntry; followers_gained?: EmailKpiEntry;
}

// Duplicado de packages/hub-theme/theme.ts:36-39 de propósito: edge functions
// não importam de packages/ (racional em _shared/whatsapp.ts:4-6). Mesma
// fórmula do Hub (sem correção gamma), mesmo threshold do --hub-acc-fg (0.55).
function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function pickHeaderTextColor(brandColorHex: string): "#171717" | "#ffffff" {
  return relativeLuminance(brandColorHex) > 0.55 ? "#171717" : "#ffffff";
}

/** Faixa do cabeçalho: cor REAL do workspace, texto por luminância, avatar
 * opcional. brandColor NÃO é escapado (CHECK ^#hex6 no banco); nome/logoUrl
 * chegam CRUS e são escapados aqui (contrato da spec). Tabela, nunca flex:
 * flex não renderiza em Outlook. Degradações aceitas (spec §3b): border-radius
 * e box-shadow somem no engine Word — logo continua legível no fundo branco. */
export function buildBrandHeaderBand(p: {
  workspaceName: string; brandColor: string; logoUrl: string | null;
}): string {
  const name = escapeHtml(p.workspaceName);
  const textColor = pickHeaderTextColor(p.brandColor);
  const avatarCell = p.logoUrl
    ? `<td style="padding-right: 9px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="40" height="40" align="center" valign="middle" style="width: 40px; height: 40px; background: #ffffff; border-radius: 50%; box-shadow: 0 0 0 2px rgba(255,255,255,.55);"><img src="${escapeHtml(p.logoUrl)}" alt="" width="32" style="max-width: 32px; max-height: 32px; display: block;" /></td></tr></table></td>`
    : "";
  return `<tr><td align="center" style="background: ${p.brandColor}; padding: 20px 24px;">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    ${avatarCell}<td valign="middle" style="font-size: 18px; font-weight: 700; color: ${textColor};">${name}</td>
  </tr></table>
</td></tr>`;
}

/** Texto de prévia da inbox. Vai logo após <body>; o enchimento de &zwnj;
 * impede que o conteúdo real vaze na prévia. Texto chega CRU, escapado aqui. */
export function buildPreheader(text: string): string {
  const pad = "&nbsp;&zwnj;".repeat(90);
  return `<div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">${escapeHtml(text)}${pad}</div>`;
}

/** 48200 -> "48,2 mil"; 1200000 -> "1,2 mi"; abaixo de 10 mil, separador pt-BR. */
export function formatCompactPtBr(n: number): string {
  const fmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 0 });
  if (Math.abs(n) >= 1_000_000) return `${fmt(n / 1_000_000)} mi`;
  if (Math.abs(n) >= 10_000) return `${fmt(n / 1_000)} mil`;
  return n.toLocaleString("pt-BR");
}
