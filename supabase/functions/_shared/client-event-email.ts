import { escapeHtml } from "./report-template/escape.ts";
import { sanitizeSubjectValue } from "./lifecycle-emails.ts";

/**
 * Client-facing "you have pending items" email (Fase 2 do Hub: pendências).
 * Visual family mirrors _shared/report-template/email.ts (560px card,
 * logoSection with brandColor fallback, button pattern) so client-facing
 * transactional mail reads as one system.
 */
export interface ClientEventEmailParams {
  clienteNome: string;
  workspaceName: string;
  brandColor: string;
  logoUrl: string | null;
  pendingPosts: { titulo: string }[];
  unreadMessages: number;
  hubUrl: string;
  unsubUrl: string;
}

/** Max pending-post titles rendered as a list before folding the rest into "e mais N...". */
const RENDERED_POSTS_CAP = 20;

/**
 * `workspaceName` is tenant-editable free text. sanitizeSubjectValue strips
 * control characters (a bare newline makes Resend reject the whole send) and
 * bounds the length, same as the founder-notice subjects in lifecycle-emails.ts.
 */
export function clientEventSubject(workspaceName: string): string {
  return `Você tem pendências com ${sanitizeSubjectValue(workspaceName)}`;
}

export function buildClientEventEmail(p: ClientEventEmailParams): string {
  const {
    clienteNome, workspaceName, brandColor, logoUrl,
    pendingPosts, unreadMessages, hubUrl, unsubUrl,
  } = p;

  const safeName = escapeHtml(clienteNome.split(" ")[0]);
  const safeWorkspace = escapeHtml(workspaceName);
  const safeBrandColor = escapeHtml(brandColor);

  const logoSection = logoUrl
    ? `<tr><td align="center" style="padding: 30px 0 20px;"><img src="${
      escapeHtml(logoUrl)
    }" alt="${safeWorkspace}" style="max-height: 48px; max-width: 180px;" /></td></tr>`
    : `<tr><td align="center" style="padding: 30px 0 20px; font-size: 20px; font-weight: 700; color: ${safeBrandColor};">${safeWorkspace}</td></tr>`;

  // A pathologically dense digest window (see client-event-email-cron/handler.ts's
  // EVENTS_QUERY_CAP) could hand this builder hundreds of pending posts; render at
  // most RENDERED_POSTS_CAP as a list and fold the rest into a single summary line
  // rather than shipping an e-mail that's actually a wall of <li> tags.
  const visiblePosts = pendingPosts.slice(0, RENDERED_POSTS_CAP);
  const hiddenPostsCount = Math.max(0, pendingPosts.length - RENDERED_POSTS_CAP);
  const morePostsLine = hiddenPostsCount > 0
    ? `<p style="margin: 8px 0 0; font-size: 13px; color: #6b7280;">e mais ${hiddenPostsCount} posts aguardando aprovação.</p>`
    : "";

  const postsSection = pendingPosts.length > 0
    ? `<tr><td style="padding: 0 30px 20px;">
        <p style="margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; font-weight: 600;">Posts aguardando aprovação</p>
        <ul style="margin: 0; padding: 0 0 0 18px; font-size: 14px; line-height: 1.7; color: #374151;">
          ${visiblePosts.map((post) => `<li>${escapeHtml(post.titulo)}</li>`).join("")}
        </ul>
        ${morePostsLine}
       </td></tr>`
    : "";

  const unreadSection = unreadMessages > 0
    ? `<tr><td style="padding: 0 30px 20px;">
        <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #374151;">Você também tem <strong>${unreadMessages} mensagens não lidas</strong>.</p>
       </td></tr>`
    : "";

  const hubButton = hubUrl
    ? `<a href="${escapeHtml(hubUrl)}" style="display: inline-block; background: ${safeBrandColor}; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600;">Ver no Hub</a>`
    : "";

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
  <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.5; color: #4b5563;">Você tem pendências com <strong>${safeWorkspace}</strong>.</p>
</td></tr>
${postsSection}
${unreadSection}
<tr><td align="center" style="padding: 24px 30px 30px;">
  ${hubButton}
</td></tr>
<tr><td style="padding: 20px 30px; border-top: 1px solid #e5e7eb;">
  <p style="margin: 0 0 8px; font-size: 12px; color: #9ca3af; text-align: center;">Enviado por ${safeWorkspace} via Mesaas</p>
  <p style="margin: 0; font-size: 12px; color: #9ca3af; text-align: center;"><a href="${
    escapeHtml(unsubUrl)
  }" style="color: #9ca3af;">Não quero mais receber esses avisos</a></p>
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
