# WhatsApp Support CTA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `wa.me` deep link on three surfaces (footer of `/comecar`, a dismissible dashboard card, the welcome email) so a new user can open a WhatsApp conversation with support themselves.

**Architecture:** One pure URL builder in the CRM (`apps/crm/src/lib/whatsapp.ts`) plus a deliberate Deno twin (`supabase/functions/_shared/whatsapp.ts`) for the email, since the two live in different runtimes. A single `WhatsAppSupportButton` reads `useAuth()` and is consumed by both CRM surfaces. No database changes, no API, no consent flow: the user always initiates.

**Tech Stack:** React 19, TypeScript, Vite, Vitest + Testing Library (CRM); Deno + `deno test` (edge functions); PostHog for analytics.

**Spec:** [`docs/superpowers/specs/2026-08-04-whatsapp-support-cta-design.md`](../specs/2026-08-04-whatsapp-support-cta-design.md)

## Global Constraints

- **No em-dashes in user-facing copy.** Use a period, a colon, or `·`. This applies to every string a user can read: card copy, button labels, email text, prefill text.
- **The prefill takes no article before the name.** `Sou Ana`, never `Sou o Ana` or `Sou o/a Ana`. Any fixed article misgenders roughly half the users.
- **Both env vars are optional and fail closed.** `VITE_WHATSAPP_SUPPORT_NUMBER` (CRM) and `WHATSAPP_SUPPORT_NUMBER` (Deno). Absent, empty, or not matching `^\d+$` all produce `null` and render nothing.
- **Number format is digits only.** No `+`, no spaces, no punctuation. Example `5511999999999`.
- **`profile` is untyped.** `getCurrentProfile()` caches into an `any` (`apps/crm/src/lib/supabase.ts:16`). Read `nome` and `empresa` through a narrow cast, and accept `string | null | undefined` in the builder.
- **`profiles.empresa` is the user's company, not the active workspace name.** Do not swap it for `getCurrentWorkspace()`.
- **New analytics events must be added to the closed union** in `apps/crm/src/lib/analytics.ts:9`, or `tsc` fails.
- **`npm run test:functions` dirties the root `deno.lock`.** Run `git checkout -- deno.lock` before committing.
- **UI copy is pt-BR.**

## File Structure

| File | Responsibility |
|---|---|
| `apps/crm/src/lib/whatsapp.ts` (create) | Env read, validation, prefill text, URL assembly. Pure apart from the env read. |
| `apps/crm/src/lib/__tests__/whatsapp.test.ts` (create) | Builder unit tests. |
| `apps/crm/src/components/support/WhatsAppSupportButton.tsx` (create) | Reads `useAuth()`, calls the builder, renders the anchor, fires analytics. |
| `apps/crm/src/components/support/WhatsAppSupportCard.tsx` (create) | Dashboard card: owner gate, dismissal, wraps the button. |
| `apps/crm/src/components/support/__tests__/WhatsAppSupportCard.test.tsx` (create) | Card behaviour tests. |
| `apps/crm/src/lib/analytics.ts` (modify) | Add `whatsapp_support_clicked` to the union. |
| `apps/crm/src/pages/comecar/ComecarPage.tsx` (modify) | Footer link. |
| `apps/crm/src/pages/comecar/comecar.css` (modify) | Footer link spacing. |
| `apps/crm/src/pages/dashboard/DashboardPage.tsx` (modify) | Render the card. |
| `apps/crm/style.css` (modify) | `.whatsapp-support*` rules. |
| `supabase/functions/_shared/whatsapp.ts` (create) | Deno twin of the builder. |
| `supabase/functions/_shared/lifecycle-emails.ts` (modify) | WhatsApp button in the welcome email. |
| `supabase/functions/__tests__/whatsapp_test.ts` (create) | Deno builder tests. |
| `supabase/functions/__tests__/lifecycle-emails_test.ts` (modify) | Welcome email assertions. |
| `.env.example`, `CLAUDE.md` (modify) | Document both vars. |

---

### Task 1: The CRM URL builder

**Files:**
- Create: `apps/crm/src/lib/whatsapp.ts`
- Test: `apps/crm/src/lib/__tests__/whatsapp.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type WhatsAppContext = 'onboarding' | 'dashboard'`
  - `buildWhatsAppSupportUrl(p: { nome?: string | null; empresa?: string | null; context: WhatsAppContext }): string | null`
  - `isWhatsAppSupportEnabled(): boolean`

