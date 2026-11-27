import { escapeHtml } from "./report-template/escape.ts";
import { sanitizeSubjectValue } from "./lifecycle-emails.ts";
import { formatarQuandoAgenda, mesDiaAgenda } from "./agenda-cliente-email.ts";
import { brandedEmail } from "./email/shell.ts";
import { button, callout, eventCard, heading, link, paragraph, postList, sectionTitle, spacer } from "./email/blocks.ts";
import { corSegura } from "./email/safe.ts";
import { EMAIL } from "./email/tokens.ts";
import type { Lang } from "./i18n/lang.ts";
import { clientEventText } from "./i18n/catalogs/client-event.ts";

/**
 * Client-facing "you have pending items" email (Fase 2 do Hub: pendências).
 * Renders through brandedEmail (_shared/email/shell.ts): the agency brand
 * band, shared blocks and footer, like every other whitelabel e-mail.
 */
export interface ClientEventEmailParams {
  clienteNome: string;
  workspaceName: string;
  brandColor: string;
  logoUrl: string | null;
  pendingPosts: { titulo: string; tipo: string }[];
  unreadMessages: number;
  hubUrl: string;
  unsubUrl: string;
  /** Shared Agenda occurrences still waiting for the client's answer (spec §9).
   *  Optional so every pre-Agenda caller keeps its exact output. */
  pendingEvents?: ClientEventReminder[];
  /** Linhas editoriais sent to the client and still awaiting an answer
   *  (spec §8.4). Optional so every older caller keeps its exact output. */
  linhas?: ClientEventLinha[];
  /** Language the e-mail is written in (the client's workspace language). */
  lang: Lang;
}

/** One linha editorial awaiting approval: `periodo` is the month, 'YYYY-MM-DD'. */
export interface ClientEventLinha {
  periodo: string;
  /** Custom title (spec §14); null or absent means the derived one. */
  titulo?: string | null;
}

/** "Linha editorial de {mês} aguardando sua aprovação", or "{titulo} aguardando
 * sua aprovação" for a renamed linha (spec §14.2). The month comes from the
 * 'YYYY-MM' prefix of `periodo` as text, never through a Date, so no timezone
 * can shift it; an unreadable value drops the month. The caller escapes. */
export function linhaItemText(periodo: string, titulo: string | null | undefined, lang: Lang): string {
  const t = clientEventText(lang);
  const custom = titulo?.trim();
  if (custom) return t.linhaCustom(custom);
  const m = /^\d{4}-(\d{2})/.exec(periodo);
  const mes = m ? t.months[Number(m[1]) - 1] : undefined;
  return mes ? t.linhaMonth(mes) : t.linhaNoMonth;
}

/** Bordered list of linha items, each linking to the Hub's linha tab. */
function linhaList(linhas: ClientEventLinha[], href: string, lang: Lang): string {
  const trs = linhas.map((l, i) => {
    const bd = i === linhas.length - 1 ? "" : `border-bottom: 1px solid ${EMAIL.divider};`;
    return `<tr><td style="padding: 12px 16px; ${bd} font-size: 14px; line-height: 20px; word-break: break-word; overflow-wrap: anywhere;">${link(href, linhaItemText(l.periodo, l.titulo, lang))}</td></tr>`;
  }).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid ${EMAIL.border}; border-radius: 12px; border-collapse: separate;">${trs}</table>`;
}

/** One row of `agenda_cliente_lembretes_pendentes`. */
export interface ClientEventReminder {
  ocorrencia_id: number;
  inicio: string;
  fim: string;
  dia_inteiro: boolean;
  data_inicio_local: string | null;
  tz: string;
  titulo: string;
}

export const CLIENT_EVENT_REMINDERS_HEADING = clientEventText("pt").remindersHeading;

/** Max pending-post titles rendered as a list before folding the rest into "e mais N...". */
const RENDERED_POSTS_CAP = 20;

/**
 * `workspaceName` is tenant-editable free text. sanitizeSubjectValue strips
 * control characters (a bare newline makes Resend reject the whole send) and
 * bounds the length, same as the founder-notice subjects in lifecycle-emails.ts.
 * Deliberately NOT dynamic like the preheader (spec §11): the preheader
 * already carries the specific counts, and changing the subject line is a
 * separate decision this spec doesn't make.
 */
export function clientEventSubject(workspaceName: string, lang: Lang = "pt"): string {
  return clientEventText(lang).subject(sanitizeSubjectValue(workspaceName));
}

/** Adaptive <h1> (spec §11): posts, when present, always win the count --
 * then Agenda events waiting for an answer (they are time-bound), then
 * messages. All zero is unreachable in production (the cron releases the
 * lease without sending in that case), but the builder still needs a sane,
 * non-crashing fallback for a direct/manual call. */
