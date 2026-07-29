# Lifecycle Emails (Welcome + Subscription Thank-You) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send two one-shot PT-BR transactional emails via Resend — a visual welcome email to newly confirmed self-serve signups, and a thank-you email to the workspace owner when a subscription (trial or paid) starts.

**Architecture:** A shared `_shared/lifecycle-emails.ts` module holds pure HTML builders + Resend send helpers (deterministic `Idempotency-Key` per subject). A single new cron edge function `lifecycle-email-cron` (every 15 min, `x-cron-secret` auth) runs two sweeps fed by `SECURITY DEFINER` RPCs, guarded by a `lifecycle_emails` ledger: claim-upsert → send → set `delivered_at`; undelivered claims go stale after 1h and retry with the same idempotency key (no delete-on-failure, no duplicates). `stripe-webhook` is NOT modified. Spec: `docs/superpowers/specs/2026-07-29-lifecycle-emails-design.md`.

**Tech Stack:** Deno edge functions (Supabase), `npm:@supabase/supabase-js@2`, Resend REST API (with `Idempotency-Key`), Postgres migrations, pg_cron + vault, `deno test`.

## Global Constraints

- All emails PT-BR. Sender exactly: `Eduardo do Mesaas <eduardo@mesaas.com.br>`.
- Welcome subject exactly: `Bem-vindo ao Mesaas 👋`. Thank-you subject exactly: `Obrigado pela confiança 💚`.
- CSS-only visuals: inline-styled `<table>` HTML. The ONLY external image is the header logo `{appBaseUrl}/logo-white-email.png` (`width="221" height="28"`, `alt="Mesaas"`, white bold alt-text styling as blocked-image fallback). The asset `public/logo-white-email.png` is already committed on this branch. Palette: green `#1a3d2b`, cream `#f5f3ee`, white card `border-radius:16px`, `font-family:Arial,Helvetica,sans-serif` (match `_shared/invite-email.ts`).
- Positioning copy is "plataforma de gestão para agências de social media" (NOT "CRM").
- **No em-dashes (—) anywhere in either email's HTML** (user requirement: reads as AI slop). Tests enforce this.
- Every dynamic value through `escapeHtml` from `_shared/report-template/escape.ts` — including URLs in attribute context.
- Edge runtime is Deno: imports are `npm:` specifiers or relative `.ts` paths.
- Never log/return raw error details to clients; generic out, detailed `console.error` in.
- Migration filenames need unique timestamp prefixes; latest existing is `20260729000004_*`. This plan uses `20260730000001` and `20260730000002`.
- Working dir is the repo root worktree: `/Users/eduardosouza/Projects/sm-crm/.claude/worktrees/welcome-onboarding-emails-1ccaae`. All paths below are relative to it.
- Running `deno test` dirties the root `deno.lock` — run `git checkout -- deno.lock` before committing (known repo gotcha; `supabase/functions/deno.lock` is a DIFFERENT file, do not touch either).
- Before pushing/PR: `npm run lint`, `npm run format:check`, `npm run test`, and the deno suite must pass.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/functions/_shared/lifecycle-emails.ts` (create) | `firstNameFrom()`, `buildWelcomeEmail()`, `buildThankYouEmail()`, `sendWelcomeEmail()`, `sendThankYouEmail()` — pure builders + throwing Resend senders with idempotency keys |
| `supabase/functions/lifecycle-email-cron/handler.ts` (create) | Dependency-injected sweep logic: `runLifecycleEmailCron(deps)` |
| `supabase/functions/lifecycle-email-cron/index.ts` (create) | `Deno.serve` bootstrap: env, cron-secret gate, wires real deps |
| `supabase/migrations/20260730000001_lifecycle_emails.sql` (create) | Ledger table + 2 candidate RPCs + 2 backfill seeds |
| `supabase/migrations/20260730000002_schedule_lifecycle_email_cron.sql` (create) | pg_cron schedule (applied only AFTER function deploy) |
| `supabase/config.toml` (modify) | Add `[functions.lifecycle-email-cron] verify_jwt = false` |
| `supabase/functions/__tests__/lifecycle-emails_test.ts` (create) | Builder + sender tests |
| `supabase/functions/__tests__/lifecycle-email-cron_test.ts` (create) | Sweep-logic tests with fake deps |

---

### Task 1: Email builders (`_shared/lifecycle-emails.ts`)

**Files:**
- Create: `supabase/functions/_shared/lifecycle-emails.ts`
- Test: `supabase/functions/__tests__/lifecycle-emails_test.ts`
- Already committed on this branch (do not create): `public/logo-white-email.png` — the header logo the templates reference via `{appBaseUrl}/logo-white-email.png`

**Interfaces:**
- Consumes: `escapeHtml` from `supabase/functions/_shared/report-template/escape.ts`.
- Produces (used by Tasks 2 and 4):
  - `firstNameFrom(nome: string | null | undefined): string | null`
  - `buildWelcomeEmail(p: { firstName: string | null; appBaseUrl: string }): string`
  - `buildThankYouEmail(p: { firstName: string | null; workspaceName: string; appBaseUrl: string }): string`
  - `WELCOME_SUBJECT` / `THANKYOU_SUBJECT` string constants

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/__tests__/lifecycle-emails_test.ts` (assert helper matches the existing suite's `./assert.ts`):

```ts
import { assert } from "./assert.ts";
import {
  buildThankYouEmail,
  buildWelcomeEmail,
  firstNameFrom,
  THANKYOU_SUBJECT,
  WELCOME_SUBJECT,
} from "../_shared/lifecycle-emails.ts";

const BASE = "https://app.example.test";

Deno.test("firstNameFrom takes the first word and trims", () => {
  assert(firstNameFrom("  Ana Paula Souza ") === "Ana");
  assert(firstNameFrom("eduardo") === "eduardo");
  assert(firstNameFrom("") === null);
  assert(firstNameFrom("   ") === null);
  assert(firstNameFrom(null) === null);
  assert(firstNameFrom(undefined) === null);
});

Deno.test("buildWelcomeEmail greets by first name and escapes it", () => {
  const html = buildWelcomeEmail({ firstName: "<b>Ana</b>", appBaseUrl: BASE });
  assert(html.includes("Olá, &lt;b&gt;Ana&lt;/b&gt;!"), "escaped name greeting missing");
  assert(!html.includes("<b>Ana</b>"), "raw name leaked");
});

Deno.test("buildWelcomeEmail falls back to a nameless greeting", () => {
  const html = buildWelcomeEmail({ firstName: null, appBaseUrl: BASE });
  assert(html.includes("Olá!"), "nameless greeting missing");
  assert(!html.includes("Olá, "), "name greeting rendered without a name");
});

Deno.test("both emails carry the logo and never an em-dash", () => {
  for (
    const html of [
      buildWelcomeEmail({ firstName: "Ana", appBaseUrl: BASE }),
      buildThankYouEmail({ firstName: "Ana", workspaceName: "X", appBaseUrl: BASE }),
    ]
  ) {
    assert(html.includes(`src="${BASE}/logo-white-email.png"`), "logo img missing");
    assert(html.includes('alt="Mesaas"'), "logo alt missing");
    assert(!html.includes("—"), "em-dash found in email copy");
  }
});

Deno.test("buildWelcomeEmail carries the core content and links", () => {
  const html = buildWelcomeEmail({ firstName: "Ana", appBaseUrl: BASE });
  // positioning + feature cards
  assert(html.includes("plataforma de gestão para agências de social media"));
  assert(html.includes("Clientes &amp; CRM"));
  assert(html.includes("kanban"));
  assert(html.includes("Hub do cliente"));
  assert(html.includes("Analytics de Instagram"));
  // 3 steps + import wizard
  assert(html.includes("Comece em 3 passos"));
  assert(html.includes("Notion"));
  assert(html.includes("Trello"));
  assert(html.includes("ClickUp"));
  assert(html.includes("CSV"));
  assert(html.includes(`${BASE}/importar`));
  // resources
  assert(html.includes(`${BASE}/ajuda`));
  assert(html.includes(`${BASE}/novidades`));
  // reply invitation
  assert(html.includes("responder este e-mail"));
});

Deno.test("buildWelcomeEmail escapes the base URL in attribute context", () => {
  const html = buildWelcomeEmail({ firstName: null, appBaseUrl: "https://x.test/?a=1&b=2" });
  assert(html.includes("https://x.test/?a=1&amp;b=2"), "URL ampersand not entity-encoded");
  assert(!html.includes('href="https://x.test/?a=1&b='), "raw ampersand in href");
});

Deno.test("buildThankYouEmail thanks by name, escapes workspace, links plan settings", () => {
  const html = buildThankYouEmail({
    firstName: "Ana",
    workspaceName: "<script>Agencia</script>",
    appBaseUrl: BASE,
  });
  assert(html.includes("Olá, Ana!"));
  assert(html.includes("&lt;script&gt;Agencia&lt;/script&gt;"), "workspace not escaped");
  assert(!html.includes("<script>Agencia"), "raw workspace leaked");
  assert(html.includes(`${BASE}/configuracao`));
  assert(html.includes(`${BASE}/importar`));
  assert(html.includes("confiança"));
});

Deno.test("subjects are the spec'd strings", () => {
  assert(WELCOME_SUBJECT === "Bem-vindo ao Mesaas 👋");
  assert(THANKYOU_SUBJECT === "Obrigado pela confiança 💚");
});

Deno.test("thank-you copy has no charge language (works for trials)", () => {
  const html = buildThankYouEmail({ firstName: null, workspaceName: "X", appBaseUrl: BASE });
  for (const word of ["cobrança", "cobranca", "pagamento", "fatura"]) {
    assert(!html.toLowerCase().includes(word), `charge word present: ${word}`);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from repo root):
```bash
cd supabase/functions && deno test __tests__/lifecycle-emails_test.ts
```
Expected: FAIL — module `../_shared/lifecycle-emails.ts` not found.

- [ ] **Step 3: Write the module**

Create `supabase/functions/_shared/lifecycle-emails.ts`:

```ts
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
    ${featureCard("📋", "Entregas", "Kanban de workflows + calendário editorial.")}
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
<p style="margin:0 0 20px">Confiança não se ganha à toa. Obrigado por escolher o Mesaas para cuidar da operação da sua agência. Vamos trabalhar todos os dias para merecer essa escolha.</p>

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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd supabase/functions && deno test __tests__/lifecycle-emails_test.ts
```
Expected: all PASS. If the greeting assertions fail on exact strings, fix the template, not the test.

- [ ] **Step 5: Restore deno.lock and commit**

```bash
git checkout -- deno.lock 2>/dev/null; git status --short
git add supabase/functions/_shared/lifecycle-emails.ts supabase/functions/__tests__/lifecycle-emails_test.ts
git commit -m "feat(emails): welcome + thank-you lifecycle email builders"
```

---

### Task 2: Resend send helpers with idempotency keys

**Files:**
- Modify: `supabase/functions/_shared/lifecycle-emails.ts` (append)
- Test: `supabase/functions/__tests__/lifecycle-emails_test.ts` (append)

**Interfaces:**
- Consumes: builders/constants from Task 1.
- Produces (used by Task 4's bootstrap):
  - `sendWelcomeEmail(p: { to: string; firstName: string | null; appBaseUrl: string; idempotencyKey: string }): Promise<void>` — throws on missing key / non-2xx
  - `sendThankYouEmail(p: { to: string; firstName: string | null; workspaceName: string; appBaseUrl: string; idempotencyKey: string }): Promise<void>` — throws on missing key / non-2xx
  - Both send from `Eduardo do Mesaas <eduardo@mesaas.com.br>` (exported as `LIFECYCLE_FROM` for tests) and set the `Idempotency-Key` request header verbatim from `p.idempotencyKey`.
  - Fetches are bounded by `AbortSignal.timeout(10_000)` (edge kills bypass `catch` on unbounded I/O — repo failure mode); a Resend **409** (`invalid_idempotent_request`: same key, drifted payload) is treated as **success** since the key's existence proves the original send was accepted.

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/__tests__/lifecycle-emails_test.ts` (add `LIFECYCLE_FROM`, `sendThankYouEmail`, `sendWelcomeEmail` to the import):

```ts
Deno.test("sendWelcomeEmail posts to Resend with founder from + idempotency key", async () => {
  const original = globalThis.fetch;
  Deno.env.set("RESEND_API_KEY", "test-key");
  let capturedBody = "";
  let capturedKey: string | null = null;
  let capturedSignal: unknown = null;
  globalThis.fetch = ((_i: unknown, init?: RequestInit) => {
    capturedBody = String(init?.body ?? "");
    capturedKey = new Headers(init?.headers).get("Idempotency-Key");
    capturedSignal = init?.signal ?? null;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  try {
    await sendWelcomeEmail({
      to: "ana@example.test",
      firstName: "Ana",
      appBaseUrl: "https://x.test",
      idempotencyKey: "welcome/u1",
    });
  } finally {
    globalThis.fetch = original;
  }
  const payload = JSON.parse(capturedBody);
  assert(payload.from === LIFECYCLE_FROM);
  assert(payload.from === "Eduardo do Mesaas <eduardo@mesaas.com.br>");
  assert(payload.to[0] === "ana@example.test");
  assert(payload.subject === WELCOME_SUBJECT);
  assert(payload.html.includes("Olá, Ana!"));
  assert(capturedKey === "welcome/u1", `Idempotency-Key was ${capturedKey}`);
  assert(capturedSignal instanceof AbortSignal, "fetch is not bounded by an AbortSignal");
});

Deno.test("send helpers treat Resend 409 (payload drift on same key) as success", async () => {
  const original = globalThis.fetch;
  Deno.env.set("RESEND_API_KEY", "test-key");
  globalThis.fetch = (() =>
    Promise.resolve(new Response('{"name":"invalid_idempotent_request"}', { status: 409 }))) as typeof fetch;
  try {
    // Must NOT throw: the key's existence means the original send was accepted.
    await sendWelcomeEmail({
      to: "a@b.test",
      firstName: null,
      appBaseUrl: "https://x.test",
      idempotencyKey: "welcome/u1",
    });
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("sendThankYouEmail sets its idempotency key and throws on non-2xx", async () => {
  const original = globalThis.fetch;
  Deno.env.set("RESEND_API_KEY", "test-key");
  let capturedKey: string | null = null;
  globalThis.fetch = ((_i: unknown, init?: RequestInit) => {
    capturedKey = new Headers(init?.headers).get("Idempotency-Key");
    return Promise.resolve(new Response("nope", { status: 422 }));
  }) as typeof fetch;
  let threw = false;
  try {
    await sendThankYouEmail({
      to: "a@b.test",
      firstName: null,
      workspaceName: "X",
      appBaseUrl: "https://x.test",
      idempotencyKey: "subscription_thanks/w1",
    });
  } catch {
    threw = true;
  } finally {
    globalThis.fetch = original;
  }
  assert(threw, "expected non-2xx to throw");
  assert(capturedKey === "subscription_thanks/w1");
});

Deno.test("send helpers throw when RESEND_API_KEY is missing", async () => {
  const prev = Deno.env.get("RESEND_API_KEY");
  Deno.env.delete("RESEND_API_KEY");
  let threw = false;
  try {
    await sendWelcomeEmail({
      to: "a@b.test",
      firstName: null,
      appBaseUrl: "https://x.test",
      idempotencyKey: "welcome/u1",
    });
  } catch {
    threw = true;
  } finally {
    if (prev !== undefined) Deno.env.set("RESEND_API_KEY", prev);
  }
  assert(threw, "expected missing key to throw");
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

```bash
cd supabase/functions && deno test __tests__/lifecycle-emails_test.ts
```
Expected: the three new tests FAIL (missing exports); Task 1 tests still PASS.

- [ ] **Step 3: Implement the senders**

Append to `supabase/functions/_shared/lifecycle-emails.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd supabase/functions && deno test __tests__/lifecycle-emails_test.ts
```
Expected: all PASS.

- [ ] **Step 5: Restore deno.lock and commit**

```bash
git checkout -- deno.lock 2>/dev/null
git add supabase/functions/_shared/lifecycle-emails.ts supabase/functions/__tests__/lifecycle-emails_test.ts
git commit -m "feat(emails): Resend send helpers with idempotency keys"
```

---

### Task 3: Migration A — ledger, candidate RPCs, backfill seeds

**Files:**
- Create: `supabase/migrations/20260730000001_lifecycle_emails.sql`

**Interfaces:**
- Consumes: existing tables `workspaces (id, name, created_by)`, `workspace_members (user_id, workspace_id, role, joined_at)`, `workspace_subscriptions (workspace_id, stripe_subscription_id, status, created_at)`, `profiles (id, nome)`, `auth.users (id, email, email_confirmed_at)`.
- Produces (used by Task 4):
  - Table `lifecycle_emails (email_type, user_id, workspace_id, sent_at, delivered_at, attempts)` with unique constraints `lifecycle_emails_user_type (email_type, user_id)` and `lifecycle_emails_workspace_type (email_type, workspace_id)`.
  - RPC `get_welcome_email_candidates() → (user_id uuid, email text, nome text, attempts int)`
  - RPC `get_thankyou_email_candidates() → (workspace_id uuid, workspace_name text, owner_email text, owner_nome text, attempts int)`

There is no local DB harness — this task is SQL review + guard checks, no deno test. Migration correctness is additionally covered by Task 4's handler tests exercising the exact RPC names/shapes.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260730000001_lifecycle_emails.sql`:

```sql
-- Lifecycle emails: ledger + candidate RPCs + backfill seeds.
-- Spec: docs/superpowers/specs/2026-07-29-lifecycle-emails-design.md
-- Consumed by the lifecycle-email-cron edge function (service-role only).

-- 1) Ledger. sent_at = last claim/attempt; delivered_at = Resend accepted.
-- A row with delivered_at NULL, sent_at older than 1 hour, and attempts < 30
-- is a STALE claim: its subject becomes a candidate again and is re-sent with
-- the same Resend Idempotency-Key (deduped by Resend for 24h), so ambiguous
-- failures neither duplicate nor permanently suppress an email. attempts >= 30
-- is terminal (~30 hourly retries outlasts the 24h key window and a full-day
-- outage): the recipient is treated as permanently unreachable, visible in
-- cron_failures history. The 1h freshness gate also means failing claims are
-- excluded from ~3 of every 4 runs, so they cannot starve the batch.
create table if not exists lifecycle_emails (
  id           uuid primary key default gen_random_uuid(),
  email_type   text not null,
  user_id      uuid null references auth.users(id) on delete cascade,
  workspace_id uuid null references workspaces(id) on delete cascade,
  sent_at      timestamptz not null default now(),
  delivered_at timestamptz null,
  attempts     int not null default 0
);

-- Plain UNIQUE constraints, NOT partial unique indexes: PostgREST's on_conflict
-- (the claim upsert) cannot target a partial index. NULLs are distinct, so
-- welcome rows dedupe on (type, user_id) and thank-you rows on
-- (type, workspace_id); the cross-type NULL columns never collide.
alter table lifecycle_emails
  add constraint lifecycle_emails_user_type unique (email_type, user_id),
  add constraint lifecycle_emails_workspace_type unique (email_type, workspace_id);

alter table lifecycle_emails enable row level security;
-- No policies on purpose: only the service role (which bypasses RLS) touches this.

-- 2) Welcome candidates: confirmed self-serve users not yet delivered, not
-- freshly claimed, not attempt-capped. Self-serve discriminator is BOTH:
--   (a) workspaces.created_by = the user (set on the self-serve trigger path), AND
--   (b) no conta_id in the signup metadata — the trigger's invite branch is only
--       entered when conta_id metadata is present, and (b) covers the invite-path
--       fallback (20260719000002's COALESCE(ws_created_by, NEW.id)) where a
--       missing workspace with no prior owner gets created_by = the INVITED user,
--       which (a) alone would misclassify as self-serve.
-- No time window: the welcome seed below is the eligibility boundary, so
-- outages delay emails instead of dropping them.
create or replace function get_welcome_email_candidates()
returns table (user_id uuid, email text, nome text, attempts int)
language sql
security definer
set search_path = public
as $$
  select distinct on (u.id) u.id, u.email::text, p.nome, coalesce(le.attempts, 0)
  from auth.users u
  join workspaces ws on ws.created_by = u.id
  join workspace_members wm
    on wm.user_id = u.id and wm.workspace_id = ws.id and wm.role = 'owner'
  left join profiles p on p.id = u.id
  left join lifecycle_emails le
    on le.email_type = 'welcome' and le.user_id = u.id
  where u.email_confirmed_at is not null
    and u.email is not null
    and nullif(u.raw_user_meta_data ->> 'conta_id', '') is null
    and (le.id is null
         or (le.delivered_at is null
             and le.sent_at <= now() - interval '1 hour'
             and le.attempts < 30))
  order by u.id, u.email_confirmed_at asc
  limit 50
$$;

-- 3) Thank-you candidates: trialing/active subscriptions not yet delivered and
-- not freshly claimed, with the primary owner resolved deterministically:
-- workspaces.created_by if still an owner member, else oldest owner by
-- joined_at, tie-broken by user_id. Workspaces with no resolvable owner/email
-- produce no candidate row (they cannot occupy the batch; they become eligible
-- if an owner appears later). Deterministic order: oldest subscription first.
create or replace function get_thankyou_email_candidates()
returns table (workspace_id uuid, workspace_name text, owner_email text, owner_nome text, attempts int)
language sql
security definer
set search_path = public
as $$
  select ws.id, ws.name, u.email::text, p.nome, coalesce(le.attempts, 0)
  from workspace_subscriptions s
  join workspaces ws on ws.id = s.workspace_id
  cross join lateral (
    select wm.user_id
    from workspace_members wm
    where wm.workspace_id = ws.id and wm.role = 'owner'
    order by (wm.user_id = ws.created_by) desc, wm.joined_at asc, wm.user_id asc
    limit 1
  ) owner_pick
  join auth.users u on u.id = owner_pick.user_id
  left join profiles p on p.id = owner_pick.user_id
  left join lifecycle_emails le
    on le.email_type = 'subscription_thanks' and le.workspace_id = ws.id
  where s.status in ('trialing', 'active')
    and u.email is not null
    and (le.id is null
         or (le.delivered_at is null
             and le.sent_at <= now() - interval '1 hour'
             and le.attempts < 30))
  order by s.created_at asc, ws.id asc
  limit 50
$$;

-- 4) Lock both RPCs to the service role. GRANT explicitly: REVOKE FROM PUBLIC
-- alone also strips service_role (bit this repo before — check proacl, not
-- has_function_privilege).
revoke all on function get_welcome_email_candidates() from public, anon, authenticated;
grant execute on function get_welcome_email_candidates() to service_role;
revoke all on function get_thankyou_email_candidates() from public, anon, authenticated;
grant execute on function get_thankyou_email_candidates() to service_role;

-- 5) Backfill seeds (terminal rows: delivered_at set, nothing is mailed).
--
-- Thank-you: only rows where stripe_subscription_id IS NOT NULL. Row existence
-- is NOT the boundary — billing-checkout creates a placeholder row holding only
-- stripe_customer_id before the user completes Stripe Checkout, and a checkout
-- in flight during this deploy must still be thanked when it completes. A
-- subscription id means a subscription actually started at some point (any
-- status). Idempotent via ON CONFLICT DO NOTHING.
insert into lifecycle_emails (email_type, workspace_id, delivered_at)
select 'subscription_thanks', s.workspace_id, now()
from workspace_subscriptions s
where s.stripe_subscription_id is not null
on conflict do nothing;

-- Welcome: every currently confirmed self-serve owner (same join AND conta_id
-- metadata check as the RPC). This replaces a time-window: post-migration, ANY
-- confirmed self-serve owner without a ledger row gets the email, whenever
-- they confirm.
insert into lifecycle_emails (email_type, user_id, delivered_at)
select distinct 'welcome', u.id, now()
from auth.users u
join workspaces ws on ws.created_by = u.id
join workspace_members wm
  on wm.user_id = u.id and wm.workspace_id = ws.id and wm.role = 'owner'
where u.email_confirmed_at is not null
  and nullif(u.raw_user_meta_data ->> 'conta_id', '') is null
on conflict do nothing;
```

- [ ] **Step 2: Guard checks**

```bash
ls supabase/migrations | grep -c "^20260730000001" # must print 1 (no prefix collision)
ls supabase/migrations | awk -F_ '{print $1}' | sort | uniq -d # must print nothing
```
Expected: `1`, then empty output. If a collision appears, bump the prefix and re-check.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260730000001_lifecycle_emails.sql
git commit -m "feat(emails): lifecycle_emails ledger, candidate RPCs, backfill seeds"
```

---

### Task 4: Cron handler (`lifecycle-email-cron`)

**Files:**
- Create: `supabase/functions/lifecycle-email-cron/handler.ts`
- Create: `supabase/functions/lifecycle-email-cron/index.ts`
- Modify: `supabase/config.toml` (append at end, matching the `[functions.invite-expire-cron]` block style)
- Test: `supabase/functions/__tests__/lifecycle-email-cron_test.ts`

**Interfaces:**
- Consumes:
  - `firstNameFrom`, `sendWelcomeEmail`, `sendThankYouEmail` from `../_shared/lifecycle-emails.ts` (Tasks 1–2)
  - RPCs `get_welcome_email_candidates()` / `get_thankyou_email_candidates()` and ledger constraints (Task 3)
  - `buildCorsHeaders` (`../_shared/cors.ts`), `timingSafeEqual` (`../_shared/crypto.ts`), `createJsonResponder` (`../_shared/http.ts`), `reportCronFailure` (`../_shared/triage.ts`), `appBaseUrl` (`../_shared/app-url.ts`)
- Produces: `runLifecycleEmailCron(deps: LifecycleCronDeps): Promise<{ welcomeSent: number; thanksSent: number; failed: number }>` — exported for tests; `index.ts` is the thin `Deno.serve` shell.

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/__tests__/lifecycle-email-cron_test.ts`:

```ts
import { assert } from "./assert.ts";
import {
  type LifecycleCronDeps,
  runLifecycleEmailCron,
} from "../lifecycle-email-cron/handler.ts";

/**
 * Fake of the two supabase surfaces the handler touches: .rpc(name) and the
 * .from("lifecycle_emails") claim-upsert / delivered-update chains. Rows live
 * in-memory with the same (email_type, key) uniqueness as the real constraints.
 * Staleness (the 1-hour gate) lives in the real RPCs' SQL, so the fake models
 * it directly: candidates are subjects with no row, or an undelivered row
 * marked stale via `markStale`.
 */
function makeFakeDb(opts: {
  welcomeCandidates?: Array<{ user_id: string; email: string; nome: string | null }>;
  thankCandidates?: Array<
    { workspace_id: string; workspace_name: string; owner_email: string; owner_nome: string | null }
  >;
}) {
  type Row = {
    email_type: string;
    user_id?: string;
    workspace_id?: string;
    delivered: boolean;
    stale: boolean;
    attempts: number;
  };
  const rows: Row[] = [];
  const keyOf = (r: { user_id?: string; workspace_id?: string }) => r.user_id ?? r.workspace_id!;
  const find = (email_type: string, key: string) =>
    rows.find((r) => r.email_type === email_type && keyOf(r) === key);

  const db = {
    rows,
    markStale(email_type: string, key: string) {
      const r = find(email_type, key);
      if (r) r.stale = true;
    },
    rpc(name: string) {
      // Mirrors the SQL: eligible = no row, or an undelivered stale row under
      // the 30-attempt cap; the RPC returns the current attempts count.
      const eligible = (email_type: string, key: string) => {
        const r = find(email_type, key);
        return !r || (!r.delivered && r.stale && r.attempts < 30);
      };
      const attemptsOf = (email_type: string, key: string) =>
        find(email_type, key)?.attempts ?? 0;
      if (name === "get_welcome_email_candidates") {
        return Promise.resolve({
          data: (opts.welcomeCandidates ?? [])
            .filter((c) => eligible("welcome", c.user_id))
            .map((c) => ({ ...c, attempts: attemptsOf("welcome", c.user_id) })),
          error: null,
        });
      }
      if (name === "get_thankyou_email_candidates") {
        return Promise.resolve({
          data: (opts.thankCandidates ?? [])
            .filter((c) => eligible("subscription_thanks", c.workspace_id))
            .map((c) => ({ ...c, attempts: attemptsOf("subscription_thanks", c.workspace_id) })),
          error: null,
        });
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from(table: string) {
      assert(table === "lifecycle_emails");
      return {
        upsert(
          row: {
            email_type: string;
            user_id?: string;
            workspace_id?: string;
            sent_at: string;
            attempts: number;
          },
          o: { onConflict: string },
        ) {
          assert(
            o.onConflict === "email_type,user_id" || o.onConflict === "email_type,workspace_id",
            `bad onConflict ${o.onConflict}`,
          );
          assert(typeof row.sent_at === "string", "claim must refresh sent_at");
          assert(typeof row.attempts === "number", "claim must write the attempt count");
          const existing = find(row.email_type, keyOf(row));
          if (existing) {
            existing.stale = false;
            existing.attempts = row.attempts;
          } else rows.push({ ...row, delivered: false, stale: false });
          return Promise.resolve({ error: null });
        },
        update(patch: { delivered_at: string }) {
          assert(typeof patch.delivered_at === "string");
          const filters: Record<string, string> = {};
          const chain = {
            eq(col: string, val: string) {
              filters[col] = val;
              return chain;
            },
            then(resolve: (v: { error: null }) => void) {
              const r = find(filters.email_type, filters.user_id ?? filters.workspace_id);
              if (r) r.delivered = true;
              resolve({ error: null });
            },
          };
          return chain;
        },
      };
    },
  };
  return db;
}

function makeDeps(db: ReturnType<typeof makeFakeDb>, overrides?: Partial<LifecycleCronDeps>) {
  const sent: Array<{ kind: string; to: string; firstName: string | null; key: string }> = [];
  const deps: LifecycleCronDeps = {
    db: db as unknown as LifecycleCronDeps["db"],
    appBaseUrl: "https://x.test",
    now: () => new Date("2026-07-30T12:00:00Z"),
    sendWelcome: (p) => {
      sent.push({ kind: "welcome", to: p.to, firstName: p.firstName, key: p.idempotencyKey });
      return Promise.resolve();
    },
    sendThanks: (p) => {
      sent.push({ kind: "thanks", to: p.to, firstName: p.firstName, key: p.idempotencyKey });
      return Promise.resolve();
    },
    report: () => Promise.resolve(),
    ...overrides,
  };
  return { deps, sent };
}

Deno.test("welcome sweep claims, sends with first name + key, marks delivered", async () => {
  const db = makeFakeDb({
    welcomeCandidates: [{ user_id: "u1", email: "ana@x.test", nome: "Ana Paula Souza" }],
  });
  const { deps, sent } = makeDeps(db);
  const result = await runLifecycleEmailCron(deps);
  assert(result.welcomeSent === 1 && result.failed === 0);
  assert(sent.length === 1 && sent[0].kind === "welcome");
  assert(sent[0].to === "ana@x.test" && sent[0].firstName === "Ana");
  assert(sent[0].key === "welcome/u1", `key was ${sent[0].key}`);
  const row = db.rows[0];
  assert(row.email_type === "welcome" && row.user_id === "u1" && row.delivered);
});

Deno.test("delivered subjects are not re-sent", async () => {
  const db = makeFakeDb({
    welcomeCandidates: [{ user_id: "u1", email: "ana@x.test", nome: "Ana" }],
  });
  const { deps, sent } = makeDeps(db);
  await runLifecycleEmailCron(deps);
  await runLifecycleEmailCron(deps);
  assert(sent.length === 1, "delivered subject was re-sent");
});

Deno.test("failed send leaves an undelivered claim; stale retry uses the same key", async () => {
  const db = makeFakeDb({
    welcomeCandidates: [{ user_id: "u1", email: "ana@x.test", nome: "Ana" }],
  });
  let calls = 0;
  const { deps, sent } = makeDeps(db, {
    sendWelcome: (p) => {
      calls++;
      if (calls === 1) return Promise.reject(new Error("resend down"));
      sent.push({ kind: "welcome", to: p.to, firstName: p.firstName, key: p.idempotencyKey });
      return Promise.resolve();
    },
  });
  const first = await runLifecycleEmailCron(deps);
  assert(first.welcomeSent === 0 && first.failed === 1);
  assert(db.rows.length === 1 && !db.rows[0].delivered, "claim missing or wrongly delivered");

  // Fresh claim: not yet a candidate again.
  const second = await runLifecycleEmailCron(deps);
  assert(second.welcomeSent === 0 && sent.length === 0, "fresh claim was retried early");

  // After the 1h stale window (modeled by the fake), it retries with the SAME key
  // and increments the attempt count (1st attempt wrote 1, the retry writes 2).
  db.markStale("welcome", "u1");
  const third = await runLifecycleEmailCron(deps);
  assert(third.welcomeSent === 1);
  assert(sent[0].key === "welcome/u1", "retry did not reuse the idempotency key");
  assert(db.rows[0].attempts === 2, `attempts was ${db.rows[0].attempts}`);
});

Deno.test("thank-you sweep sends once per workspace with its key", async () => {
  const db = makeFakeDb({
    thankCandidates: [{
      workspace_id: "w1",
      workspace_name: "Agencia X",
      owner_email: "dono@x.test",
      owner_nome: "Bruno Lima",
    }],
  });
  const { deps, sent } = makeDeps(db);
  const first = await runLifecycleEmailCron(deps);
  const second = await runLifecycleEmailCron(deps);
  assert(first.thanksSent === 1 && second.thanksSent === 0);
  assert(sent.length === 1 && sent[0].kind === "thanks" && sent[0].firstName === "Bruno");
  assert(sent[0].key === "subscription_thanks/w1");
});

Deno.test("one candidate failing does not stop the rest of the batch", async () => {
  const db = makeFakeDb({
    welcomeCandidates: [
      { user_id: "u1", email: "a@x.test", nome: "A" },
      { user_id: "u2", email: "b@x.test", nome: "B" },
    ],
  });
  const { deps, sent } = makeDeps(db, {
    sendWelcome: (p) =>
      p.to === "a@x.test" ? Promise.reject(new Error("boom")) : (
        sent.push({ kind: "welcome", to: p.to, firstName: p.firstName, key: p.idempotencyKey }),
          Promise.resolve()
      ),
  });
  const result = await runLifecycleEmailCron(deps);
  assert(result.welcomeSent === 1 && result.failed === 1);
});

Deno.test("failures are reported through the triage dep", async () => {
  const db = makeFakeDb({
    welcomeCandidates: [{ user_id: "u1", email: "a@x.test", nome: "A" }],
  });
  let reported: { failed: number } | null = null;
  const { deps } = makeDeps(db, {
    sendWelcome: () => Promise.reject(new Error("boom")),
    report: (detail) => {
      reported = detail;
      return Promise.resolve();
    },
  });
  await runLifecycleEmailCron(deps);
  assert(reported !== null && reported.failed === 1, "triage report missing");
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd supabase/functions && deno test __tests__/lifecycle-email-cron_test.ts
```
Expected: FAIL — `../lifecycle-email-cron/handler.ts` not found.

- [ ] **Step 3: Implement the handler**

Create `supabase/functions/lifecycle-email-cron/handler.ts`:

```ts
/**
 * Sweep logic for the lifecycle-email cron, dependency-injected so tests can
 * drive it without a network.
 *
 * Protocol per candidate (both sweeps):
 *   claim-upsert (refresh sent_at) → send with a deterministic Resend
 *   Idempotency-Key → set delivered_at.
 * No ownership check and no delete-on-failure: the candidate RPCs exclude
 * delivered and fresh (<1h) claims, so a failed/crashed attempt goes stale
 * and retries with the SAME key — Resend dedupes keys for 24h, making
 * overlapping runs and ambiguous failures safe.
 */

import { firstNameFrom } from "../_shared/lifecycle-emails.ts";

interface DbResult<T> {
  data: T | null;
  error: { message: string } | null;
}

/** The two supabase-js surfaces this handler touches. */
export interface LifecycleDb {
  rpc(name: string): Promise<DbResult<unknown>>;
  from(table: "lifecycle_emails"): {
    upsert(
      row: {
        email_type: string;
        user_id?: string;
        workspace_id?: string;
        sent_at: string;
        attempts: number;
      },
      opts: { onConflict: string },
    ): PromiseLike<{ error: { message: string } | null }>;
    update(patch: { delivered_at: string }): {
      eq(col: string, val: string): {
        eq(col: string, val: string): PromiseLike<{ error: { message: string } | null }>;
      };
    };
  };
}

export interface CronReportDetail {
  failed: number;
  errors: Array<{ accountId?: string; error?: string }>;
}

export interface LifecycleCronDeps {
  db: LifecycleDb;
  appBaseUrl: string;
  now: () => Date;
  sendWelcome: (p: {
    to: string;
    firstName: string | null;
    appBaseUrl: string;
    idempotencyKey: string;
  }) => Promise<void>;
  sendThanks: (p: {
    to: string;
    firstName: string | null;
    workspaceName: string;
    appBaseUrl: string;
    idempotencyKey: string;
  }) => Promise<void>;
  report: (detail: CronReportDetail) => Promise<void>;
}

interface WelcomeCandidate {
  user_id: string;
  email: string;
  nome: string | null;
  attempts: number;
}

interface ThankCandidate {
  workspace_id: string;
  workspace_name: string;
  owner_email: string;
  owner_nome: string | null;
  attempts: number;
}

/** Claim refresh: bumps sent_at and writes attempts = prior + 1 (RPC-supplied). */
async function claim(
  deps: LifecycleCronDeps,
  row: { email_type: string; user_id?: string; workspace_id?: string; attempts: number },
  onConflict: string,
): Promise<void> {
  const { error } = await deps.db
    .from("lifecycle_emails")
    .upsert({ ...row, sent_at: deps.now().toISOString() }, { onConflict });
  if (error) throw new Error(`claim failed: ${error.message}`);
}

async function markDelivered(
  deps: LifecycleCronDeps,
  emailType: string,
  keyCol: "user_id" | "workspace_id",
  keyVal: string,
): Promise<void> {
  const { error } = await deps.db
    .from("lifecycle_emails")
    .update({ delivered_at: deps.now().toISOString() })
    .eq("email_type", emailType)
    .eq(keyCol, keyVal);
  // A failed update leaves an undelivered claim: the stale retry re-sends with
  // the same idempotency key and Resend dedupes. Log, don't throw.
  if (error) {
    console.error(
      `[lifecycle-email-cron] delivered_at update failed for ${emailType}/${keyVal}:`,
      error.message,
    );
  }
}

export async function runLifecycleEmailCron(
  deps: LifecycleCronDeps,
): Promise<{ welcomeSent: number; thanksSent: number; failed: number }> {
  let welcomeSent = 0;
  let thanksSent = 0;
  const errors: Array<{ accountId?: string; error?: string }> = [];

  // --- Welcome sweep -------------------------------------------------------
  const welcome = await deps.db.rpc("get_welcome_email_candidates");
  if (welcome.error) {
    errors.push({ error: `welcome candidates: ${welcome.error.message}` });
  } else {
    for (const c of (welcome.data ?? []) as WelcomeCandidate[]) {
      try {
        await claim(
          deps,
          { email_type: "welcome", user_id: c.user_id, attempts: c.attempts + 1 },
          "email_type,user_id",
        );
        await deps.sendWelcome({
          to: c.email,
          firstName: firstNameFrom(c.nome),
          appBaseUrl: deps.appBaseUrl,
          idempotencyKey: `welcome/${c.user_id}`,
        });
        await markDelivered(deps, "welcome", "user_id", c.user_id);
        welcomeSent++;
      } catch (e) {
        errors.push({
          accountId: c.user_id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  // --- Thank-you sweep -----------------------------------------------------
  const thanks = await deps.db.rpc("get_thankyou_email_candidates");
  if (thanks.error) {
    errors.push({ error: `thank-you candidates: ${thanks.error.message}` });
  } else {
    for (const c of (thanks.data ?? []) as ThankCandidate[]) {
      try {
        await claim(
          deps,
          {
            email_type: "subscription_thanks",
            workspace_id: c.workspace_id,
            attempts: c.attempts + 1,
          },
          "email_type,workspace_id",
        );
        await deps.sendThanks({
          to: c.owner_email,
          firstName: firstNameFrom(c.owner_nome),
          workspaceName: c.workspace_name,
          appBaseUrl: deps.appBaseUrl,
          idempotencyKey: `subscription_thanks/${c.workspace_id}`,
        });
        await markDelivered(deps, "subscription_thanks", "workspace_id", c.workspace_id);
        thanksSent++;
      } catch (e) {
        errors.push({
          accountId: c.workspace_id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  if (errors.length > 0) {
    console.error(`[lifecycle-email-cron] ${errors.length} failure(s)`, errors);
    await deps.report({ failed: errors.length, errors });
  }
  return { welcomeSent, thanksSent, failed: errors.length };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd supabase/functions && deno test __tests__/lifecycle-email-cron_test.ts
```
Expected: all PASS.

- [ ] **Step 5: Write the bootstrap**

Create `supabase/functions/lifecycle-email-cron/index.ts` (mirrors `invite-expire-cron/index.ts`; failure reporting mirrors `retention-radar-cron`'s `reportCronFailure` usage):

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { createJsonResponder } from "../_shared/http.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import { appBaseUrl } from "../_shared/app-url.ts";
import { sendThankYouEmail, sendWelcomeEmail } from "../_shared/lifecycle-emails.ts";
import { type LifecycleCronDeps, runLifecycleEmailCron } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ??
  (() => {
    throw new Error("CRON_SECRET is required");
  })();

const CRON_NAME = "lifecycle-email-cron";

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = buildCorsHeaders(req);
  const json = createJsonResponder(cors);

  if (!timingSafeEqual(req.headers.get("x-cron-secret") ?? "", CRON_SECRET)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  try {
    const deps: LifecycleCronDeps = {
      db: svc as unknown as LifecycleCronDeps["db"],
      appBaseUrl: appBaseUrl(),
      now: () => new Date(),
      sendWelcome: sendWelcomeEmail,
      sendThanks: sendThankYouEmail,
      report: (detail) => reportCronFailure(svc, CRON_NAME, detail),
    };
    const result = await runLifecycleEmailCron(deps);
    return json({ success: true, ...result });
  } catch (e) {
    // appBaseUrl() throwing (missing APP_BASE_URL) lands here too. The DB leg
    // of reportCronFailure records the failure even when Resend is down.
    console.error(
      `[${CRON_NAME}] run failed:`,
      e instanceof Error ? e.message : String(e),
    );
    await reportCronFailure(svc, CRON_NAME, {
      failed: 1,
      errors: [{ error: e instanceof Error ? e.message : String(e) }],
    });
    return json({ error: "Cron run failed" }, 500);
  }
});
```

- [ ] **Step 6: Add the config.toml entry**

Append to `supabase/config.toml` (same shape as the existing `[functions.invite-expire-cron]` block):

```toml
[functions.lifecycle-email-cron]
verify_jwt = false
```

- [ ] **Step 7: Run the full deno suite**

```bash
npm run test:functions
```
Expected: all tests pass (~780+). Then restore the lockfile:
```bash
git checkout -- deno.lock
```

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/lifecycle-email-cron supabase/functions/__tests__/lifecycle-email-cron_test.ts supabase/config.toml
git commit -m "feat(emails): lifecycle-email-cron edge function (welcome + thank-you sweeps)"
```

---

### Task 5: Migration B — pg_cron schedule

**Files:**
- Create: `supabase/migrations/20260730000002_schedule_lifecycle_email_cron.sql`

**Interfaces:**
- Consumes: deployed `lifecycle-email-cron` function (Task 4); vault secrets `project_url` and `cron_secret` (already present — every existing cron uses them).
- Produces: pg_cron job `lifecycle-email-cron`, every 15 minutes.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260730000002_schedule_lifecycle_email_cron.sql`:

```sql
-- Schedule lifecycle-email-cron every 15 minutes (welcome + subscription
-- thank-you sweeps; spec docs/superpowers/specs/2026-07-29-lifecycle-emails-design.md).
--
-- Must be applied AFTER the lifecycle-email-cron function is deployed AND
-- 20260730000001 (ledger + RPCs + seeds) is applied — the schedule fires
-- immediately (same ordering rule as 20260702000005).
--
-- Rollback order is the REVERSE: unschedule this job first
-- (SELECT cron.unschedule('lifecycle-email-cron')), then undeploy the
-- function. Keep the lifecycle_emails table and its rows — they are the
-- record of what was already sent; deleting them re-mails everyone on a
-- future re-rollout.
--
-- Uses the vault.decrypted_secrets subselect form, NOT vault.decrypted_secret(...)
-- (that function form does not exist on this instance — see 20260617120000's note).
--
-- Idempotent: safe to apply twice.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lifecycle-email-cron') THEN
    PERFORM cron.unschedule('lifecycle-email-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'lifecycle-email-cron',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/lifecycle-email-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

- [ ] **Step 2: Guard checks**

```bash
ls supabase/migrations | awk -F_ '{print $1}' | sort | uniq -d # must print nothing
```
Expected: empty output.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260730000002_schedule_lifecycle_email_cron.sql
git commit -m "feat(emails): schedule lifecycle-email-cron every 15 minutes"
```

---

### Task 6: Full verification + PR

**Files:**
- No new files. Runs the CI gates locally, greps for contract breakage, opens the PR.

**Interfaces:**
- Consumes: everything above.
- Produces: a green branch + PR. Deployment itself (db push, functions deploy, Resend sender check) is the ordered runbook in the spec's Rollout section and happens post-merge — record it in the PR description.

- [ ] **Step 1: Contract-breakage grep (repo rule)**

```bash
grep -rn "lifecycle_emails\|get_welcome_email_candidates\|get_thankyou_email_candidates" apps/ packages/ supabase/functions/__tests__ --include="*.ts" --include="*.tsx" -l
```
Expected: only the two new test files. Anything else must be read and reconciled.

- [ ] **Step 2: Run every CI gate locally**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/hub/tsconfig.json --noEmit && npx tsc -p apps/admin/tsconfig.json --noEmit && npx tsc -p tsconfig.scripts.json
npm run test
npm run test:functions
npm run lint
npm run format:check
git checkout -- deno.lock
```
Expected: all pass. `npm run format` fixes any prettier complaints (edge-function `.ts` files are not in prettier's scope — it covers `apps/**`/`packages/**` — but run the check regardless). Frontend suites are untouched by this feature, so failures there mean a pre-existing issue: report, don't paper over.

- [ ] **Step 3: Visual sanity render**

Generate the two HTML files and eyeball them in the browser preview:

```bash
cd supabase/functions && deno eval "
import { buildThankYouEmail, buildWelcomeEmail } from './_shared/lifecycle-emails.ts';
Deno.writeTextFileSync('/tmp/welcome.html', buildWelcomeEmail({ firstName: 'Ana', appBaseUrl: 'https://www.mesaas.com.br' }));
Deno.writeTextFileSync('/tmp/thankyou.html', buildThankYouEmail({ firstName: 'Bruno', workspaceName: 'Agência Exemplo', appBaseUrl: 'https://www.mesaas.com.br' }));
console.log('written');
"
```
Open both files in the browser preview and confirm: green header, 2×2 feature cards, numbered steps with the Importar CTA button, footer — no raw HTML entities visible, no broken layout. Fix template issues and re-run Task 1/2 tests if anything is off. Send both files to the user.

- [ ] **Step 4: Commit any stragglers, push, open PR**

```bash
git status --short   # expect clean except intended files
git push -u origin claude/welcome-onboarding-emails-1ccaae
gh pr create --title "feat: welcome + subscription thank-you lifecycle emails" --body "$(cat <<'EOF'
## Summary
- New `_shared/lifecycle-emails.ts`: PT-BR visual (CSS-only) welcome + thank-you email builders and Resend senders (deterministic `Idempotency-Key` per subject), from `Eduardo do Mesaas <eduardo@mesaas.com.br>`
- New `lifecycle-email-cron` edge function (15-min pg_cron): welcome sweep for confirmed self-serve owners, thank-you sweep for new trialing/active subscriptions
- `lifecycle_emails` ledger (claim → send → `delivered_at`; stale claims retry with the same key) + 2 SECURITY DEFINER candidate RPCs + backfill seeds (existing users/subscriptions never mailed; thank-you boundary is `stripe_subscription_id IS NOT NULL` so in-flight checkouts still get thanked)
- `stripe-webhook` deliberately untouched

Spec: `docs/superpowers/specs/2026-07-29-lifecycle-emails-design.md`

## Deploy runbook (ordered — schedule migration LAST)
1. Confirm `eduardo@mesaas.com.br` works as a Resend sender; confirm the `APP_BASE_URL` secret is set on BOTH staging and prod (`npx supabase secrets list`); after the Vercel deploy, confirm https://www.mesaas.com.br/logo-white-email.png returns 200
1b. Reply handling (user-side): create `eduardo@mesaas.com.br` as an alias in the UOL Host mail panel (domain MX = mx.uhserver.com) forwarding to the Crisp workspace's email redirection address, and test that a mail to it appears in Crisp — replies bounce without this
2. `npx supabase db push --linked` (applies 20260730000001; check `supabase/.temp/project-ref` first — staging before prod)
3. `npx supabase functions deploy lifecycle-email-cron --no-verify-jwt --use-api`
4. Push 20260730000002 (pg_cron schedule) — only after step 3
5. Staging verification: fresh signup gets welcome ≤15 min; synthetic `workspace_subscriptions` row (status `trialing`, non-null `stripe_subscription_id`) gets exactly one thank-you

Rollback: `SELECT cron.unschedule('lifecycle-email-cron')` FIRST, then undeploy; keep the `lifecycle_emails` table (it is the sent record).

## Test plan
- [x] `deno test`: builder escaping/copy/links, sender payloads + idempotency headers, sweep claim/delivered/stale-retry/batch logic
- [x] All four tsc projects, vitest, eslint, prettier locally

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Verify the external Codex review**

The repo auto-fires an external review on PR creation. When it lands, verify each finding against the code (don't rubber-stamp), fix what holds up, and reply to what doesn't.

---

## Self-Review (done at plan-writing time)

- **Spec coverage:** builders/copy/sections → Task 1; senders/founder-from/idempotency keys/bounded fetch/409-as-success → Task 2; ledger + `delivered_at` + `attempts` cap + RPCs + combined discriminator (created_by AND no conta_id metadata) + primary-owner rule + ordering + both seeds + placeholder-row boundary + `search_path` + grants → Task 3; claim→send→delivered protocol, attempt increments, stale retry, `reportCronFailure` triage, config.toml → Task 4; schedule + ordering + rollback comments → Task 5; rollout/runbook (incl. APP_BASE_URL check)/rollback + CI gates → Task 6.
- **Placeholders:** none — every step has runnable code/commands.
- **Type consistency:** `firstNameFrom`/`buildWelcomeEmail`/`buildThankYouEmail`/`sendWelcomeEmail`/`sendThankYouEmail`/`LIFECYCLE_FROM`/`WELCOME_SUBJECT`/`THANKYOU_SUBJECT` and the `idempotencyKey` parameter match across Tasks 1–4; RPC names and return columns in Task 3 SQL match Task 4's `WelcomeCandidate`/`ThankCandidate` interfaces and the fake DB; claim `onConflict` strings match Task 3's constraint columns; idempotency-key formats (`welcome/<user_id>`, `subscription_thanks/<workspace_id>`) match between handler and tests.
