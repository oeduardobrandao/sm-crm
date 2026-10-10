/**
 * Table-only HTML blocks for transactional e-mail (spec §4). Contract:
 * - every text parameter is RAW and escaped here, once; `*Html` params are
 *   trusted HTML built by another block;
 * - every href/src goes through linkSeguro, then escapeHtml; an unsafe URL
 *   drops the element (button/fallback/image) or degrades to plain text (link);
 * - every external colour goes through corSegura.
 */
import { escapeHtml } from "../report-template/escape.ts";
import { pickHeaderTextColor } from "../report-template/brand-header.ts";
import { BADGE_TONES, type BadgeTone, EMAIL, FONT_STACK, POST_TIPO_FALLBACK, POST_TIPOS } from "./tokens.ts";
import { corSegura, linkSeguro } from "./safe.ts";

const WRAP = "word-break: break-word; overflow-wrap: anywhere;";

export function heading(text: string): string {
  return `<h1 class="m-h1" style="margin: 0 0 16px; font-family: ${FONT_STACK}; font-size: 24px; line-height: 30px; font-weight: 700; letter-spacing: -0.01em; color: ${EMAIL.ink}; ${WRAP}">${escapeHtml(text)}</h1>`;
}

type PKind = "body" | "small";

function pStyle(kind: PKind, margin: string): string {
  return kind === "body"
    ? `margin: ${margin}; font-size: 15px; line-height: 24px; color: ${EMAIL.text}; ${WRAP}`
    : `margin: ${margin}; font-size: 13px; line-height: 20px; color: ${EMAIL.muted}; ${WRAP}`;
}

export function paragraph(text: string, kind: PKind = "body", margin = "0 0 14px"): string {
  return `<p style="${pStyle(kind, margin)}">${escapeHtml(text)}</p>`;
}

export function paragraphHtml(html: string, kind: PKind = "body", margin = "0 0 14px"): string {
  return `<p style="${pStyle(kind, margin)}">${html}</p>`;
}

export function strong(text: string): string {
  return `<strong style="color: ${EMAIL.ink};">${escapeHtml(text)}</strong>`;
}

export function sectionTitle(text: string): string {
  return `<p style="margin: 0 0 4px; font-size: 16px; line-height: 24px; font-weight: 700; color: ${EMAIL.ink};">${escapeHtml(text)}</p>`;
}

export function eyebrow(label: string, tone: "brand" | "danger" = "brand"): string {
  const dot = tone === "danger" ? EMAIL.dangerDot : EMAIL.brandMark;
  const color = tone === "danger" ? EMAIL.alertText : EMAIL.muted;
  return `<p style="margin: 0 0 14px; font-size: 13px; line-height: 18px; font-weight: 600; color: ${color};"><span style="display: inline-block; width: 8px; height: 8px; border-radius: 4px; background: ${dot}; margin-right: 8px;"></span>${escapeHtml(label)}</p>`;
}

export type ButtonVariant = "ink" | "outline" | { brandColor: string };

export function button(href: string | null | undefined, label: string, variant: ButtonVariant = "ink"): string {
  const url = linkSeguro(href);
  if (!url) return "";
  let bg: string;
  let fg: string;
  let border: string;
  if (variant === "ink") {
    bg = EMAIL.ink; fg = "#ffffff"; border = EMAIL.ink;
  } else if (variant === "outline") {
    bg = "#ffffff"; fg = EMAIL.ink; border = EMAIL.outlineBorder;
  } else {
    bg = corSegura(variant.brandColor); fg = pickHeaderTextColor(bg); border = bg;
  }
  // Padding on the <td>, not the <a>: Outlook's Word engine drops padding on inline elements.
  return `<table role="presentation" class="m-btn" cellpadding="0" cellspacing="0" style="border-collapse: separate;"><tr><td align="center" bgcolor="${bg}" style="background: ${bg}; border: 1px solid ${border}; border-radius: 10px; padding: 12px 24px;"><a href="${escapeHtml(url)}" style="display: inline-block; font-family: ${FONT_STACK}; font-size: 14px; line-height: 20px; font-weight: 600; color: ${fg}; text-decoration: none;">${escapeHtml(label)}</a></td></tr></table>`;
}

export function link(href: string | null | undefined, text: string, color: string = EMAIL.ink): string {
  const url = linkSeguro(href);
  const t = escapeHtml(text);
  return url
    ? `<a href="${escapeHtml(url)}" style="color: ${color}; font-weight: 600; text-decoration: underline;">${t}</a>`
    : t;
}

export function fallbackLink(href: string | null | undefined): string {
  const url = linkSeguro(href);
  if (!url) return "";
  return paragraph("Se o botão não funcionar, copie e cole este endereço no navegador:", "small", "16px 0 4px") +
    `<p style="margin: 0; font-size: 13px; line-height: 20px; color: ${EMAIL.ink}; word-break: break-all;">${escapeHtml(url)}</p>`;
}