function buildPendingTitle(
  postsCount: number,
  messagesCount: number,
  eventsCount: number,
  linhasCount: number,
  lang: Lang,
): string {
  const t = clientEventText(lang);
  if (postsCount > 0) return t.titlePosts(postsCount);
  if (linhasCount > 0) return t.titleLinhas(linhasCount);
  if (eventsCount > 0) return t.titleEvents(eventsCount);
  if (messagesCount > 0) return t.titleMessages(messagesCount);
  return t.titleNone;
}

/** Dynamic preheader text (spec §8/§11): "{N} posts aguardando sua aprovação
 * e {M} mensagens." with the zeroed part omitted entirely and singular forms
 * for exactly 1 of either. */
function buildPendingPreheaderText(
  postsCount: number,
  messagesCount: number,
  eventsCount: number,
  linhasCount: number,
  lang: Lang,
): string {
  const t = clientEventText(lang);
  const parts: string[] = [];
  if (postsCount > 0) parts.push(t.preheaderPosts(postsCount));
  if (linhasCount > 0) parts.push(t.preheaderLinhas(linhasCount));
  if (eventsCount > 0) parts.push(t.preheaderEvents(eventsCount));
  if (messagesCount > 0) parts.push(t.preheaderMessages(messagesCount));
  if (parts.length === 0) return t.preheaderNone;
  return `${parts.join(t.preheaderJoin)}.`;
}

export function buildClientEventEmail(p: ClientEventEmailParams): string {
  const { clienteNome, workspaceName, logoUrl, pendingPosts, unreadMessages, hubUrl, unsubUrl } = p;
  const brandColor = corSegura(p.brandColor);
  const lang = p.lang;
  const t = clientEventText(lang);
  const pendingEvents = p.pendingEvents ?? [];
  const linhas = p.linhas ?? [];
  const firstName = clienteNome.split(" ")[0];
  const hubBase = hubUrl.replace(/\/+$/, "");

  const greeting = pendingPosts.length > 0 || linhas.length > 0
    ? t.greetingPosts(firstName)
    : pendingEvents.length > 0
    ? t.greetingEvents(firstName)
    : t.greetingPlain(firstName);

  const sections: string[] = [
    heading(buildPendingTitle(pendingPosts.length, unreadMessages, pendingEvents.length, linhas.length, lang)) +
      paragraph(greeting, "body", "0"),
  ];

  if (pendingPosts.length > 0) {
    const visible = pendingPosts.slice(0, RENDERED_POSTS_CAP);
    const hidden = Math.max(0, pendingPosts.length - RENDERED_POSTS_CAP);
    sections.push(
      postList(visible, lang) +
        (hidden > 0 ? paragraph(t.morePosts(hidden), "small", "8px 0 0") : ""),
    );
  }

  const linhaHref = hubBase ? `${hubBase}/aprovacoes?aba=linha` : null;
  if (linhas.length > 0) {
    sections.push(linhaList(linhas, linhaHref ?? "", lang));
  }

  if (pendingEvents.length > 0) {
    sections.push(
      sectionTitle(t.remindersHeading) +
        pendingEvents.map((ev, i) => {
          const { mes, dia } = mesDiaAgenda(ev, lang);
          return spacer(i === 0 ? 8 : 10) + (
            eventCard({
              mes, dia, tileColor: brandColor, titulo: ev.titulo,
              titleHref: hubBase ? `${hubBase}/agenda?ocorrencia=${ev.ocorrencia_id}` : null,
              lines: [formatarQuandoAgenda(ev, lang)],
              lang,
            })
          );
        }).join(""),
    );
  }

  if (unreadMessages > 0) {
    const label = unreadMessages === 1 ? t.unreadOne : t.unreadMany(unreadMessages);
    sections.push(callout(label));
  }

  // Posts keep their CTA; without posts, linhas lead to the Hub's linha tab,
  // then an events-only digest to the Hub Agenda.
  const linhaCta = pendingPosts.length === 0 && linhas.length > 0;
  const eventsCta = pendingPosts.length === 0 && !linhaCta && pendingEvents.length > 0;
  const ctaLabel = pendingPosts.length > 0 || linhaCta
    ? t.ctaReview
    : eventsCta
    ? t.ctaConfirm
    : t.ctaMessages;
  const ctaHref = linhaCta ? `${hubBase}/aprovacoes?aba=linha` : eventsCta ? `${hubBase}/agenda` : hubUrl;
  const cta = hubUrl ? button(ctaHref, ctaLabel, { brandColor }) : "";
  if (cta) sections.push(cta);

  return brandedEmail({
    preheader: buildPendingPreheaderText(pendingPosts.length, unreadMessages, pendingEvents.length, linhas.length, lang),
    workspaceName,
    brandColor,
    logoUrl,
    sections,
    footerHtml: [
      t.sentBy(escapeHtml(workspaceName)),
      link(unsubUrl, t.unsub, EMAIL.muted),
    ],
    lang,
  });
}

