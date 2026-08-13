# Pagar.me 12x — Fase 6: frontend (dialog de cartão + wiring + copy + admin)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The CRM-side UI for 12x installments: card checkout dialog (tokenize in the browser, POST to `pagarme-checkout`), subscriber management for Pagar.me rows (update card / cancel via `pagarme-subscription`), gated copy in the three pricing surfaces, PostHog funnel events, and the admin checkbox + plan-id field (threaded through `plan-mutations`). Everything stays dark until `plans.pagarme_12x_enabled` is checked AND `VITE_PAGARME_PUBLIC_KEY` is set.

**Architecture:** Shared dialog (`PagarmeCheckoutDialog`), no new route (no vercel.json change). Pure validation in `card-validation.ts`; tokenization is a direct browser POST to Pagar.me (`services/pagarme-token.ts`) — card data NEVER touches Supabase, our functions, logs, or PostHog (`ph-no-capture` on card/document fields; first use of that class in this codebase). Gate helper `lib/pagarme-gate.ts` = plan column && env key. Backend contracts are the Fase 3/5 functions, already deployed.

**Tech Stack:** React 19, shadcn Dialog + react-hook-form + zod + sonner (the `TarefaFormDialog` idiom), TanStack Query, Vitest + Testing Library.

## Global Constraints

- PT-BR user-facing copy, NO em-dashes (period/colon/"·" instead). Sentence case per house style.
- Card number, CVV, expiry, holder name and CPF/CNPJ inputs MUST carry `className="... ph-no-capture"` and autocomplete attributes (`cc-number`, `cc-name`, `cc-exp`, `cc-csc`). Card data never goes to PostHog, console, or any of our servers; the document/phone/address go ONLY in the `pagarme-checkout` body (they are forwarded to the gateway, never persisted by us).
- Tokenize ON SUBMIT (token expires in 60s, single-use); every retry re-tokenizes. The public key is `import.meta.env.VITE_PAGARME_PUBLIC_KEY`.
- Server is the authority on errors: surface the server's PT-BR `error` string when present, generic fallback otherwise. Never surface raw exception strings.
- Backend contracts (do not change them):
  - `POST {FUNCTIONS_BASE}/pagarme-checkout` body `{ plan_id, interval: "year", installments: 12, card_token, document, phone: { ddd, number }, billing_address: { cep, line_1, city, state }, source }` → 200 `{ status: "trialing"|"active", trial_ends_at, next_charge_at, installment_amount_cents }`; 4xx/5xx `{ error, code }`.
  - `POST {FUNCTIONS_BASE}/pagarme-subscription` body `{ action: "cancel" }` → `{ status: "canceled", access_until }`; body `{ action: "update_card", card_token, billing_address }` → `{ ok: true }`; errors `{ error, code }`.
  - Tokenization: `POST https://api.pagar.me/core/v5/tokens?appId={pk}` body `{ type: "card", card: { number, holder_name, exp_month, exp_year, cvv } }` → `{ id }`.
- Existing behavior with the gate OFF must be pixel-identical EXCEPT the CobrancaPage "em 12x de" lead, which is deliberately corrected to honest annual copy (it is false today).
- Run `npm run test` for frontend suites; the four tsc projects before pushing; no `npm run build` as a typecheck substitute.
- Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- `plan-mutations.ts` is an edge function (platform-admin): its change requires a `platform-admin` redeploy at deploy time — record in deploy notes, do NOT deploy in this plan.

---

### Task 1: Validation, tokenization and gate utilities

**Files:**
- Create: `apps/crm/src/components/billing/card-validation.ts`
- Create: `apps/crm/src/services/pagarme-token.ts`
- Create: `apps/crm/src/lib/pagarme-gate.ts`
- Modify: `apps/crm/src/vite-env.d.ts` (add `readonly VITE_PAGARME_PUBLIC_KEY?: string;`), `.env.example` (add `VITE_PAGARME_PUBLIC_KEY=` with a one-line comment)
- Test: `apps/crm/src/components/billing/__tests__/card-validation.test.ts`, `apps/crm/src/services/__tests__/pagarme-token.test.ts`, `apps/crm/src/lib/__tests__/pagarme-gate.test.ts`

**Interfaces:**
- Produces: everything below, consumed verbatim by Tasks 3-4.