export function steps(itemsHtml: string[]): string {
  const rows = itemsHtml.map((html, i) => {
    const bd = i === itemsHtml.length - 1 ? "" : `border-bottom: 1px solid ${EMAIL.divider};`;
    return `<tr><td width="40" valign="top" style="width: 40px; padding: 14px 0; ${bd}"><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse: separate;"><tr><td width="24" height="24" align="center" valign="middle" style="width: 24px; height: 24px; border: 1.5px solid ${EMAIL.ink}; border-radius: 12px; font-size: 12px; font-weight: 700; color: ${EMAIL.ink};">${i + 1}</td></tr></table></td><td valign="top" style="padding: 14px 0; ${bd} font-size: 15px; line-height: 24px; color: ${EMAIL.text}; ${WRAP}">${html}</td></tr>`;
  }).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
}

export function featureGrid(items: Array<{ title: string; text: string }>): string {
  const cell = (it: { title: string; text: string }, side: "l" | "r") =>
    `<td class="m-stack" width="50%" valign="top" style="padding: ${side === "l" ? "0 6px 12px 0" : "0 0 12px 6px"};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid ${EMAIL.border}; border-radius: 10px; border-collapse: separate;"><tr><td style="padding: 14px 16px; ${WRAP}"><p style="margin: 0; font-size: 14px; line-height: 20px; font-weight: 700; color: ${EMAIL.ink};">${escapeHtml(it.title)}</p><p style="margin: 4px 0 0; font-size: 13px; line-height: 20px; color: ${EMAIL.muted};">${escapeHtml(it.text)}</p></td></tr></table></td>`;
  const rows: string[] = [];
  for (let i = 0; i < items.length; i += 2) {
    const right = items[i + 1] ? cell(items[i + 1], "r") : `<td class="m-stack" width="50%"></td>`;
    rows.push(`<tr>${cell(items[i], "l")}${right}</tr>`);
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join("")}</table>`;
}

/** Vertical gap as a table row: Outlook's Word engine ignores margins on div. */
export function spacer(px: number): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td height="${px}" style="height: ${px}px; font-size: 0; line-height: 0;">&nbsp;</td></tr></table>`;
}

export function callout(innerHtml: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: separate;"><tr><td bgcolor="${EMAIL.calloutBg}" style="background: ${EMAIL.calloutBg}; border-radius: 10px; padding: 16px 18px; font-size: 14px; line-height: 22px; color: ${EMAIL.text}; ${WRAP}">${innerHtml}</td></tr></table>`;
}

export function alert(text: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: separate;"><tr><td bgcolor="${EMAIL.alertBg}" style="background: ${EMAIL.alertBg}; border: 1px solid ${EMAIL.alertBorder}; border-radius: 10px; padding: 16px 18px; font-size: 14px; line-height: 22px; color: ${EMAIL.alertText}; ${WRAP}">${escapeHtml(text)}</td></tr></table>`;
}

export function quote(label: string, text: string): string {
  return `<p style="margin: 0 0 6px; font-size: 13px; line-height: 20px; font-weight: 600; color: ${EMAIL.muted};">${escapeHtml(label)}</p>` +
    callout(escapeHtml(text).replace(/\r?\n/g, "<br>"));
}

export function detailRows(rows: Array<{ label: string; value: string }>): string {
  const trs = rows.map((r, i) => {
    const bd = i === rows.length - 1 ? "" : `border-bottom: 1px solid ${EMAIL.divider};`;
    return `<tr><td style="padding: 14px 18px; ${bd} font-size: 13px; color: ${EMAIL.muted};">${escapeHtml(r.label)}</td><td align="right" style="padding: 14px 18px; ${bd} font-size: 14px; font-weight: 600; color: ${EMAIL.ink}; ${WRAP}">${escapeHtml(r.value)}</td></tr>`;
  }).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid ${EMAIL.border}; border-radius: 10px; border-collapse: separate;">${trs}</table>`;
}

export function badge(tone: BadgeTone, label: string): string {
  const t = BADGE_TONES[tone] ?? BADGE_TONES.neutral;
  return `<span style="display: inline-block; padding: 2px 10px; border-radius: 999px; background: ${t.bg}; color: ${t.fg}; border: 1px solid ${t.border}; font-size: 12px; line-height: 18px; font-weight: 600;">${escapeHtml(label)}</span>`;
}

function formatPill(tipo: string): string {
  const f = Object.hasOwn(POST_TIPOS, tipo) ? POST_TIPOS[tipo] : POST_TIPO_FALLBACK;
  return `<span style="display: inline-block; padding: 2px 9px; border-radius: 999px; border: 1px solid ${EMAIL.border}; font-size: 12px; line-height: 18px; font-weight: 600; color: ${EMAIL.text}; white-space: nowrap;"><span style="display: inline-block; width: 7px; height: 7px; border-radius: 4px; background: ${f.color}; margin-right: 6px;"></span>${f.label}</span>`;
}