**Why the tests use `vi.stubEnv` + `vi.resetModules()` + dynamic `await import()`:** the module reads `import.meta.env` at module scope, so a static top-of-file import would freeze the first env value for the whole file. This mirrors `apps/crm/src/lib/__tests__/analytics.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/lib/__tests__/whatsapp.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const NUMBER = '5511999999999';

/**
 * The module reads import.meta.env at module scope, so every case has to reset
 * the registry and re-import to pick up a new stubbed value.
 */
async function load(number: string | undefined) {
  vi.resetModules();
  vi.stubEnv('VITE_WHATSAPP_SUPPORT_NUMBER', number ?? '');
  return await import('../whatsapp');
}

/** The decoded `text` query param, which is what we actually care about. */
function textOf(url: string): string {
  return decodeURIComponent(new URL(url).searchParams.get('text') ?? '');
}

describe('buildWhatsAppSupportUrl', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds an onboarding link with name and company', async () => {
    const { buildWhatsAppSupportUrl } = await load(NUMBER);
    const url = buildWhatsAppSupportUrl({
      nome: 'Ana Souza',
      empresa: 'Acme',
      context: 'onboarding',
    });
    expect(url).not.toBeNull();
    expect(url!.startsWith(`https://wa.me/${NUMBER}?text=`)).toBe(true);
    expect(textOf(url!)).toBe(
      'Oi! Sou Ana, da Acme. Acabei de criar minha conta no Mesaas e queria ajuda pra configurar.',
    );
  });

  it('uses the dashboard wording for the dashboard context', async () => {
    const { buildWhatsAppSupportUrl } = await load(NUMBER);
    const url = buildWhatsAppSupportUrl({
      nome: 'Ana',
      empresa: 'Acme',
      context: 'dashboard',
    });
    expect(textOf(url!)).toBe('Oi! Sou Ana, da Acme. Queria falar com vocês sobre o Mesaas.');
  });

  it('reduces the name to its first word', async () => {
    const { buildWhatsAppSupportUrl } = await load(NUMBER);
    const url = buildWhatsAppSupportUrl({
      nome: '  Ana Paula   Souza ',
      empresa: 'Acme',
      context: 'onboarding',
    });
    expect(textOf(url!)).toContain('Sou Ana, da Acme.');
  });

  it('never puts an article before the name', async () => {
    // "Sou o Ana" agrees wrong and any fixed article misgenders half the users.
    const { buildWhatsAppSupportUrl } = await load(NUMBER);
    const url = buildWhatsAppSupportUrl({ nome: 'Ana', empresa: null, context: 'onboarding' });
    expect(textOf(url!)).toContain('Sou Ana.');
    expect(textOf(url!)).not.toMatch(/Sou\s+(o|a|o\/a)\s/);
  });

  it.each([
    [{ nome: 'Ana', empresa: null }, 'Oi! Sou Ana. Acabei'],
    [{ nome: null, empresa: 'Acme' }, 'Oi! Sou da Acme. Acabei'],
    [{ nome: null, empresa: null }, 'Oi! Acabei'],
    [{ nome: '   ', empresa: '  ' }, 'Oi! Acabei'],
    [{ nome: undefined, empresa: undefined }, 'Oi! Acabei'],
  ])('degrades cleanly for %j', async (fields, expectedStart) => {
    const { buildWhatsAppSupportUrl } = await load(NUMBER);
    const url = buildWhatsAppSupportUrl({ ...fields, context: 'onboarding' });
    expect(textOf(url!).startsWith(expectedStart)).toBe(true);
    expect(textOf(url!)).not.toContain('undefined');
    expect(textOf(url!)).not.toContain('null');
  });

  it('percent-encodes accents and spaces', async () => {
    const { buildWhatsAppSupportUrl } = await load(NUMBER);
    const url = buildWhatsAppSupportUrl({ nome: 'João', empresa: 'Açaí & Cia', context: 'dashboard' });
    expect(url).toContain('%20');
    expect(url).not.toContain(' ');
    expect(textOf(url!)).toContain('Sou João, da Açaí & Cia.');
  });

  it.each(['', '   ', '+5511999999999', '55 11 99999-9999', '(11) 99999-9999', 'abc'])(
    'returns null for the malformed value %o',
    async (bad) => {
      // Fails closed on malformed, not only on missing: a number pasted from a
      // phone would otherwise ship a dead link to production.
      const { buildWhatsAppSupportUrl, isWhatsAppSupportEnabled } = await load(bad);
      expect(buildWhatsAppSupportUrl({ nome: 'Ana', context: 'onboarding' })).toBeNull();
      expect(isWhatsAppSupportEnabled()).toBe(false);
    },
  );

  it('reports enabled only for a digits-only value', async () => {
    const { isWhatsAppSupportEnabled } = await load(NUMBER);
    expect(isWhatsAppSupportEnabled()).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run apps/crm/src/lib/__tests__/whatsapp.test.ts
```

Expected: FAIL, cannot resolve `../whatsapp`.

- [ ] **Step 3: Write the implementation**

Create `apps/crm/src/lib/whatsapp.ts`:

```ts
/**
 * Deep link to support on WhatsApp.
 *
 * The number runs the WhatsApp Business *app* with manual replies, not the
 * Cloud API. So there is no template, no per-message billing, no 24h customer
 * service window and no messaging tier here. The user always sends the first
 * message, which is also why no opt-in is collected anywhere for this.
 */

export type WhatsAppContext = 'onboarding' | 'dashboard';

/** wa.me rejects anything but digits: no `+`, no spaces, no punctuation. */
const DIGITS_ONLY = /^\d+$/;

const RAW_NUMBER = import.meta.env.VITE_WHATSAPP_SUPPORT_NUMBER as string | undefined;

/**
 * Fails closed on a malformed value, not only on a missing one. `+55 11 99999-9999`
 * pasted straight from a phone is the likely mistake, and it would otherwise
 * produce a live but dead link.
 */
function supportNumber(): string | null {
  const raw = (RAW_NUMBER ?? '').trim();
  return DIGITS_ONLY.test(raw) ? raw : null;
}

export function isWhatsAppSupportEnabled(): boolean {
  return supportNumber() !== null;
}

/** First whitespace-separated word; null when absent or blank. Mirrors firstNameFrom() in _shared/lifecycle-emails.ts. */
function firstName(nome: string | null | undefined): string | null {
  const first = (nome ?? '').trim().split(/\s+/)[0];
  return first ? first : null;
}

const TAIL: Record<WhatsAppContext, string> = {
  onboarding: 'Acabei de criar minha conta no Mesaas e queria ajuda pra configurar.',
  dashboard: 'Queria falar com vocês sobre o Mesaas.',
};

/**
 * No article before the name. "Sou o Ana" agrees wrong, "Sou o/a" is ugly, and
 * any fixed article misgenders half the users. "Sou Ana" is correct and neutral.
 */
function intro(nome: string | null, empresa: string | null): string {
  if (nome && empresa) return `Oi! Sou ${nome}, da ${empresa}.`;
  if (nome) return `Oi! Sou ${nome}.`;
  if (empresa) return `Oi! Sou da ${empresa}.`;
  return 'Oi!';
}

/**
 * The prefill is a hint, never an identifier: the user can edit it before
 * sending, so nothing may depend on it to resolve an account.
 */
export function buildWhatsAppSupportUrl(p: {
  nome?: string | null;
  empresa?: string | null;
  context: WhatsAppContext;
}): string | null {
  const number = supportNumber();
  if (!number) return null;
  const empresa = (p.empresa ?? '').trim() || null;
  const text = `${intro(firstName(p.nome), empresa)} ${TAIL[p.context]}`;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run apps/crm/src/lib/__tests__/whatsapp.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 5: Document the CRM env var**

In `.env.example`, after the `VITE_ESTUDIO_EDITOR_ORIGIN=` line, add:

```
# WhatsApp support deep link. Digits only, no "+", no spaces, no punctuation
# (e.g. 5511999999999). Optional: when unset or malformed, every WhatsApp CTA
# is simply not rendered.
VITE_WHATSAPP_SUPPORT_NUMBER=
```

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/lib/whatsapp.ts apps/crm/src/lib/__tests__/whatsapp.test.ts .env.example
git commit -m "feat(whatsapp): builder do link de suporte"
```

---

### Task 2: The shared button

**Files:**
- Create: `apps/crm/src/components/support/WhatsAppSupportButton.tsx`
- Modify: `apps/crm/src/lib/analytics.ts:36` (extend the union)

**Interfaces:**
- Consumes: `buildWhatsAppSupportUrl`, `WhatsAppContext` from Task 1.
- Produces: `<WhatsAppSupportButton context={WhatsAppContext} label={string} className?={string} />`, and the analytics event name `'whatsapp_support_clicked'`.

The button is **not** presentational. It reads `useAuth()` itself so the two CRM surfaces cannot drift on where the name and company come from. Its own tests are covered through the card in Task 4 and the page in Task 3, since it renders nothing on its own without an auth context.

- [ ] **Step 1: Extend the analytics union**

In `apps/crm/src/lib/analytics.ts`, change the last member of `AnalyticsEvent` from `| 'trial_nudge_clicked';` to:

```ts
  | 'trial_nudge_clicked'
  | 'whatsapp_support_clicked';
```

- [ ] **Step 2: Verify the union compiles**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
```

Expected: PASS, no errors.

- [ ] **Step 3: Write the component**

Create `apps/crm/src/components/support/WhatsAppSupportButton.tsx`:

```tsx
import { useAuth } from '@/context/AuthContext';
import { captureEvent } from '@/lib/analytics';
import { buildWhatsAppSupportUrl, type WhatsAppContext } from '@/lib/whatsapp';

interface Props {
  context: WhatsAppContext;
  label: string;
  className?: string;
}

/**
 * Deliberately not presentational: it reads useAuth() rather than taking `nome`
 * and `empresa` as props. Both CRM surfaces would otherwise prop-drill the same
 * two fields, which is the shortest path to the two screens drifting apart.
 *
 * Renders nothing when the support number is unset or malformed.
 */
export function WhatsAppSupportButton({ context, label, className }: Props) {
  const { profile } = useAuth();
  // getCurrentProfile() does select('*') into an `any` cache, so the row is
  // untyped at every call site in this repo. Read through a narrow cast.
  const row = profile as unknown as Record<string, string | null> | null;

  const href = buildWhatsAppSupportUrl({
    nome: row?.nome,
    // profiles.empresa is the user's own company, set at signup. It is NOT the
    // active workspace name, and for a prefill that identifies a person it is
    // the right field.
    empresa: row?.empresa,
    context,
  });
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={() =>
        // sendInstantly: on mobile the switch to the WhatsApp app can suspend
        // the page before posthog-js flushes its queue.
        captureEvent('whatsapp_support_clicked', { context }, { sendInstantly: true })
      }
    >
      {label}
    </a>
  );
}
```

- [ ] **Step 4: Verify it compiles**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/support/WhatsAppSupportButton.tsx apps/crm/src/lib/analytics.ts
git commit -m "feat(whatsapp): botao compartilhado de suporte"
```

---

### Task 3: The `/comecar` footer link

**Files:**
- Modify: `apps/crm/src/pages/comecar/ComecarPage.tsx:277-282`
- Modify: `apps/crm/src/pages/comecar/comecar.css`

**Interfaces:**
- Consumes: `<WhatsAppSupportButton />` from Task 2.
- Produces: nothing consumed by later tasks.

The link goes in the footer on purpose. The page's primary job is the trial CTA shipped in #290, and a support link at equal visual weight would cost checkouts.

- [ ] **Step 1: Add the imports**

In `apps/crm/src/pages/comecar/ComecarPage.tsx`, after the `captureCheckoutStarted` import (line 20), add:

```tsx
import { WhatsAppSupportButton } from '@/components/support/WhatsAppSupportButton';
import { isWhatsAppSupportEnabled } from '@/lib/whatsapp';
```

- [ ] **Step 2: Add the link to the footer**

Replace the `<footer className="comecar-foot">` block (lines 277-282) with:

```tsx
        <footer className="comecar-foot">
          <p>Pedimos o cartão agora, mas nada é cobrado nos primeiros 30 dias.</p>
          <button type="button" className="comecar-link" onClick={handleSkip}>
            Prefiro continuar no plano Free por enquanto
          </button>
          {isWhatsAppSupportEnabled() && (
            <p className="comecar-foot__help">
              Prefere falar com uma pessoa?{' '}
              <WhatsAppSupportButton
                context="onboarding"
                label="Fale com a gente no WhatsApp"
                className="comecar-link comecar-link--inline"
              />
            </p>
          )}
        </footer>
```

**The whole `<p>` is gated, not just the anchor.** `WhatsAppSupportButton`
returns `null` on its own when the number is unset, but that alone would leave
the lead-in sentence "Prefere falar com uma pessoa?" rendered above nothing, a
dangling question pointing at no link. Gating on `isWhatsAppSupportEnabled()`
removes the whole line, which is what Step 5 below actually checks for. Use the
predicate rather than re-reading the env var here, so this page and the Task 4
card agree on what "configured" means.

- [ ] **Step 3: Add the CSS**

In `apps/crm/src/pages/comecar/comecar.css`, after the `.comecar-link` block (which ends at line 169), add:

```css
.comecar-foot__help {
  margin-top: 0.9rem;
}
.comecar-link--inline {
  display: inline;
}
```

- [ ] **Step 4: Add the regression test and verify**

Add to the existing comecar test file, following the conventions already in it:

- with `VITE_WHATSAPP_SUPPORT_NUMBER` set to a valid digits-only value, the help
  line renders and the link is present
- with it set to `''`, neither the link **nor** the text
  "Prefere falar com uma pessoa" appears anywhere in the output

The second case is the one that matters. Without it, nothing catches a
regression that reintroduces the dangling sentence.

Because the page reads the env var transitively through `@/lib/whatsapp` at
module scope, the test needs `vi.resetModules()` plus a dynamic import, the same
pattern as `apps/crm/src/lib/__tests__/whatsapp.test.ts`.

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit && npx vitest run apps/crm/src/pages/comecar
```

Expected: PASS both. Note the repo carries 21 pre-existing TipTap typecheck
errors, repaired in Task 6; treat the typecheck as passing if nothing outside
`PostEditor.tsx`, `ReadOnlyTipTap.tsx`, `mentionSuggestion.ts`,
`color-picker-advanced.tsx` and `ArtigoPage.tsx` errors.

- [ ] **Step 5: Verify in the browser**

Start the CRM with the var set, then sign in as an owner on a free workspace and open `/comecar`:

```bash
VITE_WHATSAPP_SUPPORT_NUMBER=5511999999999 npm run dev
```

Confirm: the link renders under the "plano Free" button, opens in a new tab, and the prefilled text reads `Oi! Sou <nome>, da <empresa>. Acabei de criar minha conta no Mesaas e queria ajuda pra configurar.` Then stop the server, restart it without the var, and confirm the line disappears entirely with no empty `<p>` left behind.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/comecar/ComecarPage.tsx apps/crm/src/pages/comecar/comecar.css
git commit -m "feat(whatsapp): link de suporte no rodape do /comecar"
```

---

### Task 4: The dashboard card

**Files:**
- Create: `apps/crm/src/components/support/WhatsAppSupportCard.tsx`
- Test: `apps/crm/src/components/support/__tests__/WhatsAppSupportCard.test.tsx`
- Modify: `apps/crm/src/pages/dashboard/DashboardPage.tsx:189`
- Modify: `apps/crm/style.css` (after the `.trial-nudge__close` block, which ends at line 10421)

**Interfaces:**
- Consumes: `<WhatsAppSupportButton />` (Task 2), `isWhatsAppSupportEnabled()` (Task 1).
- Produces: `<WhatsAppSupportCard />`, no props.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/components/support/__tests__/WhatsAppSupportCard.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));

const KEY = 'whatsapp_support_dismissed_conta-1';

function authAs(role: string) {
  useAuthMock.mockReturnValue({
    role,
    workspaceRole: role,
    profile: { conta_id: 'conta-1', nome: 'Ana Souza', empresa: 'Acme' },
  });
}

/** The module under test reads env at module scope, so re-import per case. */
async function renderCard(number = '5511999999999') {
  vi.resetModules();
  vi.stubEnv('VITE_WHATSAPP_SUPPORT_NUMBER', number);
  const { WhatsAppSupportCard } = await import('../WhatsAppSupportCard');
  return render(<WhatsAppSupportCard />);
}

describe('WhatsAppSupportCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    localStorage.clear();
    authAs('owner');
  });

  it('renders for an owner when configured', async () => {
    await renderCard();
    expect(screen.getByText('Fale com a gente no WhatsApp')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir WhatsApp' })).toHaveAttribute(
      'target',
      '_blank',
    );
  });

  it('does not render for a non-owner', async () => {
    authAs('agent');
    await renderCard();
    expect(screen.queryByText('Fale com a gente no WhatsApp')).not.toBeInTheDocument();
  });

  it('does not render when the support number is unset', async () => {
    // Otherwise the card would ship with a title and no CTA at all.
    await renderCard('');
    expect(screen.queryByText('Fale com a gente no WhatsApp')).not.toBeInTheDocument();
  });

  it('does not render when already dismissed', async () => {
    localStorage.setItem(KEY, new Date().toISOString());
    await renderCard();
    expect(screen.queryByText('Fale com a gente no WhatsApp')).not.toBeInTheDocument();
  });

  it('treats an old timestamp as still dismissed', async () => {
    // Unlike TrialNudgeCard's 7-day window, dismissal here is permanent.
    localStorage.setItem(KEY, '2020-01-01T00:00:00.000Z');
    await renderCard();
    expect(screen.queryByText('Fale com a gente no WhatsApp')).not.toBeInTheDocument();
  });

  it.each(['true', 'sim', '', 'not-a-date'])(
    'shows the card when the stored value %o is not a valid date',
    async (raw) => {
      // A corrupt entry must fail toward showing the card, never toward hiding
      // it forever.
      localStorage.setItem(KEY, raw);
      await renderCard();
      expect(screen.getByText('Fale com a gente no WhatsApp')).toBeInTheDocument();
    },
  );

  it('persists a valid ISO timestamp on dismiss and hides the card', async () => {
    await renderCard();
    fireEvent.click(screen.getByLabelText('Fechar aviso'));
    expect(screen.queryByText('Fale com a gente no WhatsApp')).not.toBeInTheDocument();
    const stored = localStorage.getItem(KEY);
    expect(stored).not.toBeNull();
    expect(Number.isNaN(new Date(stored!).getTime())).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run apps/crm/src/components/support/__tests__/WhatsAppSupportCard.test.tsx
```

Expected: FAIL, cannot resolve `../WhatsAppSupportCard`.

- [ ] **Step 3: Write the component**

Create `apps/crm/src/components/support/WhatsAppSupportCard.tsx`:

```tsx
import { useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { isWhatsAppSupportEnabled } from '@/lib/whatsapp';
import { WhatsAppSupportButton } from './WhatsAppSupportButton';

/**
 * Dismissal is permanent here, unlike TrialNudgeCard's 7-day window: any valid
 * ISO date means dismissed, however old. A present-but-unparseable value counts
 * as never dismissed, because a corrupt entry should fail toward showing the
 * card rather than hiding it forever.
 */
function isDismissed(raw: string | null): boolean {
  if (!raw) return false;
  return !Number.isNaN(new Date(raw).getTime());
}

/**
 * Shown to every owner until dismissed, so the copy must read correctly at any
 * account age. Nothing here assumes a new account.
 */
export function WhatsAppSupportCard() {
  const { role, workspaceRole, profile } = useAuth();
  // Follow the ACTIVE workspace role, not the stale profile-level role: a user
  // can be owner in one workspace and agent in another. Mirrors TrialNudgeCard.
  const isOwner = (workspaceRole ?? role) === 'owner';
  const storageKey = `whatsapp_support_dismissed_${profile?.conta_id ?? 'unknown'}`;

  const [dismissed, setDismissed] = useState(() => isDismissed(localStorage.getItem(storageKey)));

  // Checked here as well as in the button: without it the card would render its
  // title and body with no CTA.
  if (!isOwner || dismissed || !isWhatsAppSupportEnabled()) return null;

  function handleDismiss() {
    localStorage.setItem(storageKey, new Date().toISOString());
    setDismissed(true);
  }

  return (
    <div className="card whatsapp-support">
      <MessageCircle size={22} aria-hidden="true" className="whatsapp-support__icon" />
      <div className="whatsapp-support__body">
        <p className="whatsapp-support__title">Fale com a gente no WhatsApp</p>
        <p className="whatsapp-support__text">
          Dúvida, ideia ou problema? A gente responde por lá, sem robô no meio.
        </p>
      </div>
      <WhatsAppSupportButton
        context="dashboard"
        label="Abrir WhatsApp"
        className="btn-primary whatsapp-support__cta"
      />
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Fechar aviso"
        className="whatsapp-support__close"
      >
        <X size={16} />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Add the CSS**

In `apps/crm/style.css`, after the `.trial-nudge__close` block (ends line 10421), add:

```css
/* WhatsApp support card */
.whatsapp-support {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin-bottom: 1.5rem;
  border: 1px solid var(--success);
}
.whatsapp-support__icon {
  color: var(--success);
  flex-shrink: 0;
}
.whatsapp-support__body {
  flex: 1;
}
.whatsapp-support__title {
  font-weight: 600;
  color: var(--text-main);
  margin: 0 0 0.15rem;
}
.whatsapp-support__text {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin: 0;
}
.whatsapp-support__cta {
  white-space: nowrap;
  text-decoration: none;
}
.whatsapp-support__close {
  background: none;
  border: none;
  color: var(--text-light);
  cursor: pointer;
  padding: 0;
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run apps/crm/src/components/support/__tests__/WhatsAppSupportCard.test.tsx
```

Expected: PASS, all cases.

- [ ] **Step 6: Render the card on the dashboard**

In `apps/crm/src/pages/dashboard/DashboardPage.tsx`, add the import alongside the other component imports:

```tsx
import { WhatsAppSupportCard } from '@/components/support/WhatsAppSupportCard';
```

Then, at line 189, insert the card directly after `<TrialNudgeCard />`:

```tsx
      {!isAgent && <TrialNudgeCard />}
      {!isAgent && <WhatsAppSupportCard />}
```

- [ ] **Step 7: Verify the dashboard compiles and its tests pass**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit && npx vitest run apps/crm/src/pages/dashboard
```

Expected: PASS both.

- [ ] **Step 8: Verify in the browser**

```bash
VITE_WHATSAPP_SUPPORT_NUMBER=5511999999999 npm run dev
```

On `/dashboard` as an owner, confirm: the card renders under the trial nudge, the CTA opens WhatsApp in a new tab, and the X hides it. Reload and confirm it stays hidden. Then check the layout at 1280px and at 375px width, since `.whatsapp-support` is a flex row and the CTA plus close button can crowd on narrow screens. jsdom does not evaluate media queries, so this cannot be caught by the tests.

- [ ] **Step 9: Commit**

```bash
git add apps/crm/src/components/support/WhatsAppSupportCard.tsx \
        apps/crm/src/components/support/__tests__/WhatsAppSupportCard.test.tsx \
        apps/crm/src/pages/dashboard/DashboardPage.tsx apps/crm/style.css
git commit -m "feat(whatsapp): card de suporte no dashboard"
```

---

### Task 5: The welcome email

**Files:**
- Create: `supabase/functions/_shared/whatsapp.ts`
- Create: `supabase/functions/__tests__/whatsapp_test.ts`
- Modify: `supabase/functions/_shared/lifecycle-emails.ts:109`
- Modify: `supabase/functions/__tests__/lifecycle-emails_test.ts`
- Modify: `.env.example`, `CLAUDE.md`

**Interfaces:**
- Consumes: nothing from Tasks 1-4. This is the Deno side of the deliberate duplication.
- Produces: `whatsAppSupportUrl(p: { firstName: string | null }): string | null`.

**The email carries the first name only, never the company.** `get_welcome_email_candidates()` returns exactly `(user_id, email, nome, attempts)` (`supabase/migrations/20260730000001_lifecycle_emails.sql:45`), and neither `sendWelcome`, nor `LifecycleCronDeps`, nor `buildWelcomeEmail` receives a workspace. Do **not** add a migration to change that for a prefill string.

Unlike the CRM twin, this reads `Deno.env` at call time rather than module scope, so tests can set the var per case without module-registry games.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/__tests__/whatsapp_test.ts`:

```ts
// assertStringIncludes is NOT in the local ./assert.ts, which only exports
// assert, assertEquals and readJson. It comes from the pinned std URL, the same
// way invite-email_test.ts imports it. Keep the 0.224.0 pin: Deno's
// min-dep-age check in CI rejects freshly published versions.
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { whatsAppSupportUrl } from "../_shared/whatsapp.ts";

const NUMBER = "5511999999999";

function textOf(url: string): string {
  return decodeURIComponent(new URL(url).searchParams.get("text") ?? "");
}

Deno.test("whatsAppSupportUrl builds a link with the first name", () => {
  Deno.env.set("WHATSAPP_SUPPORT_NUMBER", NUMBER);
  const url = whatsAppSupportUrl({ firstName: "Ana" })!;
  assertStringIncludes(url, `https://wa.me/${NUMBER}?text=`);
  assertEquals(
    textOf(url),
    "Oi! Sou Ana. Acabei de criar minha conta no Mesaas e queria ajuda pra configurar.",
  );
});

Deno.test("whatsAppSupportUrl omits the name when absent", () => {
  Deno.env.set("WHATSAPP_SUPPORT_NUMBER", NUMBER);
  const url = whatsAppSupportUrl({ firstName: null })!;
  assertEquals(
    textOf(url),
    "Oi! Acabei de criar minha conta no Mesaas e queria ajuda pra configurar.",
  );
});

Deno.test("whatsAppSupportUrl never emits an article before the name", () => {
  Deno.env.set("WHATSAPP_SUPPORT_NUMBER", NUMBER);
  const text = textOf(whatsAppSupportUrl({ firstName: "Ana" })!);
  assertEquals(/Sou\s+(o|a|o\/a)\s/.test(text), false);
});

Deno.test("whatsAppSupportUrl fails closed on a missing or malformed number", () => {
  for (const bad of ["", "   ", "+5511999999999", "55 11 99999-9999", "abc"]) {
    Deno.env.set("WHATSAPP_SUPPORT_NUMBER", bad);
    assertEquals(whatsAppSupportUrl({ firstName: "Ana" }), null);
  }
  Deno.env.delete("WHATSAPP_SUPPORT_NUMBER");
  assertEquals(whatsAppSupportUrl({ firstName: "Ana" }), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx deno test --allow-env --allow-read supabase/functions/__tests__/whatsapp_test.ts
```

Expected: FAIL, module `../_shared/whatsapp.ts` not found.

- [ ] **Step 3: Write the Deno builder**

Create `supabase/functions/_shared/whatsapp.ts`:

```ts
/**
 * Deno twin of apps/crm/src/lib/whatsapp.ts.
 *
 * The duplication is deliberate: the two live in different runtimes (Vite and
 * Deno). Sharing it through packages/ would drag that whole build into the edge
 * function bundle, which no function here does, for two lines of encoding.
 *
 * This variant only ever builds the onboarding text with a first name: the
 * welcome email's candidate row carries no workspace, so there is no company to
 * interpolate. See get_welcome_email_candidates().
 */

/** wa.me rejects anything but digits: no `+`, no spaces, no punctuation. */
const DIGITS_ONLY = /^\d+$/;

export function whatsAppSupportUrl(p: { firstName: string | null }): string | null {
  const raw = (Deno.env.get("WHATSAPP_SUPPORT_NUMBER") ?? "").trim();
  // Fails closed on malformed as well as missing, so a number pasted from a
  // phone cannot ship a dead link inside an email nobody re-reads.
  if (!DIGITS_ONLY.test(raw)) return null;

  // No article before the name: "Sou o Ana" agrees wrong and any fixed article
  // misgenders half the recipients.
  const intro = p.firstName ? `Oi! Sou ${p.firstName}.` : "Oi!";
  const text = `${intro} Acabei de criar minha conta no Mesaas e queria ajuda pra configurar.`;
  return `https://wa.me/${raw}?text=${encodeURIComponent(text)}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx deno test --allow-env --allow-read supabase/functions/__tests__/whatsapp_test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing email test**

That file currently imports only `assert` from `./assert.ts`, and the local
`./assert.ts` does **not** export `assertStringIncludes`. Add this import at the
top of the file, alongside the existing ones:

```ts
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
```

Then append:

```ts
Deno.test("welcome email includes the WhatsApp button when configured", () => {
  Deno.env.set("WHATSAPP_SUPPORT_NUMBER", "5511999999999");
  const html = buildWelcomeEmail({ firstName: "Ana", appBaseUrl: "https://app.mesaas.com.br" });
  assertStringIncludes(html, "https://wa.me/5511999999999");
  assertStringIncludes(html, "Falar no WhatsApp");
});

Deno.test("welcome email stays intact with no WhatsApp number set", () => {
  Deno.env.delete("WHATSAPP_SUPPORT_NUMBER");
  const html = buildWelcomeEmail({ firstName: "Ana", appBaseUrl: "https://app.mesaas.com.br" });
  assertEquals(html.includes("wa.me"), false);
  assertEquals(html.includes("Falar no WhatsApp"), false);
  // No orphaned markup left where the button would have been.
  assertEquals(html.includes('href=""'), false);
  // And no orphaned COPY either: the sentence that points at the button must
  // disappear with it, or the email promises a link it never renders.
  assertEquals(html.includes("se preferir WhatsApp"), false);
  assertEquals(html.includes("clicar no botão abaixo"), false);
  assertStringIncludes(html, "responder este e-mail");
});
```

And assert the other direction in the configured test, so the conditional is
covered both ways:

```ts
  assertStringIncludes(html, "se preferir WhatsApp");
```

- [ ] **Step 6: Run the test to verify it fails**

```bash
npx deno test --allow-env --allow-read supabase/functions/__tests__/lifecycle-emails_test.ts
```

Expected: FAIL on the first new test, the HTML has no `wa.me`.

- [ ] **Step 7: Add the button to the welcome email**

In `supabase/functions/_shared/lifecycle-emails.ts`, add to the imports at the top:

```ts
import { whatsAppSupportUrl } from "./whatsapp.ts";
```

Then in `buildWelcomeEmail`, immediately after the `const base = escapeHtml(p.appBaseUrl);` line, add:

```ts
  // Empty string when unconfigured, so the paragraph simply does not exist
  // rather than rendering an empty button.
  const waUrl = whatsAppSupportUrl({ firstName: p.firstName });
  const waBlock = waUrl
    ? `<p style="margin:0 0 18px">${ctaButton(escapeHtml(waUrl), "Falar no WhatsApp")}</p>`
    : "";
  // The sentence that points AT the button has to be gated by the same value,
  // or the unconfigured email promises a WhatsApp link it never renders. Built
  // as one variable so the copy and the button cannot drift apart.
  const closingLine = waUrl
    ? `Qualquer dúvida, é só <strong>responder este e-mail</strong>. Eu leio e respondo pessoalmente, e se preferir WhatsApp, é só clicar no botão abaixo.`
    : `Qualquer dúvida, é só <strong>responder este e-mail</strong>. Eu leio e respondo pessoalmente.`;
```

Then replace the closing two paragraphs of the `body` template (currently lines 109-110) with:

```
<p style="margin:0 0 12px">${closingLine}</p>
${waBlock}
<p style="margin:0">Um abraço,<br><strong>Eduardo</strong> · Mesaas</p>`;
```

**Do not inline that sentence.** An unconditional "se preferir WhatsApp, é só
clicar aqui" above a `waBlock` that collapses to `""` is the same defect Task 3
shipped on `/comecar`, and the unconfigured case is the current production state
since the secret is not set yet.

Note `escapeHtml` on the URL: it lands inside an `href` in raw HTML. The builder already guarantees a `https://wa.me/<digits>?text=<encoded>` shape, but the escape does not depend on that guarantee holding at a distance.

- [ ] **Step 8: Run the email tests to verify they pass**

```bash
npx deno test --allow-env --allow-read supabase/functions/__tests__/lifecycle-emails_test.ts
```

Expected: PASS, including the two new cases.

- [ ] **Step 9: Document the edge-function env var**

In `.env.example`, after the `LOOPS_API_KEY=` line, add:

```
# WhatsApp support number for the welcome email. Digits only, same value as
# VITE_WHATSAPP_SUPPORT_NUMBER. Nothing verifies the two match: update both.
WHATSAPP_SUPPORT_NUMBER=
```

In `CLAUDE.md`, in the "Edge functions (Deno.env)" list, after the `POSTHOG_PROJECT_KEY` entry, add:

```markdown
- `WHATSAPP_SUPPORT_NUMBER` -- WhatsApp support number for the welcome-email CTA.
  Digits only, no `+` or punctuation. Optional: the CTA is omitted when unset or
  malformed. Must be kept in sync by hand with the CRM's
  `VITE_WHATSAPP_SUPPORT_NUMBER`; nothing verifies the two agree
```

- [ ] **Step 10: Revert the lock file and commit**

`npm run test:functions` and `deno test` both dirty the root `deno.lock`.

```bash
git checkout -- deno.lock
git add supabase/functions/_shared/whatsapp.ts \
        supabase/functions/_shared/lifecycle-emails.ts \
        supabase/functions/__tests__/whatsapp_test.ts \
        supabase/functions/__tests__/lifecycle-emails_test.ts \
        .env.example CLAUDE.md
git commit -m "feat(whatsapp): botao de suporte no e-mail de boas-vindas"
```

---

### Task 6: Full verification before the PR

**Files:** none modified unless a check fails.

- [ ] **Step 1: Format and lint**

```bash
npm run format && npm run lint
```

Expected: PASS. `format` rewrites files in place, so re-stage anything it touches.

**The order below is load-bearing.** Deno runs install a parallel dependency
tree under `node_modules/.deno/`, leaving two copies of TipTap (3.22.4 and
3.28.0) resolvable at once. `tsc` then reports ~21 errors in `PostEditor.tsx`,
`ReadOnlyTipTap.tsx`, `mentionSuggestion.ts`, `color-picker-advanced.tsx` and
`ArtigoPage.tsx` about two `ExtendedOptions` types that "are unrelated". None of
that is caused by this branch. `npm ci` repairs it, so it must run **after** the
Deno tests and **before** the typechecks. Running it earlier accomplishes
nothing, because `npm run test:functions` re-pollutes the tree.

- [ ] **Step 2: Full test suites**

```bash
npm run test
```

Expected: PASS.

```bash
npm run test:functions
```

Expected: PASS. This is what dirties `deno.lock` and `node_modules`.

- [ ] **Step 3: Revert the lock file**

```bash
git checkout -- deno.lock
```

- [ ] **Step 4: Repair node_modules**

```bash
npm ci
```

Expected: completes clean. This is slow, several minutes. Do not skip it: the
typechecks in Step 5 cannot pass until it runs.

- [ ] **Step 5: Typecheck all four projects**

`npm run build` only covers the CRM. CI checks four projects separately.

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit && \
npx tsc -p apps/hub/tsconfig.json --noEmit && \
npx tsc -p apps/admin/tsconfig.json --noEmit && \
npx tsc -p tsconfig.scripts.json
```

Expected: PASS, all four, with zero errors. If the TipTap errors are still
present, `npm ci` did not take effect. If a NEW error appears in a file this
branch touched, that one is real: fix it.

- [ ] **Step 6: Confirm the tree is clean and commit any formatting fallout**

```bash
git status --short
```

Expected: clean, or only files `npm run format` rewrote. `deno.lock` must NOT
appear.

```bash
git add -A && git commit -m "chore(whatsapp): format" || echo "nothing to commit"
```

---

## Deployment notes

Not part of the plan's tasks, but required for the feature to work in production:

- Set `VITE_WHATSAPP_SUPPORT_NUMBER` in Vercel for the CRM. It is a build-time variable, so a redeploy is required for it to take effect.
- Set `WHATSAPP_SUPPORT_NUMBER` in Supabase secrets, then redeploy `lifecycle-email-cron`.
- The two are independent. Setting only one leaves the app and the email disagreeing, or the email with no button. The email is the surface most easily forgotten, since it is invisible from inside the app.
- Until both are set, every WhatsApp CTA is simply absent. That is the intended fail-closed behaviour, not a bug.