- [ ] **Step 1: `card-validation.ts`** — pure, no imports:

```ts
// Client-side pre-validation for the Pagar.me card form. Format + check-digit level only:
// the gateway is the real authority. Nothing here is ever persisted or logged.

export function onlyDigits(v: string): string {
  return v.replace(/\D/g, '');
}

/** Luhn checksum over 13-19 digits. */
export function luhnValid(cardNumber: string): boolean {
  const digits = onlyDigits(cardNumber);
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** "MM/AA" -> { month, year(4 digits) } when well-formed and not in the past; null otherwise. */
export function parseExpiry(value: string, now: Date = new Date()): { month: number; year: number } | null {
  const m = /^(\d{2})\/(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const month = Number(m[1]);
  if (month < 1 || month > 12) return null;
  const year = 2000 + Number(m[2]);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59);
  if (endOfMonth < now) return null;
  return { month, year };
}

function cpfValid(d: string): boolean {
  if (/^(\d)\1{10}$/.test(d)) return false;
  for (const len of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const dv = ((sum * 10) % 11) % 10;
    if (dv !== Number(d[len])) return false;
  }
  return true;
}

function cnpjValid(d: string): boolean {
  if (/^(\d)\1{13}$/.test(d)) return false;
  const weights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (const len of [12, 13]) {
    const w = weights.slice(13 - len);
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * w[i];
    const dv = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    if (dv !== Number(d[len])) return false;
  }
  return true;
}

/** CPF (11 digits) or CNPJ (14 digits), check digits verified. */
export function documentValid(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length === 11) return cpfValid(d);
  if (d.length === 14) return cnpjValid(d);
  return false;
}

export function maskCardNumber(v: string): string {
  return onlyDigits(v).slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');
}

export function maskExpiry(v: string): string {
  const d = onlyDigits(v).slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

export function maskDocument(v: string): string {
  const d = onlyDigits(v).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  }
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export function maskCep(v: string): string {
  const d = onlyDigits(v).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export function maskPhone(v: string): string {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** { ddd, number } from a masked/raw phone with 10-11 digits, else null. */
export function splitPhone(value: string): { ddd: string; number: string } | null {
  const d = onlyDigits(value);
  if (d.length < 10 || d.length > 11) return null;
  return { ddd: d.slice(0, 2), number: d.slice(2) };
}
```

- [ ] **Step 2: `services/pagarme-token.ts`**:

```ts
// Card tokenization: browser -> Pagar.me directly. The ONLY consumer of raw card data in the
// app; nothing here may log, persist, or forward the card fields anywhere else. The token is
// single-use and expires in 60s: callers tokenize on submit and re-tokenize on every retry.

const TOKEN_URL = 'https://api.pagar.me/core/v5/tokens';

export interface CardInput {
  number: string;
  holderName: string;
  expMonth: number;
  expYear: number;
  cvv: string;
}

export class TokenizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenizationError';
  }
}

export async function tokenizeCard(card: CardInput): Promise<string> {
  const publicKey = import.meta.env.VITE_PAGARME_PUBLIC_KEY;
  if (!publicKey) throw new TokenizationError('Pagamento indisponível no momento.');
  let res: Response;
  try {
    res = await fetch(`${TOKEN_URL}?appId=${encodeURIComponent(publicKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        type: 'card',
        card: {
          number: card.number.replace(/\D/g, ''),
          holder_name: card.holderName.trim(),
          exp_month: card.expMonth,
          exp_year: card.expYear,
          cvv: card.cvv,
        },
      }),
    });
  } catch {
    throw new TokenizationError('Não foi possível validar o cartão. Verifique sua conexão.');
  }
  if (!res.ok) {
    throw new TokenizationError('Cartão recusado. Confira os dados ou tente outro cartão.');
  }
  const data = (await res.json().catch(() => null)) as { id?: string } | null;
  if (!data?.id) throw new TokenizationError('Cartão recusado. Confira os dados ou tente outro cartão.');
  return data.id;
}
```

- [ ] **Step 3: `lib/pagarme-gate.ts`**:

```ts
// The 12x rollout gate: per-plan admin checkbox AND the tokenization public key present in
// this environment. Both off = today's Stripe-annual behavior, byte-identical.
export function isPagarme12xEnabled(plan: { pagarme_12x_enabled?: boolean | null } | null | undefined): boolean {
  return Boolean(plan?.pagarme_12x_enabled) && Boolean(import.meta.env.VITE_PAGARME_PUBLIC_KEY);
}
```

- [ ] **Step 4: env plumbing** — `vite-env.d.ts` gains `readonly VITE_PAGARME_PUBLIC_KEY?: string;` (optional: unset in prod until the flip). `.env.example` gains the var with comment `# Pagar.me public key (pk_...) for card tokenization; unset = 12x UI disabled`.

