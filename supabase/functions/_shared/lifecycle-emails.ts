import { escapeHtml } from "./report-template/escape.ts";

export const WELCOME_SUBJECT = "Bem-vindo ao Mesaas 👋";
export const THANKYOU_SUBJECT = "Obrigado pela confiança 💚";

/** First whitespace-separated word of profiles.nome; null when absent/blank. */
export function firstNameFrom(nome: string | null | undefined): string | null {
  const first = (nome ?? "").trim().split(/\s+/)[0];
  return first ? first : null;
}

/** "Olá, Ana!" or "Olá!" — name already escaped by callers below. */
function greeting(firstNameEscaped: string | null): string {
  return firstNameEscaped ? `Olá, ${firstNameEscaped}!` : "Olá!";
}

/**
 * Shared visual shell so both emails render as one family. Matches the
 * invite/dunning palette: green #1a3d2b on cream #f5f3ee, white 16px card.
 * `bodyHtml` is trusted template HTML built by this module only;
 * `baseEscaped` is the already-escaped app base URL. The header logo is the
 * one external image (email clients don't render SVG, so it's a hosted PNG);
 * its alt text is styled white/bold so blocked-image clients still show the
 * brand on the green header.
 */
function layout(bodyHtml: string, footerLine: string, baseEscaped: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR"><body style="margin:0;background:#f5f3ee;font-family:Arial,Helvetica,sans-serif;color:#1a3d2b">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden">
      <tr><td style="background:#1a3d2b;padding:26px 28px;text-align:center">
        <img src="${baseEscaped}/logo-white-email.png" width="221" height="28" alt="Mesaas" style="display:block;margin:0 auto;border:0;color:#ffffff;font-size:22px;font-weight:700">
      </td></tr>
      <tr><td style="padding:32px 28px;font-size:14px;line-height:1.7;color:#444441">
${bodyHtml}
      </td></tr>
      <tr><td style="padding:18px 28px;background:#f5f3ee;text-align:center;font-size:11px;color:#888780;line-height:1.5">
        ${footerLine}<br>Mesaas · gestão inteligente para social media managers
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

/** One feature card cell (used in a 2x2 table). Args are pre-escaped. */
function featureCard(emoji: string, title: string, text: string): string {
  return `<td width="50%" style="padding:6px" valign="top">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ee;border-radius:12px">
      <tr><td style="padding:14px 16px">
        <div style="font-size:20px;line-height:1">${emoji}</div>
        <div style="font-size:13px;font-weight:700;color:#1a3d2b;margin-top:6px">${title}</div>
        <div style="font-size:12px;color:#444441;margin-top:2px;line-height:1.5">${text}</div>
      </td></tr>
    </table>
  </td>`;
}

/** Numbered step row for the "Comece em 3 passos" block. Args pre-escaped except ctaHtml. */
function stepRow(n: number, html: string): string {
  return `<tr><td style="padding:8px 0" valign="top" width="34">
      <div style="width:24px;height:24px;border-radius:12px;background:#1a3d2b;color:#ffffff;font-size:13px;font-weight:700;text-align:center;line-height:24px">${n}</div>
    </td><td style="padding:8px 0;font-size:13px;line-height:1.6;color:#444441">${html}</td></tr>`;
}

function ctaButton(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:#1a3d2b;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:700;font-size:13px">${label}</a>`;
}

export function buildWelcomeEmail(p: { firstName: string | null; appBaseUrl: string }): string {
  const name = p.firstName ? escapeHtml(p.firstName) : null;
  const base = escapeHtml(p.appBaseUrl);
  const body = `
<p style="font-size:16px;font-weight:700;color:#1a3d2b;margin:0 0 12px">${greeting(name)}</p>
<p style="margin:0 0 8px">Aqui é o Eduardo, do Mesaas. Que bom ter você por aqui. Obrigado por criar sua conta.</p>
<p style="margin:0 0 20px">O Mesaas é uma <strong>plataforma de gestão para agências de social media</strong>: clientes, entregas, aprovações e analytics em um lugar só, com um portal whitelabel para o seu cliente final.</p>

<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px">
  <tr>
    ${featureCard("👥", "Clientes &amp; CRM", "Todos os seus clientes, briefings e contratos organizados.")}
    ${featureCard("📋", "Entregas", "kanban de workflows + calendário editorial.")}
  </tr>
  <tr>
    ${featureCard("✅", "Aprovações pelo Hub do cliente", "Portal whitelabel, sem login, com a sua marca.")}
    ${featureCard("📈", "Analytics de Instagram", "Métricas e relatórios prontos para enviar.")}
  </tr>
</table>

<p style="font-size:15px;font-weight:700;color:#1a3d2b;margin:0 0 4px">Comece em 3 passos</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px">
  ${stepRow(1, "Cadastre seu primeiro cliente.")}
  ${
    stepRow(
      2,
      `<strong>Importe seus dados</strong>: trazemos tudo do Notion, Trello, ClickUp ou CSV em poucos cliques.<br>
       <span style="display:inline-block;margin-top:10px">${ctaButton(`${base}/importar`, "Importar meus dados")}</span>`,
    )
  }
  ${stepRow(3, "Convide sua equipe e compartilhe o Hub com o cliente.")}
</table>

<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px">
  <tr><td style="padding:14px 16px;background:#f5f3ee;border-radius:12px;font-size:12px;line-height:1.6">
    📚 Dúvidas? A <a href="${base}/ajuda" style="color:#1a3d2b;font-weight:700">Central de Ajuda</a> tem guias passo a passo,
    e as <a href="${base}/novidades" style="color:#1a3d2b;font-weight:700">Novidades</a> mostram o que estamos lançando.
  </td></tr>
</table>

<p style="margin:0 0 4px">Qualquer dúvida, é só <strong>responder este e-mail</strong>. Eu leio e respondo pessoalmente.</p>
<p style="margin:0">Um abraço,<br><strong>Eduardo</strong> · Mesaas</p>`;
  return layout(body, "Você recebeu este e-mail porque criou uma conta no Mesaas.", base);
}

export function buildThankYouEmail(
  p: { firstName: string | null; workspaceName: string; appBaseUrl: string },
): string {
  const name = p.firstName ? escapeHtml(p.firstName) : null;
  const ws = escapeHtml(p.workspaceName);
  const base = escapeHtml(p.appBaseUrl);
  const body = `
<p style="font-size:16px;font-weight:700;color:#1a3d2b;margin:0 0 12px">${greeting(name)}</p>
<p style="margin:0 0 8px">Aqui é o Eduardo, do Mesaas. Vi que o <strong>${ws}</strong> acabou de ativar um plano e queria agradecer pessoalmente.</p>
<p style="margin:0 0 20px">Obrigado por depositar essa confiança no Mesaas. Vamos trabalhar todos os dias para merecer essa escolha e cuidar bem da operação da sua agência.</p>

<p style="font-size:15px;font-weight:700;color:#1a3d2b;margin:0 0 4px">Para aproveitar ao máximo</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px">
  ${stepRow(1, "Conecte o Instagram dos seus clientes e acompanhe as métricas.")}
  ${
    stepRow(
      2,
      `Traga seus dados de outras ferramentas: <a href="${base}/importar" style="color:#1a3d2b;font-weight:700">importe do Notion, Trello, ClickUp ou CSV</a>.`,
    )
  }
  ${stepRow(3, "Ative o Hub para os seus clientes aprovarem posts sem precisar de login.")}
</table>

<p style="margin:0 0 20px;font-size:12px;color:#888780">Seu plano fica em <a href="${base}/configuracao" style="color:#1a3d2b;font-weight:700">Configurações</a>, e você pode ajustá-lo quando quiser.</p>

<p style="margin:0 0 4px">Me conta: o que faria o Mesaas ser ainda melhor para a sua agência? É só <strong>responder este e-mail</strong>.</p>
<p style="margin:0">Um abraço,<br><strong>Eduardo</strong> · Mesaas</p>`;
  return layout(body, `Você recebeu este e-mail porque o workspace ${ws} ativou um plano no Mesaas.`, base);
}

export const LIFECYCLE_FROM = "Eduardo do Mesaas <eduardo@mesaas.com.br>";

/**
 * Throwing Resend POST. The Idempotency-Key makes retries after ambiguous
 * failures (lost response, crash after acceptance) safe: Resend dedupes the
 * same key for 24h. Callers pass a key deterministic per subject
 * (welcome/<user_id>, subscription_thanks/<workspace_id>).
 *
 * Bounded by AbortSignal: the edge runtime kills isolates on unbounded I/O in
 * ways that bypass catch entirely (repo-documented failure mode) — a timeout
 * must surface as a normal retryable throw instead.
 */
async function sendViaResend(
  to: string,
  subject: string,
  html: string,
  idempotencyKey: string,
): Promise<void> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ from: LIFECYCLE_FROM, to: [to], subject, html }),
    signal: AbortSignal.timeout(10_000),
  });
  // 409 invalid_idempotent_request: this key was already accepted with a
  // different payload (name/email drifted between attempts). The original
  // send happened — success, so the caller marks the claim delivered.
  if (res.status === 409) return;
  if (!res.ok) throw new Error(`Resend send failed: ${res.status}`);
}

export async function sendWelcomeEmail(
  p: { to: string; firstName: string | null; appBaseUrl: string; idempotencyKey: string },
): Promise<void> {
  await sendViaResend(
    p.to,
    WELCOME_SUBJECT,
    buildWelcomeEmail({ firstName: p.firstName, appBaseUrl: p.appBaseUrl }),
    p.idempotencyKey,
  );
}

export async function sendThankYouEmail(
  p: {
    to: string;
    firstName: string | null;
    workspaceName: string;
    appBaseUrl: string;
    idempotencyKey: string;
  },
): Promise<void> {
  await sendViaResend(
    p.to,
    THANKYOU_SUBJECT,
    buildThankYouEmail({
      firstName: p.firstName,
      workspaceName: p.workspaceName,
      appBaseUrl: p.appBaseUrl,
    }),
    p.idempotencyKey,
  );
}
