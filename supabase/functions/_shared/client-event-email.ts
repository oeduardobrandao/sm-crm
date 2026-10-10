import { escapeHtml } from "./report-template/escape.ts";
import { sanitizeSubjectValue } from "./lifecycle-emails.ts";
import { formatarQuandoAgenda, mesDiaAgenda } from "./agenda-cliente-email.ts";
import { brandedEmail } from "./email/shell.ts";
import { button, callout, eventCard, heading, link, paragraph, postList, sectionTitle, spacer } from "./email/blocks.ts";
import { corSegura } from "./email/safe.ts";

/**
 * Client-facing "you have pending items" email (Fase 2 do Hub: pendências).
 * Visual family mirrors _shared/report-template/email.ts (560px card, brand
 * header band from Task 1's shared module, button pattern) so client-facing
 * transactional mail reads as one system.
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

export const CLIENT_EVENT_REMINDERS_HEADING = "Eventos aguardando sua confirmação";

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
export function clientEventSubject(workspaceName: string): string {
  return `Você tem pendências com ${sanitizeSubjectValue(workspaceName)}`;
}

/** Adaptive <h1> (spec §11): posts, when present, always win the count --
 * then Agenda events waiting for an answer (they are time-bound), then
 * messages. All zero is unreachable in production (the cron releases the
 * lease without sending in that case), but the builder still needs a sane,
 * non-crashing fallback for a direct/manual call. */
function buildPendingTitle(postsCount: number, messagesCount: number, eventsCount = 0): string {
  if (postsCount > 0) {
    return postsCount === 1 ? "1 post espera sua aprovação" : `${postsCount} posts esperam sua aprovação`;
  }
  if (eventsCount > 0) {
    return eventsCount === 1 ? "1 evento aguarda sua confirmação" : `${eventsCount} eventos aguardam sua confirmação`;
  }
  if (messagesCount > 0) {
    return messagesCount === 1 ? "1 mensagem espera você" : `${messagesCount} mensagens esperam você`;
  }
  return "Você tem novidades";
}

/** Dynamic preheader text (spec §8/§11): "{N} posts aguardando sua aprovação
 * e {M} mensagens." with the zeroed part omitted entirely and singular forms
 * for exactly 1 of either. */
function buildPendingPreheaderText(postsCount: number, messagesCount: number, eventsCount = 0): string {
  const parts: string[] = [];
  if (postsCount > 0) {
    parts.push(postsCount === 1 ? "1 post aguardando sua aprovação" : `${postsCount} posts aguardando sua aprovação`);
  }
  if (eventsCount > 0) {
    parts.push(
      eventsCount === 1 ? "1 evento aguardando sua confirmação" : `${eventsCount} eventos aguardando sua confirmação`,
    );
  }
  if (messagesCount > 0) {
    parts.push(messagesCount === 1 ? "1 mensagem" : `${messagesCount} mensagens`);
  }
  if (parts.length === 0) return "Você tem novidades.";
  return `${parts.join(" e ")}.`;
}

export function buildClientEventEmail(p: ClientEventEmailParams): string {
  const { clienteNome, workspaceName, logoUrl, pendingPosts, unreadMessages, hubUrl, unsubUrl } = p;
  const brandColor = corSegura(p.brandColor);
  const pendingEvents = p.pendingEvents ?? [];
  const firstName = clienteNome.split(" ")[0];
  const hubBase = hubUrl.replace(/\/+$/, "");

  const greeting = pendingPosts.length > 0
    ? `Olá, ${firstName}! Quando puder, dá uma olhada no que a equipe preparou:`
    : pendingEvents.length > 0
    ? `Olá, ${firstName}! Confirme sua presença nos próximos eventos:`
    : `Olá, ${firstName}!`;

  const sections: string[] = [
    heading(buildPendingTitle(pendingPosts.length, unreadMessages, pendingEvents.length)) +
      paragraph(greeting, "body", "0"),
  ];

  if (pendingPosts.length > 0) {
    const visible = pendingPosts.slice(0, RENDERED_POSTS_CAP);
    const hidden = Math.max(0, pendingPosts.length - RENDERED_POSTS_CAP);
    sections.push(
      postList(visible) +
        (hidden > 0 ? paragraph(`e mais ${hidden} posts aguardando aprovação.`, "small", "8px 0 0") : ""),
    );
  }

  if (pendingEvents.length > 0) {
    sections.push(
      sectionTitle(CLIENT_EVENT_REMINDERS_HEADING) +
        pendingEvents.map((ev, i) => {
          const { mes, dia } = mesDiaAgenda(ev);
          return spacer(i === 0 ? 8 : 10) + (
            eventCard({
              mes, dia, tileColor: brandColor, titulo: ev.titulo,
              titleHref: hubBase ? `${hubBase}/agenda?ocorrencia=${ev.ocorrencia_id}` : null,
              lines: [formatarQuandoAgenda(ev)],
            })
          );
        }).join(""),
    );
  }

  if (unreadMessages > 0) {
    const label = unreadMessages === 1
      ? "<strong>1 mensagem não lida</strong> da equipe esperando você."
      : `<strong>${unreadMessages} mensagens não lidas</strong> da equipe esperando você.`;
    sections.push(callout(label));
  }

  // Posts keep their CTA; an events-only digest leads to the Hub Agenda.
  const eventsCta = pendingPosts.length === 0 && pendingEvents.length > 0;
  const ctaLabel = pendingPosts.length > 0 ? "Revisar e aprovar" : eventsCta ? "Confirmar presença" : "Ver mensagens";
  const ctaHref = eventsCta ? `${hubBase}/agenda` : hubUrl;
  const cta = hubUrl ? button(ctaHref, ctaLabel, { brandColor }) : "";
  if (cta) sections.push(cta);

  return brandedEmail({
    preheader: buildPendingPreheaderText(pendingPosts.length, unreadMessages, pendingEvents.length),
    workspaceName,
    brandColor,
    logoUrl,
    sections,
    footerHtml: [
      `Enviado por ${escapeHtml(workspaceName)} via Mesaas`,
      link(unsubUrl, "Não quero mais receber esses avisos", "#4b5563"),
    ],
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