- [ ] **Step 5: Tests.**
  - card-validation: Luhn true for `4000 0000 0000 0010` and `5555555555554444`, false for off-by-one digit, too-short, letters; parseExpiry valid future, past month rejected, current month accepted, `13/30` and `0/25` and `1225` rejected; documentValid true for CPF `111.444.777-35` and `529.982.247-25`, CNPJ `11.222.333/0001-81`, false for repeated-digit CPF `111.111.111-11`, wrong DV, 12-digit input; each masker's shaping incl. truncation; splitPhone 10 and 11 digits + rejects 9.
  - pagarme-token: mocks `fetch` (vi.stubGlobal) + `import.meta.env` (vi.stubEnv): posts ONLY to the Pagar.me host with the appId query; body carries digits-only number; resolves the token id; non-ok → TokenizationError with the fixed PT-BR message (assert the raw response body text does NOT leak into the error); network reject → connection message; missing env key → unavailable message without fetch being called.
  - pagarme-gate: 4-case matrix (column × env).

- [ ] **Step 6: Run `npm run test -- card-validation pagarme` (scoped) then full `npm run test`; commit** `feat(billing): card validation, Pagar.me tokenization and 12x gate utilities`.

---

### Task 2: Billing service extensions + analytics events

**Files:**
- Modify: `apps/crm/src/services/billing.ts`, `apps/crm/src/lib/analytics.ts`, `apps/crm/src/lib/checkout-analytics.ts`
- Test: `apps/crm/src/services/__tests__/billing.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces (Tasks 3-4 rely on these exact names):
  - `WorkspaceSubscription` gains `provider: string | null; installments: number | null;`
  - `BillingPlan` and `PublicPricingPlan` gain `pagarme_12x_enabled: boolean;`
  - `startPagarmeCheckout(payload: PagarmeCheckoutPayload): Promise<PagarmeCheckoutResult>`
  - `cancelPagarmeSubscription(): Promise<{ status: string; access_until: string | null }>`
  - `updatePagarmeCard(cardToken: string, billingAddress: PagarmeBillingAddress): Promise<void>`
  - `captureCheckoutStarted(planId, interval, source, provider?: 'stripe' | 'pagarme')`

- [ ] **Step 1: `billing.ts`.**
  - `WorkspaceSubscription` += `provider: string | null; installments: number | null;`. `getWorkspaceSubscription`'s select string += `, provider, installments, pagarme_subscription_id, ever_subscribed_at`; map `provider: data.provider ?? null`, `installments: data.installments ?? null`; `hasEverSubscribed: Boolean(data.stripe_subscription_id || data.pagarme_subscription_id || data.ever_subscribed_at)`.
  - `BillingPlan`/`PublicPricingPlan` += `pagarme_12x_enabled: boolean;`; add `pagarme_12x_enabled` to BOTH select strings in `listActivePlans`/`listPublicPricingPlans`, mapping with `Boolean(...)`.
  - New types + functions (same `FUNCTIONS_BASE`/`authHeaders` idiom as `startCheckout`; on non-ok parse `{error, code}` and throw `new Error(data?.error ?? 'Erro ao processar o pagamento. Tente novamente.')` carrying `code` via a custom `BillingApiError extends Error { code?: string }`):

```ts
export interface PagarmeBillingAddress { cep: string; line_1: string; city: string; state: string; }
export interface PagarmeCheckoutPayload {
  plan_id: string;
  card_token: string;
  document: string;
  phone: { ddd: string; number: string };
  billing_address: PagarmeBillingAddress;
  source: CheckoutSource;
}
export interface PagarmeCheckoutResult {
  status: 'trialing' | 'active';
  trial_ends_at: string | null;
  next_charge_at: string | null;
  installment_amount_cents: number;
}

