import { escapeHtml } from "./report-template/escape.ts";
import { sanitizeSubjectValue } from "./lifecycle-emails.ts";
import { buildBrandHeaderBand, buildPreheader, pickHeaderTextColor } from "./report-template/brand-header.ts";

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
}

/** Max pending-post titles rendered as a list before folding the rest into "e mais N...". */
const RENDERED_POSTS_CAP = 20;

/** `workflow_posts.tipo` CHECK: feed | reels | stories | carrossel (spec §11).
 * An unknown/future tipo (defensive -- the CHECK could grow before this map
 * does) falls back to the feed icon rather than rendering nothing. */
const POST_TYPE_ICONS: Record<string, string> = {
  feed: "🖼",
  carrossel: "🗂",
  reels: "🎬",
  stories: "📱",
};

function postTypeIcon(tipo: string): string {
  return POST_TYPE_ICONS[tipo] ?? "🖼";
}

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
 * messages only surface in the title when there are zero posts. Both zero is
 * unreachable in production (the cron releases the lease without sending in
 * that case), but the builder still needs a sane, non-crashing fallback for
 * a direct/manual call. */
function buildPendingTitle(postsCount: number, messagesCount: number): string {
  if (postsCount > 0) {
    return postsCount === 1 ? "1 post espera sua aprovação" : `${postsCount} posts esperam sua aprovação`;
  }
  if (messagesCount > 0) {
    return messagesCount === 1 ? "1 mensagem espera você" : `${messagesCount} mensagens esperam você`;
  }
  return "Você tem novidades";
}

/** Dynamic preheader text (spec §8/§11): "{N} posts aguardando sua aprovação
 * e {M} mensagens." with the zeroed part omitted entirely and singular forms
 * for exactly 1 of either. */
function buildPendingPreheaderText(postsCount: number, messagesCount: number): string {
  const parts: string[] = [];
  if (postsCount > 0) {
    parts.push(postsCount === 1 ? "1 post aguardando sua aprovação" : `${postsCount} posts aguardando sua aprovação`);
  }
  if (messagesCount > 0) {
    parts.push(messagesCount === 1 ? "1 mensagem" : `${messagesCount} mensagens`);
  }
  if (parts.length === 0) return "Você tem novidades.";
  return `${parts.join(" e ")}.`;
}

/** One post row: 24px icon cell (by tipo) + escaped titulo, its own bordered
 * box (spec §11: border #eceef2, radius 8). */
function buildPostRow(post: { titulo: string; tipo: string }): string {
  return `<tr><td style="padding: 0 0 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #eceef2; border-radius: 8px;">
      <tr>
        <td width="24" align="center" valign="middle" style="width: 24px; padding: 10px 0 10px 12px; font-size: 16px;">${
    postTypeIcon(post.tipo)
  }</td>
        <td valign="middle" style="padding: 10px 12px 10px 8px; font-size: 14px; color: #374151;">${
    escapeHtml(post.titulo)
  }</td>
      </tr>
    </table>
  </td></tr>`;
}

export function buildClientEventEmail(p: ClientEventEmailParams): string {
  const {
    clienteNome, workspaceName, brandColor, logoUrl,
    pendingPosts, unreadMessages, hubUrl, unsubUrl,
  } = p;

  const safeName = escapeHtml(clienteNome.split(" ")[0]);
  const safeWorkspace = escapeHtml(workspaceName);

  const headerBand = buildBrandHeaderBand({ workspaceName, brandColor, logoUrl });
  const preheader = buildPreheader(buildPendingPreheaderText(pendingPosts.length, unreadMessages));
  const title = buildPendingTitle(pendingPosts.length, unreadMessages);
  const greeting = pendingPosts.length > 0
    ? `Olá, ${safeName}! Quando puder, dá uma olhada no que a equipe preparou:`
    : `Olá, ${safeName}!`;

  // A pathologically dense digest window (see client-event-email-cron/handler.ts's
  // EVENTS_QUERY_CAP) could hand this builder hundreds of pending posts; render at
  // most RENDERED_POSTS_CAP as rows and fold the rest into a single summary line
  // rather than shipping an e-mail that's actually a wall of rows.
  const visiblePosts = pendingPosts.slice(0, RENDERED_POSTS_CAP);
  const hiddenPostsCount = Math.max(0, pendingPosts.length - RENDERED_POSTS_CAP);
  const morePostsLine = hiddenPostsCount > 0
    ? `<p style="margin: 8px 0 0; font-size: 13px; color: #6b7280;">e mais ${hiddenPostsCount} posts aguardando aprovação.</p>`
    : "";

  const postsSection = pendingPosts.length > 0
    ? `<tr><td style="padding: 0 30px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${visiblePosts.map(buildPostRow).join("")}
        </table>
        ${morePostsLine}
       </td></tr>`
    : "";

  const unreadLabel = unreadMessages === 1
    ? "<strong>1 mensagem não lida</strong> da equipe esperando você."
    : `<strong>${unreadMessages} mensagens não lidas</strong> da equipe esperando você.`;
  const unreadSection = unreadMessages > 0
    ? `<tr><td style="padding: 0 30px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f8f9fa; border-radius: 8px;">
          <tr>
            <td width="24" align="center" valign="middle" style="width: 24px; padding: 12px 0 12px 14px; font-size: 16px;">💬</td>
            <td valign="middle" style="padding: 12px 14px 12px 8px; font-size: 14px; color: #374151;">${unreadLabel}</td>
          </tr>
        </table>
       </td></tr>`
    : "";

  const ctaLabel = pendingPosts.length > 0 ? "Revisar e aprovar" : "Ver mensagens";
  const textColor = pickHeaderTextColor(brandColor);
  const hubButton = hubUrl
    ? `<a href="${
      escapeHtml(hubUrl)
    }" style="display: inline-block; background: ${brandColor}; color: ${textColor}; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600;">${ctaLabel}</a>`
    : "";

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
  <h1 style="margin: 0 0 8px; font-size: 22px; font-weight: 700; color: #111827;">${title}</h1>
  <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.5; color: #4b5563;">${greeting}</p>
</td></tr>
${postsSection}
${unreadSection}
<tr><td align="center" style="padding: 24px 30px 30px;">
  ${hubButton}
</td></tr>
<tr><td style="padding: 20px 30px; background: #f5f3ee; text-align: center;">
  <p style="margin: 0 0 8px; font-size: 12px; color: #888780;">Enviado por ${safeWorkspace} via Mesaas</p>
  <p style="margin: 0; font-size: 12px; color: #888780;"><a href="${
    escapeHtml(unsubUrl)
  }" style="color: #888780;">Não quero mais receber esses avisos</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
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

export async function signUnsubToken(clienteId: number, secret: string): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ c: clienteId })));
  const key = await hmacKey(secret, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

export async function verifyUnsubToken(
  token: string,
  secret: string,
): Promise<number | null> {
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
    const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as { c?: unknown };
    return typeof parsed.c === "number" ? parsed.c : null;
  } catch {
    return null;
  }
}