// --- Unsubscribe token ---------------------------------------------------------
//
// Mirrors _shared/report-docs/print-token.ts (b64url + HMAC-SHA256 +
// crypto.subtle.verify, constant-time) with a different payload shape and NO
// exp: the unsubscribe link is permanent by design so a stale email in an
// inbox can always opt the client out.

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array | null {
  try {
    const norm = s.replace(/-/g, "+").replace(/_/g, "/");
    const padded = norm.padEnd(norm.length + ((4 - (norm.length % 4)) % 4), "=");
    const bin = atob(padded);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function hmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

/** Who an unsubscribe token opts out: a Hub client (`{c}`) or an Agenda guest (`{g}`). */
export type UnsubAlvo = { tipo: "cliente"; id: number } | { tipo: "convidado"; id: number };

/** Signs `{c: id}` (client) or `{g: id}` (Agenda guest, spec §3.6). Same key and format for both. */
export async function signUnsubTokenFor(alvo: { c: number } | { g: number }, secret: string): Promise<string> {
  // Exactly one key, in this shape: `signUnsubToken(42)` must stay byte-identical
  // to every token already sitting in an inbox.
  const corpo = "c" in alvo ? { c: alvo.c } : { g: alvo.g };
  const payload = b64url(enc.encode(JSON.stringify(corpo)));
  const key = await hmacKey(secret, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

/** Client-only signer kept for the existing callers (client-event-email-cron). */
export function signUnsubToken(clienteId: number, secret: string): Promise<string> {
  return signUnsubTokenFor({ c: clienteId }, secret);
}

/**
 * Verifies the HMAC and decodes the payload. `null` on a bad signature, a
 * malformed token, or a payload that is not exactly one of `{c}` / `{g}`
 * with an integer id (id 0 is valid: callers must check `=== null`).
 */
export async function verifyUnsubTokenKind(
  token: string,
  secret: string,
): Promise<UnsubAlvo | null> {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const payloadB64 = token.slice(0, dot);
  const sigBytes = b64urlDecode(token.slice(dot + 1));
  if (!sigBytes || sigBytes.length === 0) return null;
  const key = await hmacKey(secret, ["verify"]);
  // crypto.subtle.verify é comparação em tempo constante.
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes as BufferSource,
    enc.encode(payloadB64),
  );
  if (!ok) return null;
  const payloadBytes = b64urlDecode(payloadB64);
  if (!payloadBytes) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as { c?: unknown; g?: unknown } | null;
    if (!parsed || typeof parsed !== "object") return null;
    const temC = parsed.c !== undefined;
    const temG = parsed.g !== undefined;
    if (temC === temG) return null;
    const id = temC ? parsed.c : parsed.g;
    if (typeof id !== "number" || !Number.isInteger(id)) return null;
    return temC ? { tipo: "cliente", id } : { tipo: "convidado", id };
  } catch {
    return null;
  }
}

/** Client-only verifier kept for the existing callers: a `{g}` token is `null`
 * here, so a guest's link can never opt a client out. */
export async function verifyUnsubToken(
  token: string,
  secret: string,
): Promise<number | null> {
  const alvo = await verifyUnsubTokenKind(token, secret);
  return alvo?.tipo === "cliente" ? alvo.id : null;
}

/**
 * Footer link for a client/guest unsubscribe token. Points at the CRM page
 * `/cancelar-avisos/<token>` when the app URL is known: the Supabase gateway
 * serves function HTML as text/plain with a sandbox CSP, so the function's own
 * page shows as raw markup. Without an app URL it falls back to the function,
 * which still works for the RFC 8058 One-Click POST. The List-Unsubscribe
 * header must keep using `clientUnsubFunctionUrl`.
 */
export function clientUnsubFooterUrl(
  pageBaseUrl: string | null | undefined,
  functionBaseUrl: string,
  token: string,
): string {
  const base = pageBaseUrl?.trim().replace(/\/+$/, "");
  return base ? `${base}/cancelar-avisos/${token}` : clientUnsubFunctionUrl(functionBaseUrl, token);
}

/** `${SUPABASE_URL}/functions/v1/client-email-unsub/<token>` (List-Unsubscribe target). */
export function clientUnsubFunctionUrl(functionBaseUrl: string, token: string): string {
  return `${functionBaseUrl.replace(/\/+$/, "")}/functions/v1/client-email-unsub/${token}`;
}