export async function startPagarmeCheckout(payload: PagarmeCheckoutPayload): Promise<PagarmeCheckoutResult> {
  const res = await fetch(`${FUNCTIONS_BASE}/pagarme-checkout`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ ...payload, interval: 'year', installments: 12 }),
  });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw new BillingApiError((data?.error as string) ?? 'Erro ao processar o pagamento. Tente novamente.', data?.code as string | undefined);
  return data as unknown as PagarmeCheckoutResult;
}
```
  `cancelPagarmeSubscription` / `updatePagarmeCard` POST `pagarme-subscription` with `{action:'cancel'}` / `{action:'update_card', card_token, billing_address}`, same error idiom.
- [ ] **Step 2: analytics.** `AnalyticsEvent` union += `'card_form_submitted' | 'card_tokenization_failed' | 'checkout_completed' | 'checkout_failed' | 'card_form_abandoned'`. `captureCheckoutStarted` gains optional 4th param `provider: 'stripe' | 'pagarme' = 'stripe'`, added to the properties as `provider`. Existing call sites keep working (default).
- [ ] **Step 3: Tests.** Extend `billing.test.ts`: hasEverSubscribed true via each of the three columns and false for the abandoned-checkout row (all four cases); `pagarme_12x_enabled` mapped into both plan lists; `startPagarmeCheckout` posts the exact body (spread + interval/installments constants) and surfaces the server `error` string + `code` on 400; `cancelPagarmeSubscription`/`updatePagarmeCard` bodies; `captureCheckoutStarted` default provider `stripe` and explicit `pagarme`.
- [ ] **Step 4: `npm run test`; commit** `feat(billing): pagarme service calls + provider-aware subscription + funnel events`.

---

### Task 3: `PagarmeCheckoutDialog`

**Files:**
- Create: `apps/crm/src/components/billing/PagarmeCheckoutDialog.tsx`
- Test: `apps/crm/src/components/billing/__tests__/PagarmeCheckoutDialog.test.tsx`

**Interfaces:**
- Consumes: Task 1 utilities, Task 2 services/events, shadcn `Dialog`/`Form`/`Input`/`Button`, `toast` from sonner.
- Produces (Task 4 mounts it):

```ts
export interface PagarmeCheckoutDialogProps {
  open: boolean;
  onClose: () => void;
  mode: 'checkout' | 'update-card';
  plan: { id: string; name: string; price_brl_annual: number } | null; // required in checkout mode
  source: CheckoutSource; // 'billing' | 'onboarding'
  trialEligible: boolean; // checkout mode: !subscription.hasEverSubscribed
  onSuccess: () => void;  // parent refetches subscription/plan
}
```

- [ ] **Step 1: implement.** `TarefaFormDialog` idiom (Dialog + react-hook-form + zodResolver + sonner). Internal step state `'form' | 'success'` (+ `saving` bool for submitting). Zod schema (checkout mode): `cardNumber` (refine `luhnValid`, message `'Número de cartão inválido.'`), `holderName` (min 2), `expiry` (refine `parseExpiry !== null`, `'Validade inválida.'`), `cvv` (`/^\d{3,4}$/`), `document` (refine `documentValid`, `'CPF ou CNPJ inválido.'`), `phone` (refine `splitPhone !== null`, `'Celular inválido.'`), `cep` (8 digits), `line1` (min 3), `city` (min 2), `state` (`/^[A-Za-z]{2}$/`, uppercased). `update-card` mode: same schema MINUS `document` and `phone` (those fields not rendered).
  - Inputs use the maskers in `onChange` (set masked value back through `field.onChange`); card fields + document carry `ph-no-capture` and the `cc-*` autocomplete attributes; CVV `type="password"` `inputMode="numeric"`.
  - Header: checkout → title `Assinar o plano {plan.name}`, description `Anual no cartão de crédito`; update-card → `Atualizar cartão` / `A próxima cobrança usa o novo cartão.`
  - Summary block (checkout only): `12x de {formatBRL(Math.round(plan.price_brl_annual / 12))} sem juros` + `total {formatBRL(plan.price_brl_annual)}/ano` (reuse the page's existing `formatBRL`-style helper; define a local `formatBRL` if none is importable).
  - Trial note (checkout && trialEligible): `30 dias grátis. A primeira parcela só é cobrada depois do teste e você pode cancelar antes.`
  - Security note (both modes): `Seus dados vão direto para a Pagar.me com segurança. Nós não armazenamos o número do seu cartão.`
  - Submit flow: `captureEvent('card_form_submitted', { mode, plan_id })` → `tokenizeCard(...)`; on `TokenizationError` → `captureEvent('card_tokenization_failed', { mode })`, `form.setError('cardNumber', { message: err.message })`, stop. Then checkout mode: `startPagarmeCheckout({ plan_id, card_token, document: onlyDigits(document), phone: splitPhone(phone)!, billing_address: { cep: onlyDigits(cep), line_1: line1.trim(), city: city.trim(), state: state.toUpperCase() }, source })` → `captureEvent('checkout_completed', { plan_id, provider: 'pagarme' })` → success step with `trial_ends_at` (formatted `dd/MM/yyyy` via date-fns) → CTA `Ir para o painel`/`Fechar` calls `onSuccess()` + `onClose()`. On `BillingApiError` → `captureEvent('checkout_failed', { plan_id, code })`, `toast.error(err.message)`. update-card mode: `updatePagarmeCard(token, address)` → `toast.success('Cartão atualizado!')` → `onSuccess()` + `onClose()`.
  - CTA label: checkout && trialEligible → `Começar 30 dias grátis`; checkout otherwise → `Confirmar assinatura`; update-card → `Salvar novo cartão`. Disabled while `saving`.
  - Closing mid-form (not saving, not success, form dirty) fires `captureEvent('card_form_abandoned', { mode })` once.
- [ ] **Step 2: tests** (Testing Library, mock `tokenizeCard`, `startPagarmeCheckout`, `updatePagarmeCard`, `captureEvent`): renders summary + trial note (and hides trial note when `trialEligible: false`); document/phone absent in update-card mode; invalid Luhn shows the message and never calls tokenize; happy checkout path calls tokenize then startPagarmeCheckout with digits-only payload and shows the success step with the formatted date; TokenizationError surfaces on the card field + fires `card_tokenization_failed`; BillingApiError toasts the server message + fires `checkout_failed`; update-card happy path calls updatePagarmeCard and closes; card inputs have `ph-no-capture`; retry after failure calls tokenizeCard AGAIN (new token).
- [ ] **Step 3: `npm run test`; commit** `feat(billing): PagarmeCheckoutDialog (checkout + update-card)`.

---

### Task 4: Wiring + copy (CobrancaPage, ComecarPage, PricingSection)

**Files:**
- Modify: `apps/crm/src/pages/configuracao/cobranca/CobrancaPage.tsx`, `apps/crm/src/pages/comecar/ComecarPage.tsx`, `apps/crm/src/pages/landing/PricingSection.tsx`
- Test: extend `CobrancaPage.test.tsx`, `ComecarPage.test.tsx`

**Interfaces:** Consumes Tasks 1-3. No new exports.

- [ ] **Step 1: CobrancaPage.**
  - State `const [pagarmeDialog, setPagarmeDialog] = useState<{ mode: 'checkout' | 'update-card'; plan: BillingPlan | null } | null>(null);`
  - `handleUpgrade`: when `interval === 'year'` and the target plan's `isPagarme12xEnabled(plan)` → `captureCheckoutStarted(planId, 'year', 'billing', 'pagarme'); setPagarmeDialog({ mode: 'checkout', plan });` and return (no redirect, no `setBusy`). Else unchanged.
  - Mount `<PagarmeCheckoutDialog open={!!pagarmeDialog} mode={...} plan={...} source="billing" trialEligible={!subscription?.hasEverSubscribed} onClose={() => setPagarmeDialog(null)} onSuccess={pollAfterSuccess} />` where `pollAfterSuccess` reuses the existing 5×2s refetch loop (extract the loop body from the `status === 'success'` effect into a `startPlanRefetchPoll()` function used by both).
  - Manage block (lines ~184-214): the enclosing condition today is `hasActiveSub` (active || trialing) — for pagarme rows it MUST also include `past_due`, because `pagarme-subscription` treats past_due as in force, a new checkout is 409-blocked, and update-card is THE dunning recovery path; hiding it would strand a failed-installment customer with no visible action. Concretely: `const showPagarmeManage = subscription?.provider === 'pagarme' && ['active','trialing','past_due'].includes(subscription.status ?? '')`. Inside it: for `past_due`, show a warning line first (`Não conseguimos cobrar seu cartão. Atualize os dados para manter o acesso.`, using the page's existing warning styling if one exists, else `--danger-text` classed copy). Then the two buttons: `Atualizar cartão` (opens dialog `{mode:'update-card', plan:null}`) and `Cancelar assinatura` (shadcn `AlertDialog`; description: trialing → `Sua assinatura será cancelada agora, sem cobrança.`; past_due → `Sua assinatura será cancelada agora.`; active with `current_period_end` → `Seu acesso continua até {dd/MM/yyyy}. Depois disso, o workspace volta ao plano gratuito.`; confirm → `cancelPagarmeSubscription()` → `toast.success('Assinatura cancelada.')` + `startPlanRefetchPoll()`; error → `toast.error(err.message)`). Stripe rows keep the existing `hasActiveSub` + portal button untouched.
  - Copy line ~284 (`em 12x de` lead): render `em 12x de` ONLY when the plan passes `isPagarme12xEnabled`; otherwise `cobrado anualmente,` with the same monthly figure line below (keep layout; today's copy is false for Stripe annual).
- [ ] **Step 2: ComecarPage.** `startAndRedirect` is a MODULE-scope helper with no access to component state — do not try to open the dialog from inside it. Restructure: add a COMPONENT-scoped dispatcher `const beginCheckout = async (planId: string, interval: BillingInterval): Promise<boolean> => { const plan = plans?.find((p) => p.id === planId); if (interval === 'year' && isPagarme12xEnabled(plan)) { captureCheckoutStarted(planId, 'year', 'onboarding', 'pagarme'); setPagarmeDialog({ plan }); return true; } return startAndRedirect(planId, interval); }` and route BOTH call paths through it: the auto-intent effect (its existing `autoStarted` ref already prevents double-fire; opening the dialog counts as "started" so the ref is set the same way) and the manual `handleStart`. `startAndRedirect` itself stays untouched as the Stripe path. Dialog mount: `source="onboarding"`, `trialEligible` from the page's subscription data if it loads any; if the page loads no subscription today, add a `useQuery(['billing','subscription'], getWorkspaceSubscription, { enabled: isOwner-equivalent })` and use `!data?.hasEverSubscribed`, defaulting `true` while loading. `onSuccess` → `navigate('/dashboard?trial=started')`. Closing the dialog without completing does NOT re-trigger the auto-intent (ref stays set); the plan grid remains usable. Copy line ~256: when year && gate → `depois 12x de {formatBRL(monthly)} no cartão`; unchanged otherwise.
- [ ] **Step 3: PricingSection.** Line ~193-197: when `isYear && plan passes the gate` → `12x de {formatPrice(Math.round(plan.price_brl_annual / 12))} no cartão, sem juros (total {formatPrice(plan.price_brl_annual)}/ano)`; otherwise the existing `cobrado anualmente (...)` copy. (Landing CTAs keep navigating to signup/comecar; no dialog here.)
- [ ] **Step 4: tests.** CobrancaPage: gate ON + year upgrade opens the dialog and does NOT call `startCheckout`; gate OFF year upgrade still calls `startCheckout`; pagarme subscriber sees `Atualizar cartão`/`Cancelar assinatura` and no `Gerenciar assinatura`; pagarme `past_due` subscriber ALSO sees the manage controls plus the warning line (the recovery-path case); stripe subscriber unchanged (incl. stripe past_due NOT gaining the pagarme controls); cancel confirm calls `cancelPagarmeSubscription`; "em 12x de" appears only when gated on (and `cobrado anualmente` otherwise). ComecarPage: year+gate opens dialog instead of redirect (assert `startCheckout` NOT called, `captureCheckoutStarted` called with `'pagarme'`); the AUTO-INTENT path with year+gate also opens the dialog (not a redirect); month path unchanged.
- [ ] **Step 5: `npm run test`; commit** `feat(billing): wire 12x dialog into Cobranca/Comecar/Pricing with gated copy`.

---

### Task 5: Admin checkbox + plan-id threading + full CI battery

**Files:**
- Modify: `supabase/functions/platform-admin/plan-mutations.ts`, `apps/admin/src/lib/api.ts`, `apps/admin/src/pages/plan-form.ts`, `apps/admin/src/pages/PlansPage.tsx`
- Test: `apps/admin/src/pages/__tests__/plan-form.test.ts` (extend); check `supabase/functions/__tests__/` for a plan-mutations test to extend

**Interfaces:** Consumes nothing from Tasks 1-4 (independent slice).

- [ ] **Step 1: `plan-mutations.ts`.** Add `"pagarme_12x_enabled", "pagarme_plan_id_annual"` to `allowedScalar` (update path) AND to `handleCreatePlan`'s explicit `if (rest.x !== undefined)` whitelist block (both fields; without the create block the field silently doesn't save on create). SERVER-SIDE VALIDATION (both create and update): enabling the checkbox on a misconfigured plan advertises 12x publicly and then 400s at checkout, so reject with 400 `{ error: "pagarme_12x_enabled requires pagarme_plan_id_annual and a positive price_brl_annual" }` when the RESULTING row would have `pagarme_12x_enabled = true` with a null/empty `pagarme_plan_id_annual` or a non-positive `price_brl_annual` (on update, merge the incoming fields over the current row before checking — read the row if the payload alone can't decide).
- [ ] **Step 2: admin frontend.** `api.ts` `Plan` interface += `pagarme_12x_enabled: boolean; pagarme_plan_id_annual: string | null;`. `plan-form.ts`: add to `FormState` (`pagarme_12x_enabled: boolean; pagarme_plan_id_annual: string;`), `emptyFormState`, `planToForm` (null → ''), `formToPayload` (trim; '' → null for the id). `PlansPage.tsx`: checkbox `Parcelamento 12x (Pagar.me)` using the exact `is_default` checkbox idiom, plus a text input `Pagar.me plan ID (annual)` alongside the Stripe ID inputs (placeholder `plan_...`).
- [ ] **Step 3: tests.** plan-form round-trips: form → payload includes both fields ('' id → null); plan → form (null id → ''); extend any existing plan-mutations Deno test with: update accepts the two new scalars, create persists them, AND the validation matrix: enable-without-id → 400, enable-without-positive-annual-price → 400, enable-with-both → ok, update that only flips the boolean on an already-configured row → ok (merge-over-current check), disabling never validates.
- [ ] **Step 4: full CI battery** (same list as Fase 5 Task 4: lint, format:check, 4× tsc, `npm run test`, `npm run test:functions`, revert deno.lock, npm-ci if polluted). Commit `feat(admin): pagarme 12x checkbox + annual plan id threading`.

---

## Deploy notes (execute only on explicit user order)

1. `npx supabase functions deploy platform-admin --no-verify-jwt --use-api` in both envs (plan-mutations changed) BEFORE admins use the new fields. No migration in this phase.
2. CRM/Admin frontends ship via Vercel on merge. `VITE_PAGARME_PUBLIC_KEY` goes to Vercel env ONLY at flip time (staging first: sandbox pk). Without it every new surface is inert.
3. **FLIP ORDER IS LOAD-BEARING (accepted external finding):** `billing-checkout` already 400s annual Stripe checkout for any plan with `pagarme_12x_enabled = true`, regardless of the frontend key. Checking the admin box BEFORE the CRM build with `VITE_PAGARME_PUBLIC_KEY` is live breaks EVERY annual checkout for that plan (frontend falls back to Stripe, backend rejects). Per env, the order is: (1) set `VITE_PAGARME_PUBLIC_KEY` in Vercel + redeploy/verify the CRM build serves it; (2) only then check `pagarme_12x_enabled` per plan (with `pagarme_plan_id_annual` filled; the server-side validation in plan-mutations enforces the config half, but it cannot see the frontend env — the ordering is operational). Rollback = uncheck the box first.
4. Flip checklist stays the Fase 5 gate + support GO; the admin checkbox is the per-plan switch.

## Riscos aceitos / follow-ups

- Tokenization is a direct browser POST (spike proved CORS works); the tokenizejs fallback from the master plan is dropped unless staging E2E hits CORS.
- `card_form_abandoned` fires only on dirty-close of the dialog (no timers).
- Mensal Stripe → 12x continues to require cancel-then-resubscribe (v1 accepted risk).