export function postList(posts: Array<{ titulo: string; tipo: string }>): string {
  const trs = posts.map((p, i) => {
    const bd = i === posts.length - 1 ? "" : `border-bottom: 1px solid ${EMAIL.divider};`;
    return `<tr><td style="padding: 12px 16px; ${bd}">${formatPill(p.tipo)}<p style="margin: 6px 0 0; font-size: 14px; line-height: 20px; color: ${EMAIL.ink}; ${WRAP}">${escapeHtml(p.titulo)}</p></td></tr>`;
  }).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid ${EMAIL.border}; border-radius: 12px; border-collapse: separate;">${trs}</table>`;
}

export function dateTile(p: { mes: string; dia: string; color: string }): string {
  const bg = corSegura(p.color);
  const fg = pickHeaderTextColor(bg);
  return `<table role="presentation" width="56" cellpadding="0" cellspacing="0" style="width: 56px; border: 1px solid ${EMAIL.border}; border-radius: 10px; border-collapse: separate;"><tr><td align="center" bgcolor="${bg}" style="background: ${bg}; color: ${fg}; font-size: 11px; line-height: 16px; font-weight: 700; padding: 3px 0; border-radius: 9px 9px 0 0;">${escapeHtml(p.mes)}</td></tr><tr><td align="center" style="font-size: 22px; line-height: 28px; font-weight: 700; color: ${EMAIL.ink}; padding: 4px 0 6px;">${escapeHtml(p.dia)}</td></tr></table>`;
}

export interface EventCardInput {
  mes: string;
  dia: string;
  tileColor: string;
  titulo: string;
  titleHref?: string | null;
  /** Raw text lines under the title; the first is the "quando". */
  lines: string[];
  meetingUrl?: string | null;
}

export function eventCard(e: EventCardInput): string {
  const titleUrl = linkSeguro(e.titleHref);
  const titleText = escapeHtml(e.titulo);
  const title = titleUrl
    ? `<a href="${escapeHtml(titleUrl)}" style="color: ${EMAIL.ink}; text-decoration: none;">${titleText}</a>`
    : titleText;
  const lines = e.lines.map((l, i) =>
    `<p style="margin: ${i === 0 ? "4px" : "2px"} 0 0; font-size: 14px; line-height: 20px; color: ${i === 0 ? EMAIL.text : EMAIL.muted}; ${WRAP}">${escapeHtml(l)}</p>`
  ).join("");
  const meeting = linkSeguro(e.meetingUrl)
    ? `<p style="margin: 10px 0 0; font-size: 14px;">${link(e.meetingUrl, "Entrar na reunião")}</p>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid ${EMAIL.border}; border-radius: 12px; border-collapse: separate;"><tr><td width="74" valign="top" style="width: 74px; padding: 16px 0 16px 18px;">${dateTile({ mes: e.mes, dia: e.dia, color: e.tileColor })}</td><td valign="top" style="padding: 16px 18px 16px 0; ${WRAP}"><p style="margin: 0; font-size: 16px; line-height: 22px; font-weight: 700; color: ${EMAIL.ink};">${title}</p>${lines}${meeting}</td></tr></table>`;
}

export function dateList(items: string[], restantes: number, riscado = false): string {
  const deco = riscado ? "text-decoration: line-through;" : "";
  const lis = items.map((t) => `<li style="margin: 0 0 4px; ${deco}">${escapeHtml(t)}</li>`).join("");
  const mais = restantes > 0
    ? `<p style="margin: 4px 0 0; font-size: 13px; line-height: 20px; color: ${EMAIL.muted};">e mais ${restantes} ${restantes === 1 ? "data" : "datas"}</p>`
    : "";
  return `<ul style="margin: 0; padding: 0 0 0 18px; font-size: 14px; line-height: 22px; color: ${EMAIL.text};">${lis}</ul>${mais}`;
}

export function signature(): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse: separate;"><tr><td valign="middle" style="padding-right: 12px;"><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse: separate;"><tr><td width="40" height="40" align="center" valign="middle" bgcolor="${EMAIL.brandMark}" style="width: 40px; height: 40px; border-radius: 20px; background: ${EMAIL.brandMark}; color: ${EMAIL.ink}; font-size: 16px; font-weight: 700;">E</td></tr></table></td><td valign="middle" style="font-size: 14px; line-height: 20px; color: ${EMAIL.ink};"><strong>Eduardo</strong><br><span style="color: ${EMAIL.muted};">Fundador do Mesaas</span></td></tr></table>`;
}
