# Redesign dos e-mails transacionais — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all 12 transactional e-mail builders onto one shared shell that matches the Mesaas Design System, without changing who gets which e-mail, when, or with which links.

**Architecture:** A new `supabase/functions/_shared/email/` module (tokens, URL/colour guards, table-based blocks, two shells: `mesaasEmail` and `brandedEmail`). Each existing builder keeps its exported name, signature and return type and only swaps its HTML for blocks + shell. No DB, no migration, no frontend code; one new static asset in `public/`.

**Tech Stack:** Deno edge functions (TypeScript), Resend HTML e-mail, `deno test` with `https://deno.land/std@0.224.0/assert/mod.ts`.

**Spec:** `docs/superpowers/specs/2026-10-10-email-redesign-design.md` (read it first; this plan argues from it). Approved mockups: https://claude.ai/artifact/Qy1HcETnuGdYDqr4MUj5T9

**Worktree:** `/Users/eduardosouza/projects/sm-crm/.claude/worktrees/email-redesign-d46744`, branch `claude/email-redesign-d46744`. Every command below runs from that directory. Before starting any task run `pwd && git branch --show-current` and confirm both.

## Global Constraints

- Shell commands run from the worktree root. Tests: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys <file>`. Type gate: `npm run check:functions` (covers `_shared/*/*.ts`, so `_shared/email/*.ts` is checked).
- No em-dash (`—`) in any string **we author** (template copy, subjects, preheaders, labels). User content (workspace names, titles, comments, AI summary) passes through unchanged, only escaped.
- No emoji as icons in bodies. Emoji in subjects stays allowed.
- Every text parameter that can carry user data is escaped exactly once, inside the block that renders it. Never escape before calling a block (double escaping shows `&amp;amp;`).
- Every `href`/`src` goes through `linkSeguro` (http/https only, no whitespace/control chars) and then `escapeHtml`. Every external colour goes through `corSegura` (`^#[0-9a-fA-F]{6}$`, fallback `#eab308`).
- Tables only for layout. No flex, grid, or `<div>` layout in e-mail markup.
- Card width 560 (`width="560"` attribute + `style="width:100%;max-width:560px"`).
- Every document carries `<meta name="color-scheme" content="light">` and `<meta name="supported-color-schemes" content="light">` and a non-empty preheader.
- Logo URL constant: `https://www.mesaas.com.br/logo-black-email.png` (the bare domain 308s).
- Tagline in Mesaas footers: `Mesaas · Plataforma de gestão para agências de social media`. The old `gestão inteligente para social media managers` disappears everywhere.
- Builders keep exported names, parameter shapes and return types. Additive exceptions only: `DigestItem.badge?` (optional), `DunningCopy.alerta?` (optional), new export `mesDiaAgenda` in `agenda-cliente-email.ts`.
- Text colour pairs must reach 4.5:1 on their background (enforced by a test in Task 2).
- Do not run `npm run test:functions` over the whole tree mid-task (slow, and Deno runs can pollute `node_modules`); run the task's own test files. Task 12 runs the full gates.

## Review Focus

1. **A light agency colour** (e.g. `#facc15`) on the button and date tile must flip the text to `#171717`, not leave white-on-yellow. Pinned in Task 9.
2. **An all-day event in a non-São-Paulo zone** must show the same day in the date tile as in the "quando" line (`data_inicio_local` wins). Pinned in Task 9.
3. **Images blocked** (Outlook default): the Mesaas header must still read "Mesaas" via a styled `alt`. Pinned in Task 4.
4. **A 200-character unbroken string** (URL in fallback link, post title, workspace name) must not widen the card on a phone: those cells carry `word-break: break-word` (fallback URL `break-all`). Pinned in Task 3.
5. **A digest with 25 items** must produce a one-line preheader ("…, … e …, e mais 22.") and render every item. Pinned in Task 6.

---

## File map

| File | Responsibility |
|---|---|
| `public/logo-black-email.png` | New 474×60 logo with a 2px white outline |
| `supabase/functions/_shared/email/tokens.ts` | Colours, font stack, logo URL, badge tones, post formats |
| `supabase/functions/_shared/email/safe.ts` | `linkSeguro`, `corSegura` (moved from `agenda-cliente-email.ts`) |
| `supabase/functions/_shared/email/blocks.ts` | Pure HTML blocks (escape inside) |
| `supabase/functions/_shared/email/shell.ts` | `mesaasEmail`, `brandedEmail` documents |
| `supabase/functions/__tests__/email-safe_test.ts` | Guards + contrast |
| `supabase/functions/__tests__/email-blocks_test.ts` | Blocks contract |
| `supabase/functions/__tests__/email-shell_test.ts` | Shell contract |
| `supabase/functions/__tests__/email-matrix_test.ts` | Spec §7 fixture matrix, cross-builder invariants |
| Modified builders | `_shared/agenda-email.ts`, `_shared/instagram-connect-email.ts`, `_shared/lifecycle-emails.ts`, `_shared/notification-email.ts`, `_shared/dunning-email.ts`, `_shared/invite-email.ts`, `affiliate-public/email.ts`, `_shared/agenda-cliente-email.ts`, `_shared/client-event-email.ts`, `_shared/report-template/email.ts` |

Task order: 1 → 2 → 3 → 4, then 5–11 in any order **except** 6-before-nothing, 5 before 7 (Task 7 deletes `layout()`, which Task 5 stops using) and 9 before 10 (Task 10 imports `mesDiaAgenda`). Tasks 5, 6, 8, 9, 11 touch disjoint files and can run in parallel after Task 4, **but they share one worktree**: parallel implementers stop before their commit step and the orchestrator commits each task in turn (otherwise `index.lock` races and interleaved `git add`). Task 12 last. Commit trailers: use the attribution line from your own session's system reminder.

---

### Task 1: Black logo asset

**Files:**
- Create: `public/logo-black-email.png`
- Scratch (not committed): a render script in the session scratchpad

**Interfaces:**
- Produces: `public/logo-black-email.png`, 474×60 RGBA, served at `https://www.mesaas.com.br/logo-black-email.png` after merge.

- [ ] **Step 1: Render the PNG.** Write this script to the scratchpad as `render-logo.cjs` (not in the repo) and run it with `node`:

```js
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.resolve('node_modules/playwright-core'));
(async () => {
  const svg = fs.readFileSync(path.resolve('public/logo-black.svg'), 'utf8');
  const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const p = await b.newPage({ viewport: { width: 474, height: 60 }, deviceScaleFactor: 1 });
  // White 2px outline (invisible on the white card, visible if a client force-inverts it).
  await p.setContent(`<html><body style="margin:0;background:transparent">
    <div style="width:474px;height:60px;display:flex;align-items:center;justify-content:center">
      <div style="height:52px;filter:drop-shadow(1px 0 0 #fff) drop-shadow(-1px 0 0 #fff) drop-shadow(0 1px 0 #fff) drop-shadow(0 -1px 0 #fff) drop-shadow(1px 0 0 #fff) drop-shadow(-1px 0 0 #fff) drop-shadow(0 1px 0 #fff) drop-shadow(0 -1px 0 #fff)">
        ${svg.replace('<svg ', '<svg style="height:52px;width:auto;display:block" ')}
      </div></div></body></html>`);
  await p.screenshot({ path: path.resolve('public/logo-black-email.png'), omitBackground: true });
  await b.close();
})();
```

Run: `node <scratchpad>/render-logo.cjs && file public/logo-black-email.png`
Expected: `PNG image data, 474 x 60, 8-bit/color RGBA`

- [ ] **Step 2: Look at it.** Open the PNG with the Read tool. Expected: coloured mark + black "mesaas" wordmark, transparent background, nothing clipped.

- [ ] **Step 3: Commit**

```bash
git add public/logo-black-email.png
git commit -m "feat(email): logo preto para os e-mails

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Tokens and guards

**Files:**
- Create: `supabase/functions/_shared/email/tokens.ts`
- Create: `supabase/functions/_shared/email/safe.ts`
- Modify: `supabase/functions/_shared/agenda-cliente-email.ts` (delete local `URL_SEGURA`, `linkSeguro`, `corSegura`, `COR_PADRAO`; import from `./email/safe.ts`)
- Test: `supabase/functions/__tests__/email-safe_test.ts`

**Interfaces:**
- Produces:
  - `EMAIL` (const object of hex strings, keys below), `FONT_STACK: string`, `EMAIL_LOGO_URL: string`, `DEFAULT_BRAND_COLOR = "#eab308"`
  - `type BadgeTone = "danger" | "warning" | "info" | "success" | "neutral"`; `BADGE_TONES: Record<BadgeTone, { bg: string; fg: string; border: string }>`
  - `POST_TIPOS: Record<string, { label: string; color: string }>`, `POST_TIPO_FALLBACK: { label: string; color: string }`
  - `linkSeguro(u: string | null | undefined): string | null`
  - `corSegura(c: string | null | undefined): string`

- [ ] **Step 1: Write the failing test** `supabase/functions/__tests__/email-safe_test.ts`:

```ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { corSegura, linkSeguro } from "../_shared/email/safe.ts";
import { BADGE_TONES, EMAIL } from "../_shared/email/tokens.ts";

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

Deno.test("linkSeguro: accepts http(s), trims, rejects everything else", () => {
  assertEquals(linkSeguro(" https://a.test/x?y=1&z=2 "), "https://a.test/x?y=1&z=2");
  assertEquals(linkSeguro("http://a.test"), "http://a.test");
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "", "   ", null, undefined, "https://a.test/\nx", "//a.test", "mailto:a@b.c"]) {
    assertEquals(linkSeguro(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

Deno.test("corSegura: only #rrggbb, else the default yellow", () => {
  assertEquals(corSegura("#7C3AED"), "#7C3AED");
  for (const bad of ["red", "#fff", "#7c3aed;background:url(x)", "", null, undefined]) {
    assertEquals(corSegura(bad), "#eab308");
  }
});

Deno.test("text pairs reach 4.5:1 on their background", () => {
  const pairs: Array<[string, string, string]> = [
    ["ink on card", EMAIL.ink, EMAIL.card],
    ["text on card", EMAIL.text, EMAIL.card],
    ["muted on card", EMAIL.muted, EMAIL.card],
    ["muted on page", EMAIL.muted, EMAIL.page],
    ["text on callout", EMAIL.text, EMAIL.calloutBg],
    ["alert text on alert bg", EMAIL.alertText, EMAIL.alertBg],
    ["white on ink button", "#ffffff", EMAIL.ink],
    ["positive delta on card", EMAIL.positive, EMAIL.card],
    ["neutral delta on card", EMAIL.deltaNeutral, EMAIL.card],
  ];
  for (const t of Object.values(BADGE_TONES)) pairs.push(["badge", t.fg, t.bg]);
  for (const [name, fg, bg] of pairs) {
    assert(ratio(fg, bg) >= 4.5, `${name}: ${ratio(fg, bg).toFixed(2)} < 4.5`);
  }
});
```

- [ ] **Step 2: Run it, expect FAIL** (module not found).

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/email-safe_test.ts`

- [ ] **Step 3: Write `supabase/functions/_shared/email/tokens.ts`:**

```ts
/**
 * Visual tokens for every transactional e-mail (spec 2026-10-10-email-redesign §3).
 * Values come from the Mesaas Design System; e-mail clients need literal hex,
 * so nothing here is a CSS variable.
 */
export const EMAIL = {
  page: "#f5f6f8",
  card: "#ffffff",
  border: "#e5e7eb",
  divider: "#eef0f3",
  ink: "#12151a",
  text: "#374151",
  muted: "#4b5563",
  outlineBorder: "#d1d5db",
  brandMark: "#ffbf30",
  calloutBg: "#f5f6f8",
  alertBg: "#fee2e2",
  alertBorder: "#fecaca",
  alertText: "#b91c1c",
  dangerDot: "#dc2626",
  // Report KPI deltas. Positive was #16a34a (3.3:1, fails AA); badge-success-fg passes.
  positive: "#15803d",
  deltaNeutral: "#6b7280",
} as const;

export const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Helvetica, Arial, sans-serif";

/** Same asset in every environment; `www.` because the bare domain answers 308. */
export const EMAIL_LOGO_URL = "https://www.mesaas.com.br/logo-black-email.png";

export const DEFAULT_BRAND_COLOR = "#eab308";

export type BadgeTone = "danger" | "warning" | "info" | "success" | "neutral";

export const BADGE_TONES: Record<BadgeTone, { bg: string; fg: string; border: string }> = {
  danger: { bg: "#fee2e2", fg: "#b91c1c", border: "#fecaca" },
  warning: { bg: "#fef3c7", fg: "#b45309", border: "#fde68a" },
  info: { bg: "#dbeafe", fg: "#1d4ed8", border: "#bfdbfe" },
  success: { bg: "#dcfce7", fg: "#15803d", border: "#bbf7d0" },
  neutral: { bg: "#f1f5f9", fg: "#475569", border: "#e2e8f0" },
};

/** `workflow_posts.tipo` CHECK: feed | reels | stories | carrossel. */
export const POST_TIPOS: Record<string, { label: string; color: string }> = {
  feed: { label: "Feed", color: "#eab308" },
  carrossel: { label: "Carrossel", color: "#3ecf8e" },
  reels: { label: "Reels", color: "#e1306c" },
  stories: { label: "Stories", color: "#42c8f5" },
};

export const POST_TIPO_FALLBACK = { label: "Post", color: "#64748b" };
```

- [ ] **Step 4: Write `supabase/functions/_shared/email/safe.ts`:**

```ts
import { DEFAULT_BRAND_COLOR } from "./tokens.ts";

// deno-lint-ignore no-control-regex
const URL_SEGURA = /^https?:\/\/[^\s\x00-\x1f\x7f]+$/i;

/** Edge-function counterpart of the CRM's sanitizeUrl(): http(s) only, trimmed; null otherwise. */
export function linkSeguro(u: string | null | undefined): string | null {
  const t = u?.trim();
  return t && URL_SEGURA.test(t) ? t : null;
}

/** `#rrggbb` passes through; anything else (it lands inside style="") becomes the default. */
export function corSegura(c: string | null | undefined): string {
  return c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : DEFAULT_BRAND_COLOR;
}
```

- [ ] **Step 5: Point `agenda-cliente-email.ts` at the moved guards.** Delete these lines from `supabase/functions/_shared/agenda-cliente-email.ts`: `const COR_PADRAO = "#eab308";`, the `URL_SEGURA` const with its `deno-lint-ignore` comment, and the `linkSeguro` and `corSegura` functions. Add to its imports:

```ts
import { corSegura, linkSeguro } from "./email/safe.ts";
```

- [ ] **Step 6: Run the new test and the agenda-cliente suite, expect PASS**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/email-safe_test.ts supabase/functions/__tests__/agenda-cliente-email_test.ts`

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/email supabase/functions/__tests__/email-safe_test.ts supabase/functions/_shared/agenda-cliente-email.ts
git commit -m "feat(email): tokens e guardas de URL/cor compartilhados

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Blocks

**Files:**
- Create: `supabase/functions/_shared/email/blocks.ts`
- Test: `supabase/functions/__tests__/email-blocks_test.ts`

**Interfaces:**
- Consumes: Task 2 (`EMAIL`, `FONT_STACK`, `BADGE_TONES`, `BadgeTone`, `POST_TIPOS`, `POST_TIPO_FALLBACK`, `linkSeguro`, `corSegura`); `escapeHtml` from `../report-template/escape.ts`; `pickHeaderTextColor` from `../report-template/brand-header.ts`.
- Produces (all return `string`; parameters named `*Html` are trusted HTML, every other string is raw text):
  - `heading(text)`; `paragraph(text, kind?: "body" | "small", margin?)`; `paragraphHtml(html, kind?, margin?)`; `strong(text)`; `sectionTitle(text)`
  - `eyebrow(label, tone?: "brand" | "danger")`
  - `type ButtonVariant = "ink" | "outline" | { brandColor: string }`; `button(href, label, variant?)` → `""` when href is unsafe
  - `link(href, text, color?)` → plain escaped text when href is unsafe; `fallbackLink(href)` → `""` when unsafe
  - `steps(itemsHtml: string[])`; `featureGrid(items: Array<{ title: string; text: string }>)`
  - `callout(innerHtml)`; `alert(text)`; `quote(label, text)`
  - `detailRows(rows: Array<{ label: string; value: string }>)`
  - `badge(tone: BadgeTone, label)`; `postList(posts: Array<{ titulo: string; tipo: string }>)`
  - `dateTile({ mes, dia, color })`; `type EventCardInput = { mes: string; dia: string; tileColor: string; titulo: string; titleHref?: string | null; lines: string[]; meetingUrl?: string | null }`; `eventCard(input)`
  - `dateList(items: string[], restantes: number, riscado?: boolean)` → one `<li>` per item
  - `signature()`

- [ ] **Step 1: Write the failing test** `supabase/functions/__tests__/email-blocks_test.ts`:

```ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import * as B from "../_shared/email/blocks.ts";

const XSS = `<script>alert("x")</script>`;

Deno.test("text blocks escape raw input exactly once", () => {
  const outs = [
    B.heading(XSS), B.paragraph(XSS), B.strong(XSS), B.sectionTitle(XSS), B.eyebrow(XSS),
    B.alert(XSS), B.quote(XSS, XSS), B.badge("info", XSS),
    B.detailRows([{ label: XSS, value: XSS }]),
    B.postList([{ titulo: XSS, tipo: "feed" }]),
    B.featureGrid([{ title: XSS, text: XSS }]),
    B.eventCard({ mes: XSS, dia: XSS, tileColor: "#12151a", titulo: XSS, lines: [XSS] }),
    B.dateList([XSS], 0), B.button("https://a.test", XSS), B.link("https://a.test", XSS),
  ];
  for (const h of outs) {
    assert(!h.includes("<script>"), `raw script leaked: ${h.slice(0, 80)}`);
    assert(h.includes("&lt;script&gt;"), `not escaped: ${h.slice(0, 80)}`);
    assert(!h.includes("&amp;lt;"), `double-escaped: ${h.slice(0, 80)}`);
  }
});

Deno.test("unsafe URLs never become href", () => {
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "", null]) {
    assertEquals(B.button(bad, "Ir"), "");
    assertEquals(B.fallbackLink(bad), "");
    assertEquals(B.link(bad, "Texto"), "Texto");
    const card = B.eventCard({ mes: "OUT", dia: "1", tileColor: "#12151a", titulo: "T", titleHref: bad, lines: [], meetingUrl: bad });
    assert(!card.includes("href="), "card rendered an unsafe href");
  }
});

Deno.test("safe URL is entity-encoded in the attribute", () => {
  assert(B.button("https://a.test/?a=1&b=2", "Ir").includes(`href="https://a.test/?a=1&amp;b=2"`));
});

Deno.test("button: Outlook-safe cell with bgcolor; brand colour guarded and contrast-flipped", () => {
  const ink = B.button("https://a.test", "Ir");
  assert(ink.includes(`bgcolor="#12151a"`) && ink.includes("color: #ffffff;"));
  const light = B.button("https://a.test", "Ir", { brandColor: "#facc15" });
  assert(light.includes(`bgcolor="#facc15"`) && light.includes("color: #171717;"), "light brand must flip text dark");
  const evil = B.button("https://a.test", "Ir", { brandColor: "red;x:url(y)" });
  assert(evil.includes(`bgcolor="#eab308"`) && !evil.includes("url(y)"));
});

Deno.test("dateTile header text flips on a light colour", () => {
  assert(B.dateTile({ mes: "OUT", dia: "15", color: "#facc15" }).includes("color: #171717;"));
  assert(B.dateTile({ mes: "OUT", dia: "15", color: "#12151a" }).includes("color: #ffffff;"));
});

Deno.test("postList: format label + dot, unknown tipo falls back, no emoji", () => {
  const h = B.postList([{ titulo: "A", tipo: "reels" }, { titulo: "B", tipo: "zzz" }]);
  assert(h.includes("Reels") && h.includes("#e1306c"));
  assert(h.includes(">Post<") && h.includes("#64748b"));
  assert(!/[🖼🗂🎬📱]/u.test(h));
});

Deno.test("dateList: one <li> per item, 'e mais N datas' only when N > 0", () => {
  const h = B.dateList(["a", "b"], 3);
  assertEquals((h.match(/<li/g) ?? []).length, 2);
  assert(h.includes("e mais 3 datas"));
  assert(!B.dateList(["a"], 0).includes("e mais"));
  assert(B.dateList(["a"], 1).includes("e mais 1 data<"));
  assert(B.dateList(["a"], 0, true).includes("line-through"));
});

Deno.test("long unbroken strings wrap instead of widening the card", () => {
  const long = "x".repeat(200);
  assert(B.fallbackLink(`https://a.test/${long}`).includes("word-break: break-all"));
  assert(B.postList([{ titulo: long, tipo: "feed" }]).includes("word-break: break-word"));
  assert(B.eventCard({ mes: "OUT", dia: "1", tileColor: "#12151a", titulo: long, lines: [] }).includes("word-break: break-word"));
  assert(B.heading(long).includes("word-break: break-word"));
});

Deno.test("no flex/grid layout in any block", () => {
  const all = [B.steps(["a"]), B.featureGrid([{ title: "a", text: "b" }]), B.callout("x"), B.signature(),
    B.eventCard({ mes: "OUT", dia: "1", tileColor: "#12151a", titulo: "t", lines: ["l"] })].join("");
  assert(!/display:\s*(flex|grid)/.test(all));
});
```

- [ ] **Step 2: Run it, expect FAIL** (module not found).

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/email-blocks_test.ts`

- [ ] **Step 3: Write `supabase/functions/_shared/email/blocks.ts`:**

```ts
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

export function callout(innerHtml: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: separate;"><tr><td bgcolor="${EMAIL.calloutBg}" style="background: ${EMAIL.calloutBg}; border-radius: 10px; padding: 16px 18px; font-size: 14px; line-height: 22px; color: ${EMAIL.text}; ${WRAP}">${innerHtml}</td></tr></table>`;
}

export function alert(text: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: separate;"><tr><td bgcolor="${EMAIL.alertBg}" style="background: ${EMAIL.alertBg}; border: 1px solid ${EMAIL.alertBorder}; border-radius: 10px; padding: 16px 18px; font-size: 14px; line-height: 22px; color: ${EMAIL.alertText}; ${WRAP}">${escapeHtml(text)}</td></tr></table>`;
}

export function quote(label: string, text: string): string {
  return `<p style="margin: 0 0 6px; font-size: 13px; line-height: 20px; font-weight: 600; color: ${EMAIL.muted};">${escapeHtml(label)}</p>` +
    callout(`<span style="white-space: pre-line;">${escapeHtml(text)}</span>`);
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
  const f = POST_TIPOS[tipo] ?? POST_TIPO_FALLBACK;
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
```

- [ ] **Step 4: Run the test, expect PASS.**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/email-blocks_test.ts`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/email/blocks.ts supabase/functions/__tests__/email-blocks_test.ts
git commit -m "feat(email): blocos de e-mail em tabela, com escape e guardas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Shells

**Files:**
- Create: `supabase/functions/_shared/email/shell.ts`
- Test: `supabase/functions/__tests__/email-shell_test.ts`

**Interfaces:**
- Consumes: Task 2, Task 3 (`eyebrow`), `buildBrandHeaderBand`, `buildPreheader` from `../report-template/brand-header.ts`.
- Produces:
  - `interface MesaasEmailInput { preheader: string; eyebrow: string; eyebrowTone?: "brand" | "danger"; sections: string[]; footerLines: string[] }`; `mesaasEmail(p): string`
  - `interface BrandedEmailInput { preheader: string; workspaceName: string; brandColor: string | null | undefined; logoUrl: string | null | undefined; sections: string[]; footerHtml: string[] }`; `brandedEmail(p): string`
  - `MESAAS_TAGLINE = "Mesaas · Plataforma de gestão para agências de social media"`
  - `sections` items are trusted HTML; `footerLines` are raw text; `footerHtml` items are trusted HTML.

- [ ] **Step 1: Write the failing test** `supabase/functions/__tests__/email-shell_test.ts`:

```ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { brandedEmail, MESAAS_TAGLINE, mesaasEmail } from "../_shared/email/shell.ts";

const m = mesaasEmail({ preheader: "Prévia <b>", eyebrow: "Convite", sections: ["<p>A</p>", "<p>B</p>"], footerLines: ["Motivo <x>"] });
const b = brandedEmail({ preheader: "Prévia", workspaceName: "Agência <Lume>", brandColor: "#7c3aed", logoUrl: "javascript:alert(1)", sections: ["<p>A</p>"], footerHtml: ["Enviado por X via Mesaas"] });

Deno.test("both shells: light scheme pinned, 560 card, explicit backgrounds, mobile css, no em-dash", () => {
  for (const h of [m, b]) {
    assert(h.startsWith("<!DOCTYPE html>"));
    assert(h.includes(`<meta name="color-scheme" content="light">`));
    assert(h.includes(`<meta name="supported-color-schemes" content="light">`));
    assert(h.includes(`width="560"`) && h.includes("max-width: 560px"));
    assert(h.includes(`bgcolor="#f5f6f8"`) && h.includes(`bgcolor="#ffffff"`));
    assert(h.includes("@media (max-width: 600px)"));
    assert(!h.includes("—"));
    assert(!/display:\s*(flex|grid)/.test(h));
  }
});

Deno.test("mesaasEmail: logo with styled alt, eyebrow, escaped preheader and footer, tagline", () => {
  assert(m.includes(`src="https://www.mesaas.com.br/logo-black-email.png"`));
  assert(m.includes(`alt="Mesaas"`) && /alt="Mesaas"[^>]*font-weight: 700/.test(m), "alt must be styled for blocked images");
  assert(m.includes("Convite"));
  assert(m.includes("Prévia &lt;b&gt;") && m.includes("Motivo &lt;x&gt;"));
  assert(m.includes(MESAAS_TAGLINE));
  assert(!m.includes("gestão inteligente"));
  assertEquals((m.match(/<p>A<\/p>/g) ?? []).length, 1);
});

Deno.test("brandedEmail: brand band kept, unsafe logo dropped, bad colour defaulted, no Mesaas logo", () => {
  assert(b.includes("background: #7c3aed"), "brand band colour missing");
  assert(b.includes("Agência &lt;Lume&gt;"));
  assert(!b.includes("javascript:"), "unsafe logo leaked");
  assert(!b.includes("logo-black-email.png"));
  const bad = brandedEmail({ preheader: "p", workspaceName: "W", brandColor: "nope", logoUrl: null, sections: [], footerHtml: [] });
  assert(bad.includes("background: #eab308"));
  assert(!b.includes("box-shadow"), "card shadow should be gone");
});
```

- [ ] **Step 2: Run it, expect FAIL.**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/email-shell_test.ts`

- [ ] **Step 3: Write `supabase/functions/_shared/email/shell.ts`:**

```ts
/**
 * Document shells for transactional e-mail (spec §3/§4).
 * - mesaasEmail: Mesaas logo header + category eyebrow; sent by Mesaas.
 * - brandedEmail: the agency's full brand band (buildBrandHeaderBand, unchanged);
 *   sent on the agency's behalf to its client.
 * Tables only; light scheme pinned; desktop padding inline, mobile via @media.
 */
import { escapeHtml } from "../report-template/escape.ts";
import { buildBrandHeaderBand, buildPreheader } from "../report-template/brand-header.ts";
import { EMAIL, EMAIL_LOGO_URL, FONT_STACK } from "./tokens.ts";
import { corSegura, linkSeguro } from "./safe.ts";
import { eyebrow as eyebrowBlock } from "./blocks.ts";

export const MESAAS_TAGLINE = "Mesaas · Plataforma de gestão para agências de social media";

// The element rule carries the font into nested cells for Outlook's Word engine,
// which does not inherit font-family from the wrapper table; other clients
// inherit it from the wrapper's inline style even if <style> is stripped.
const MOBILE_CSS = `body, table, td, p, a, li, h1, span, strong { font-family: ${FONT_STACK}; }
@media (max-width: 600px) {
  .m-px { padding-left: 24px !important; padding-right: 24px !important; }
  .m-h1 { font-size: 22px !important; line-height: 28px !important; }
  .m-btn { width: 100% !important; }
  .m-btn a { display: block !important; }
  .m-stack { display: block !important; width: 100% !important; padding: 0 0 12px 0 !important; }
  .m-kpi { display: block !important; width: auto !important; margin: 0 0 12px 0 !important; }
  .m-kpi-gap { display: none !important; }
}`;

function documentOpen(preheader: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<style>${MOBILE_CSS}</style>
</head>
<body style="margin: 0; padding: 0; background: ${EMAIL.page};">
${buildPreheader(preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${EMAIL.page}" style="background: ${EMAIL.page};">
<tr><td align="center" style="padding: 32px 12px 40px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width: 100%; max-width: 560px; font-family: ${FONT_STACK};">
<tr><td>`;
}

function cardOpen(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${EMAIL.card}" style="background: ${EMAIL.card}; border: 1px solid ${EMAIL.border}; border-radius: 12px; border-collapse: separate; overflow: hidden;">`;
}

function sectionRows(sections: string[], firstTop: number, firstPrefix = ""): string {
  const rows = sections.map((s, i) =>
    `<tr><td class="m-px" style="padding: ${i === 0 ? firstTop : 24}px 40px 0;">${i === 0 ? firstPrefix : ""}${s}</td></tr>`
  ).join("\n");
  return `${rows}\n<tr><td style="height: 36px; line-height: 36px; font-size: 0;">&nbsp;</td></tr>`;
}

function documentClose(footerRowsHtml: string): string {
  return `</table>
</td></tr>
<tr><td class="m-px" style="padding: 24px 40px 0; font-size: 12px; line-height: 18px; color: ${EMAIL.muted};">${footerRowsHtml}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export interface MesaasEmailInput {
  preheader: string;
  eyebrow: string;
  eyebrowTone?: "brand" | "danger";
  sections: string[];
  footerLines: string[];
}

export function mesaasEmail(p: MesaasEmailInput): string {
  const header = `<tr><td class="m-px" style="padding: 28px 40px 24px; border-bottom: 1px solid ${EMAIL.divider};"><img src="${EMAIL_LOGO_URL}" width="158" height="20" alt="Mesaas" style="display: block; border: 0; outline: none; color: ${EMAIL.ink}; font-size: 18px; line-height: 20px; font-weight: 700;"></td></tr>`;
  const footer = [...p.footerLines.map(escapeHtml), escapeHtml(MESAAS_TAGLINE)]
    .map((l, i, all) => `<p style="margin: 0 0 ${i === all.length - 1 ? 0 : 6}px;">${l}</p>`).join("");
  return documentOpen(p.preheader) + cardOpen() + header +
    sectionRows(p.sections, 36, eyebrowBlock(p.eyebrow, p.eyebrowTone ?? "brand")) +
    documentClose(footer);
}

export interface BrandedEmailInput {
  preheader: string;
  workspaceName: string;
  brandColor: string | null | undefined;
  logoUrl: string | null | undefined;
  sections: string[];
  footerHtml: string[];
}

export function brandedEmail(p: BrandedEmailInput): string {
  const band = buildBrandHeaderBand({
    workspaceName: p.workspaceName,
    brandColor: corSegura(p.brandColor),
    logoUrl: linkSeguro(p.logoUrl),
  });
  const footer = p.footerHtml
    .map((l, i, all) => `<p style="margin: 0 0 ${i === all.length - 1 ? 0 : 6}px;">${l}</p>`).join("");
  return documentOpen(p.preheader) + cardOpen() + band + sectionRows(p.sections, 32) + documentClose(footer);
}
```

- [ ] **Step 4: Run the test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/email/shell.ts supabase/functions/__tests__/email-shell_test.ts
git commit -m "feat(email): shells mesaasEmail e brandedEmail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Agenda reminder + Instagram connect e-mails (the two `layout()` consumers)

**Files:**
- Modify: `supabase/functions/_shared/agenda-email.ts`
- Modify: `supabase/functions/_shared/instagram-connect-email.ts`
- Test: `supabase/functions/__tests__/agenda-email_test.ts` (line 73), `supabase/functions/__tests__/instagram-connect-email_test.ts`

**Interfaces:**
- Consumes: `mesaasEmail` (Task 4); `heading`, `paragraph`, `paragraphHtml`, `strong`, `steps`, `button`, `fallbackLink`, `eventCard` (Task 3); `EMAIL` (Task 2).
- Produces: unchanged exports (`buildLembreteEmail`, `LembreteEmailParams`, `buildConnectLinkEmail`, `buildConnectedNoticeEmail`, subjects, senders). Neither file imports `layout` any more.

- [ ] **Step 1: Add the failing assertions.** In `__tests__/agenda-email_test.ts` change line 73's `"Abrir na agenda"` to `"Abrir na Agenda"`, and append:

```ts
Deno.test("lembrete: new shell, date tile, meeting link guarded", () => {
  const { html } = buildLembreteEmail({
    titulo: "Pauta <Café>", inicio: "2026-10-12T17:00:00Z", fim: "2026-10-12T18:00:00Z", diaInteiro: false,
    local: "Rua Augusta, 1200", linkReuniao: "javascript:alert(1)", tz: "America/Sao_Paulo", minutos: 60,
    abrirUrl: "https://app.test/agenda", appBaseUrl: "https://app.test",
  });
  assert(html.includes("logo-black-email.png") && html.includes(`<meta name="color-scheme" content="light">`));
  assert(html.includes(">OUT<") && html.includes(">12<"), "date tile missing");
  assert(html.includes("Pauta &lt;Café&gt;") && !html.includes("&amp;lt;"), "title escaped once");
  assert(!html.includes("javascript:") && !html.includes("Entrar na reunião"));
  assert(html.includes("Segunda, 12 de outubro · 14:00 a 15:00"), "preheader/when line");
});
```

(Use the file's existing `assert` import; add it to the std import if missing.)

`__tests__/instagram-connect-email_test.ts` line 1 imports only `assertEquals` from `./assert.ts`: change it to `import { assert, assertEquals } from "./assert.ts";` (if `./assert.ts` does not export `assert`, import `assert` from `https://deno.land/std@0.224.0/assert/mod.ts` instead).

In `__tests__/instagram-connect-email_test.ts` append:

```ts
Deno.test("connect link: eyebrow, steps, fallback link, new shell", () => {
  const html = buildConnectLinkEmail({ agencyName: "Agência Lume", clienteName: "Clínica <S>", connectUrl: "https://app.test/c/abc", appBaseUrl: "https://app.test" });
  assert(html.includes("A pedido de Agência Lume"));
  assert(html.includes("Conecte o Instagram de Clínica &lt;S&gt;"));
  assert(html.includes("Se o botão não funcionar") && html.includes("https://app.test/c/abc"));
  assert(html.includes("logo-black-email.png") && !html.includes("#1a3d2b"));
});

Deno.test("connected notice: eyebrow and button", () => {
  const html = buildConnectedNoticeEmail({ clienteName: "Clínica", igUsername: "clinica", clienteUrl: "https://app.test/clientes/1", appBaseUrl: "https://app.test" });
  assert(html.includes("Instagram conectado") && html.includes("@clinica") && html.includes("Ver o cliente"));
});
```

- [ ] **Step 2: Run both files, expect FAIL** on the new assertions.

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/agenda-email_test.ts supabase/functions/__tests__/instagram-connect-email_test.ts`

- [ ] **Step 3: Rewrite `agenda-email.ts`.** Replace the imports with:

```ts
import { sanitizeSubjectValue } from "./lifecycle-emails.ts";
import { mesaasEmail } from "./email/shell.ts";
import { button, eventCard, heading } from "./email/blocks.ts";
import { EMAIL } from "./email/tokens.ts";
```

Change `headingText` to return **raw** text (the block escapes): replace `const t = escapeHtml(p.titulo);` with `const t = p.titulo;`. Delete `const HTTP_URL = …`. Add below `ymd`:

```ts
/** "OUT" / "12" for the date tile, in the event's zone (same basis as whenLine). */
function tileParts(iso: string, tz: string): { mes: string; dia: string } {
  const p = timeParts(iso, tz, { day: "numeric", month: "short" });
  return { mes: (p.month ?? "").replace(".", "").toUpperCase(), dia: p.day ?? "" };
}
```

Replace the whole body of `buildLembreteEmail` with:

```ts
export function buildLembreteEmail(p: LembreteEmailParams): { subject: string; html: string } {
  const subject = sanitizeSubjectValue(`${leadLabel(p.minutos, p.diaInteiro)}: ${p.titulo}`);
  const quando = whenLine(p);
  const local = p.local?.trim() || null;
  const { mes, dia } = tileParts(p.inicio, p.tz);
  const html = mesaasEmail({
    preheader: local ? `${quando} · ${local}` : quando,
    eyebrow: "Agenda",
    sections: [
      heading(headingText(p)),
      eventCard({
        mes, dia, tileColor: EMAIL.ink, titulo: p.titulo,
        lines: local ? [quando, local] : [quando],
        meetingUrl: p.linkReuniao,
      }),
      button(p.abrirUrl, "Abrir na Agenda"),
    ],
    footerLines: ["Você recebe este lembrete porque participa deste evento. Para desligar, vá em Configurações, Notificações."],
  });
  return { subject, html };
}
```

Remove the now-unused `escapeHtml` import if nothing else in the file uses it.

- [ ] **Step 4: Rewrite `instagram-connect-email.ts`.** Imports become:

```ts
import { LIFECYCLE_FROM, sanitizeSubjectValue, sendViaResend } from "./lifecycle-emails.ts";
import { mesaasEmail } from "./email/shell.ts";
import { button, fallbackLink, heading, paragraph, paragraphHtml, steps, strong } from "./email/blocks.ts";
import { escapeHtml } from "./report-template/escape.ts";
```

Delete the local `ctaButton`. Replace both builders:

```ts
export function buildConnectLinkEmail(p: {
  agencyName: string;
  clienteName: string;
  connectUrl: string;
  appBaseUrl: string;
}): string {
  return mesaasEmail({
    preheader: `${p.agencyName} pediu para conectar o Instagram de ${p.clienteName}.`,
    eyebrow: `A pedido de ${p.agencyName}`,
    sections: [
      heading(`Conecte o Instagram de ${p.clienteName}`) +
        paragraphHtml(`${strong(p.agencyName)} pediu para conectar o Instagram de ${strong(p.clienteName)} ao Mesaas, a ferramenta que a agência usa para agendar publicações e acompanhar resultados.`, "body", "0"),
      steps([
        "Abra o link abaixo.",
        `Entre com a conta do Instagram de ${escapeHtml(p.clienteName)}.`,
        "Pronto. A agência não vê sua senha em momento algum.",
      ]),
      button(p.connectUrl, "Conectar Instagram") + fallbackLink(p.connectUrl) +
        paragraph(`Não esperava este pedido? Responda este e-mail e fale direto com ${p.agencyName}.`, "small", "16px 0 0"),
    ],
    footerLines: [`Enviado a pedido de ${p.agencyName}`],
  });
}

export function buildConnectedNoticeEmail(p: {
  clienteName: string;
  igUsername: string;
  clienteUrl: string;
  appBaseUrl: string;
}): string {
  return mesaasEmail({
    preheader: `@${p.igUsername} foi conectado a ${p.clienteName}.`,
    eyebrow: "Instagram",
    sections: [
      heading("Instagram conectado") +
        paragraphHtml(`O cliente ${strong(p.clienteName)} concluiu a conexão do Instagram.`) +
        paragraphHtml(`Conta conectada: ${strong(`@${p.igUsername}`)}`, "body", "0"),
      button(p.clienteUrl, "Ver o cliente"),
    ],
    footerLines: ["Notificação automática do Mesaas"],
  });
}
```

- [ ] **Step 5: Run both test files, expect PASS.** Any older assertion that pinned the old markup (green hex, `layout` text) is updated to the new copy; assertions on escaping and on the subject stay as they are.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/agenda-email.ts supabase/functions/_shared/instagram-connect-email.ts supabase/functions/__tests__/agenda-email_test.ts supabase/functions/__tests__/instagram-connect-email_test.ts
git commit -m "feat(email): lembrete da Agenda e conexão do Instagram no shell novo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Notification digest

**Files:**
- Modify: `supabase/functions/_shared/notification-email.ts`
- Test: `supabase/functions/__tests__/notification-email_test.ts`

**Interfaces:**
- Consumes: `mesaasEmail`; `heading`, `badge`, `paragraph`, `callout`, `link` from blocks; `BadgeTone` from tokens.
- Produces: `DigestItem` gains `badge?: { tone: BadgeTone; label: string }`; `resolveDigestItem` fills it; `buildDigestHtml(items, appBase)` signature unchanged; new export `digestPreheader(items: DigestItem[]): string`.

- [ ] **Step 1: Write the failing tests.** Append to `__tests__/notification-email_test.ts` (import `digestPreheader` and `buildDigestHtml` alongside the existing imports):

```ts
Deno.test("resolveDigestItem: every known type gets its badge", () => {
  const cases: Array<[string, string, string]> = [
    ["post_publish_failed", "danger", "Falha na publicação"], ["post_correction", "warning", "Correção"],
    ["post_approved", "success", "Aprovado"], ["post_message", "info", "Mensagem"], ["client_message", "info", "Mensagem"],
    ["mention", "info", "Menção"], ["deadline_approaching", "warning", "Prazo"], ["task_assigned", "neutral", "Tarefa"],
    ["post_assigned", "neutral", "Post"], ["event_invited", "neutral", "Agenda"], ["event_updated", "neutral", "Agenda"],
    ["event_cancelled", "neutral", "Agenda"], ["event_client_rsvp", "info", "Resposta"], ["event_guest_rsvp", "info", "Resposta"],
    ["event_reschedule_requested", "warning", "Remarcação"], ["algo_novo", "neutral", "Notificação"],
  ];
  for (const [type, tone, label] of cases) {
    const it = resolveDigestItem({ type, metadata: null, link: null });
    assertEquals(it.badge, { tone, label }, type);
  }
});

Deno.test("digestPreheader: 1, 3 and 25 items", () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ priority: 1, heading: `T${i + 1}`, link: "/" }));
  assertEquals(digestPreheader(mk(1)), "T1.");
  assertEquals(digestPreheader(mk(3)), "T1, T2 e T3.");
  assertEquals(digestPreheader(mk(25)), "T1, T2, T3 e mais 22.");
});

Deno.test("buildDigestHtml: heading, badges, links, item without badge, 25 items all rendered", () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ priority: 1, heading: `Item ${i + 1}`, link: `/x/${i}` }));
  const html = buildDigestHtml(items, "https://app.test");
  assert(html.includes("Você tem 25 novidades"));
  assertEquals((html.match(/Abrir no Mesaas/g) ?? []).length, 25);
  assert(html.includes(">Notificação<"), "missing badge falls back to neutral");
  assert(html.includes(`href="https://app.test/x/24"`));
  const one = buildDigestHtml([{ priority: 1, heading: "Só um", link: "/a", badge: { tone: "danger", label: "Falha na publicação" } }], "https://app.test");
  assert(one.includes("Você tem 1 novidade<") && one.includes("Falha na publicação"));
});
```

- [ ] **Step 2: Run, expect FAIL.**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/notification-email_test.ts`

- [ ] **Step 3: Implement.** In `notification-email.ts`:

Add imports:

```ts
import { mesaasEmail } from "./email/shell.ts";
import { badge, callout, heading, link, paragraph } from "./email/blocks.ts";
import type { BadgeTone } from "./email/tokens.ts";
```

Extend the interface:

```ts
export interface DigestItem {
  priority: number;
  heading: string;
  body?: string;
  context?: string;
  link: string;
  /** Optional: absent renders the neutral "Notificação" badge. */
  badge?: { tone: BadgeTone; label: string };
}

const DIGEST_BADGES: Record<string, { tone: BadgeTone; label: string }> = {
  post_publish_failed: { tone: "danger", label: "Falha na publicação" },
  post_correction: { tone: "warning", label: "Correção" },
  post_approved: { tone: "success", label: "Aprovado" },
  post_message: { tone: "info", label: "Mensagem" },
  client_message: { tone: "info", label: "Mensagem" },
  mention: { tone: "info", label: "Menção" },
  deadline_approaching: { tone: "warning", label: "Prazo" },
  task_assigned: { tone: "neutral", label: "Tarefa" },
  post_assigned: { tone: "neutral", label: "Post" },
  event_invited: { tone: "neutral", label: "Agenda" },
  event_updated: { tone: "neutral", label: "Agenda" },
  event_cancelled: { tone: "neutral", label: "Agenda" },
  event_client_rsvp: { tone: "info", label: "Resposta" },
  event_guest_rsvp: { tone: "info", label: "Resposta" },
  event_reschedule_requested: { tone: "warning", label: "Remarcação" },
};
const DEFAULT_BADGE = { tone: "neutral" as const, label: "Notificação" };
```

Rename the existing exported `resolveDigestItem` to a private `resolveDigestItemBase` (same body, drop `export`) and add:

```ts
export function resolveDigestItem(
  row: { type: string; metadata: Record<string, unknown> | null; link: string | null },
): DigestItem {
  return { ...resolveDigestItemBase(row), badge: DIGEST_BADGES[row.type] ?? DEFAULT_BADGE };
}
```

(Keep the exact parameter type the old function had; copy it from the old signature if it differs from the one above.)

Replace `itemRow` and `buildDigestHtml` with:

```ts
export function digestPreheader(items: DigestItem[]): string {
  const titles = items.slice(0, 3).map((i) => i.heading);
  const rest = items.length - titles.length;
  if (rest > 0) return `${titles.join(", ")} e mais ${rest}.`;
  if (titles.length <= 1) return `${titles[0] ?? "Você tem novidades no Mesaas"}.`;
  return `${titles.slice(0, -1).join(", ")} e ${titles[titles.length - 1]}.`;
}

function itemRow(it: DigestItem, appBase: string, last: boolean): string {
  const b = it.badge ?? DEFAULT_BADGE;
  const bd = last ? "" : "border-bottom: 1px solid #eef0f3;";
  return `<tr><td style="padding: 20px 0; ${bd}">
    <p style="margin: 0 0 10px;">${badge(b.tone, b.label)}</p>
    <p style="margin: 0; font-size: 15px; line-height: 22px; font-weight: 700; color: #12151a; word-break: break-word;">${escapeHtml(it.heading)}</p>
    ${it.context ? paragraph(it.context, "small", "2px 0 0") : ""}
    ${it.body ? `<div style="margin: 10px 0 0;">${callout(escapeHtml(it.body))}</div>` : ""}
    <p style="margin: 12px 0 0; font-size: 14px;">${link(`${appBase}${it.link}`, "Abrir no Mesaas")}</p>
  </td></tr>`;
}

export function buildDigestHtml(items: DigestItem[], appBase: string): string {
  const n = items.length;
  const rows = items.map((it, i) => itemRow(it, appBase, i === n - 1)).join("");
  return mesaasEmail({
    preheader: digestPreheader(items),
    eyebrow: "Resumo de notificações",
    sections: [
      heading(n === 1 ? "Você tem 1 novidade" : `Você tem ${n} novidades`),
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`,
    ],
    footerLines: ["Você recebeu este e-mail porque tem notificações não lidas no Mesaas. Ajuste em Configurações · Notificações."],
  });
}
```

- [ ] **Step 4: Run, expect PASS.** Older assertions that pinned the old green markup get updated to the new copy; assertions on headings, context, escaping and links stay.

- [ ] **Step 5: Run the cron suite too** (it renders the digest): `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/notification-email-cron_test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/notification-email.ts supabase/functions/__tests__/notification-email_test.ts
git commit -m "feat(email): resumo de notificações com selos e shell novo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Welcome + thank-you, remove `layout()`

**Depends on:** Task 5 (no other module may import `layout`).

**Files:**
- Modify: `supabase/functions/_shared/lifecycle-emails.ts`
- Test: `supabase/functions/__tests__/lifecycle-emails_test.ts`

**Interfaces:**
- Consumes: `mesaasEmail`; `heading`, `paragraph`, `paragraphHtml`, `sectionTitle`, `steps`, `featureGrid`, `callout`, `link`, `button`, `signature` from blocks.
- Produces: `WELCOME_SUBJECT = "Boas-vindas ao Mesaas 👋"`; `buildWelcomeEmail`, `buildThankYouEmail` unchanged signatures. `layout`, `featureCard`, `stepRow`, `ctaButton`, `greeting` deleted. Everything else in the file (`LIFECYCLE_FROM`, `sanitizeSubjectValue`, notices, `sendViaResend`, …) untouched.

- [ ] **Step 1: Update the tests first.** In `__tests__/lifecycle-emails_test.ts`:
  - line 54: `src="${BASE}/logo-white-email.png"` → `src="https://www.mesaas.com.br/logo-black-email.png"`;
  - line 116: expected `WELCOME_SUBJECT` → `"Boas-vindas ao Mesaas 👋"`;
  - lines 245-251: **no change.** That loop covers only the founder notices (`noticeLayout`), which are out of scope and keep `background:#f5f3ee` / `background:#ffffff`;
  - line 37 (`Olá, &lt;b&gt;Ana&lt;/b&gt;!`) and line 43/44 (`Olá!`, no `Olá, `) stay as they are and must still pass.
  Append:

```ts
Deno.test("welcome: new shell, steps then grid, signature, no emoji icons", () => {
  const html = buildWelcomeEmail({ firstName: "Ana", appBaseUrl: "https://app.test" });
  assert(html.includes("Olá, Ana! Que bom ter você aqui."));
  assert(!html.includes("Que bom ter você por aqui"), "duplicate welcome line must go");
  assert(html.indexOf("Comece em 3 passos") < html.indexOf("Clientes &amp; CRM"), "steps come before the grid");
  assert(html.includes(`href="https://app.test/importar"`));
  assert(html.includes("Fundador do Mesaas"));
  assert(!/[👥📋✅📈📚]/u.test(html));
  assert(html.includes("Boas-vindas"), "eyebrow");
});
```

- [ ] **Step 2: Run, expect FAIL.**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/lifecycle-emails_test.ts`

- [ ] **Step 3: Implement.** In `lifecycle-emails.ts`: set `WELCOME_SUBJECT = "Boas-vindas ao Mesaas 👋"`; delete `greeting`, `layout`, `featureCard`, `stepRow`, `ctaButton` and their doc comments; add imports:

```ts
import { mesaasEmail } from "./email/shell.ts";
import { button, callout, featureGrid, heading, link, paragraph, paragraphHtml, sectionTitle, signature, steps } from "./email/blocks.ts";
```

Replace both builders:

```ts
export function buildWelcomeEmail(p: { firstName: string | null; appBaseUrl: string }): string {
  const base = p.appBaseUrl.replace(/\/+$/, "");
  const waUrl = whatsAppSupportUrl({ firstName: p.firstName });
  // Gated by the same waUrl as the button, so the sentence never mentions a missing button.
  const closingLine = waUrl
    ? `Qualquer dúvida, é só <strong>responder este e-mail</strong>. Eu leio e respondo pessoalmente, e se preferir WhatsApp, é só clicar no botão abaixo.`
    : `Qualquer dúvida, é só <strong>responder este e-mail</strong>. Eu leio e respondo pessoalmente.`;
  return mesaasEmail({
    preheader: "Três passos para deixar sua agência rodando.",
    eyebrow: "Boas-vindas",
    sections: [
      heading(p.firstName ? `Olá, ${p.firstName}! Que bom ter você aqui.` : "Olá! Que bom ter você aqui.") +
        paragraph("Aqui é o Eduardo, do Mesaas. Obrigado por criar sua conta.") +
        paragraphHtml(
          "O Mesaas é uma <strong>plataforma de gestão para agências de social media</strong>: clientes, entregas, aprovações e analytics em um lugar só, com um portal whitelabel para o seu cliente final.",
          "body",
          "0",
        ),
      sectionTitle("Comece em 3 passos") +
        steps([
          "Cadastre seu primeiro cliente.",
          `<strong>Importe seus dados</strong>: trazemos tudo do Notion, Trello, ClickUp ou CSV em poucos cliques.<div style="margin-top: 14px;">${button(`${base}/importar`, "Importar meus dados")}</div>`,
          "Convide sua equipe e compartilhe o Hub com o cliente.",
        ]),
      featureGrid([
        { title: "Clientes & CRM", text: "Todos os seus clientes, briefings e contratos organizados." },
        { title: "Entregas", text: "kanban de workflows + calendário editorial." },
        { title: "Aprovações pelo Hub do cliente", text: "Portal whitelabel, sem login, com a sua marca." },
        { title: "Analytics de Instagram", text: "Métricas e relatórios prontos para enviar." },
      ]),
      callout(`Dúvidas? A ${link(`${base}/ajuda`, "Central de Ajuda")} tem guias passo a passo, e as ${link(`${base}/novidades`, "Novidades")} mostram o que estamos lançando.`),
      paragraphHtml(closingLine, "body", "0 0 18px") +
        (waUrl ? `<div style="margin: 0 0 24px;">${button(waUrl, "Falar no WhatsApp", "outline")}</div>` : "") +
        signature(),
    ],
    footerLines: ["Você recebeu este e-mail porque criou uma conta no Mesaas."],
  });
}

export function buildThankYouEmail(
  p: { firstName: string | null; workspaceName: string; appBaseUrl: string },
): string {
  const base = p.appBaseUrl.replace(/\/+$/, "");
  return mesaasEmail({
    preheader: "Obrigado pela confiança no Mesaas.",
    eyebrow: "Assinatura",
    sections: [
      heading(p.firstName ? `Olá, ${p.firstName}!` : "Olá!") +
        paragraphHtml(`Aqui é o Eduardo, do Mesaas. Vi que o <strong>${escapeHtml(p.workspaceName)}</strong> acabou de ativar um plano e queria agradecer pessoalmente.`) +
        paragraph("Obrigado por depositar essa confiança no Mesaas. Vamos trabalhar todos os dias para merecer essa escolha e cuidar bem da operação da sua agência.", "body", "0"),
      sectionTitle("Para aproveitar ao máximo") +
        steps([
          "Conecte o Instagram dos seus clientes e acompanhe as métricas.",
          `Traga seus dados de outras ferramentas: ${link(`${base}/importar`, "importe do Notion, Trello, ClickUp ou CSV")}.`,
          "Ative o Hub para os seus clientes aprovarem posts sem precisar de login.",
        ]),
      paragraphHtml(`Seu plano fica em ${link(`${base}/configuracao`, "Configurações")}, e você pode ajustá-lo quando quiser.`, "small", "0"),
      paragraphHtml("Me conta: o que faria o Mesaas ser ainda melhor para a sua agência? É só <strong>responder este e-mail</strong>.", "body", "0 0 24px") +
        signature(),
    ],
    footerLines: [`Você recebeu este e-mail porque o workspace ${p.workspaceName} ativou um plano no Mesaas.`],
  });
}
```

Note the URL-ampersand test (line 97) passes because `button`/`link` entity-encode `&` in the href.

- [ ] **Step 4: Prove nothing imports `layout` any more:** `grep -rnE "import \{[^}]*\blayout\b" supabase/functions --include='*.ts'` → no output. (A plain `grep "layout("` hits `_shared/report-docs/layout.test.ts`, which is unrelated.)

- [ ] **Step 5: Run lifecycle tests + the cron test, expect PASS.**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/lifecycle-emails_test.ts supabase/functions/__tests__/lifecycle-email-cron_test.ts`

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/lifecycle-emails.ts supabase/functions/__tests__/lifecycle-emails_test.ts
git commit -m "feat(email): boas-vindas e agradecimento no shell novo; remove layout()

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Dunning, invite, affiliate

**Files:**
- Modify: `supabase/functions/_shared/dunning-email.ts`
- Modify: `supabase/functions/_shared/invite-email.ts`
- Modify: `supabase/functions/affiliate-public/email.ts`
- Test: `supabase/functions/__tests__/dunning-email_test.ts`, `__tests__/invite-email_test.ts`, `__tests__/affiliate-public_test.ts`

**Interfaces:**
- Consumes: `mesaasEmail`; `heading`, `paragraph`, `paragraphHtml`, `strong`, `button`, `fallbackLink`, `detailRows`, `alert` from blocks.
- Produces: `DunningCopy` gains `alerta?: string`; `buildDunningCopy(stage, workspaceName, _nextAttemptLabel)` no longer puts the retry date in `body`; subjects use `": "` not `" — "`. `buildDunningEmail`, `buildInviteEmail`, `buildAffiliateLinkEmail` keep their signatures; none needs `appBaseUrl`.

- [ ] **Step 1: Update/add tests.** In `__tests__/dunning-email_test.ts`:
  - line 7 (`copy.body.includes("24 de julho")`) → replace with an e-mail-level check:

```ts
  const html = buildDunningEmail({ stage: "first", workspaceName: "Agência DK", nextAttemptLabel: "24 de julho", billingUrl: "https://app.test/configuracao/cobranca" });
  assert(html.includes("Próxima tentativa") && html.includes("24 de julho"));
  assert(!copy.body.includes("24 de julho"), "date lives in the details box, not twice");
```

  - line 15 (`copy.body.includes("Free")` for final) → `assert(copy.alerta?.includes("Free"))`.
  Append:

```ts
Deno.test("dunning: subjects have no em-dash; final is red-labelled with an alert; ink button everywhere", () => {
  for (const stage of ["first", "retry", "final"] as const) {
    const copy = buildDunningCopy(stage, "Agência DK", "24 de julho");
    assert(!copy.subject.includes("—"), stage);
    const html = buildDunningEmail({ stage, workspaceName: "Agência <DK>", nextAttemptLabel: null, billingUrl: "https://app.test/c" });
    assert(html.includes(`bgcolor="#12151a"`), `${stage}: ink button`);
    assert(html.includes("Agência &lt;DK&gt;") && !html.includes("&amp;lt;"), `${stage}: escaped once`);
    assert(!html.includes("Próxima tentativa"), `${stage}: no date row without a date`);
  }
  assertEquals(buildDunningCopy("first", "W", null).subject, "Não conseguimos processar seu pagamento: W");
  const fin = buildDunningEmail({ stage: "final", workspaceName: "W", nextAttemptLabel: null, billingUrl: "https://app.test/c" });
  assert(fin.includes("Último aviso") && fin.includes("#b91c1c") && fin.includes("plano Free"));
});
```

  In `__tests__/invite-email_test.ts` first add `assert` to the std import on lines 1-4 (it imports only `assertEquals, assertStringIncludes`), then append:

```ts
Deno.test("invite: new shell, fallback link, escaped workspace", () => {
  const html = buildInviteEmail({ actionLink: "https://auth.test/verify?a=1&b=2", workspaceName: "Agência <L>" });
  assert(html.includes("Você foi convidado para o Agência &lt;L&gt;"));
  assert(html.includes("Definir minha senha") && html.includes("Se o botão não funcionar"));
  assert(html.includes(`href="https://auth.test/verify?a=1&amp;b=2"`));
  assert(html.includes("logo-black-email.png") && !html.includes("#1a3d2b"));
});
```

  In `__tests__/affiliate-public_test.ts` append (import `buildAffiliateLinkEmail` from `../affiliate-public/email.ts` if not imported):

```ts
Deno.test("affiliate e-mail: new shell, first name, button", () => {
  const html = buildAffiliateLinkEmail({ nome: "Ana <Souza>", link: "https://app.test/afiliados/painel?t=x" });
  assert(html.includes("Olá, Ana!") && html.includes("Programa de afiliados") && html.includes("Abrir meu painel"));
  assert(html.includes("logo-black-email.png") && !html.includes("#1a3d2b"));
});
```

  (If the existing affiliate test asserts the first-name split on `"Ana Souza"`, keep it; the new test name contains `<Souza>` only in the second word, which is dropped.)

- [ ] **Step 2: Run the three files, expect FAIL.**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/dunning-email_test.ts supabase/functions/__tests__/invite-email_test.ts supabase/functions/__tests__/affiliate-public_test.ts`

- [ ] **Step 3: Implement `dunning-email.ts`.** Add `alerta?: string;` to the `DunningCopy` interface. Replace `buildDunningCopy` and `buildDunningEmail`:

```ts
export function buildDunningCopy(
  stage: DunningStage,
  workspaceName: string,
  _nextAttemptLabel: string | null,
): DunningCopy {
  switch (stage) {
    case "first":
      return {
        subject: `Não conseguimos processar seu pagamento: ${workspaceName}`,
        heading: "Não conseguimos processar seu pagamento",
        body: `A cobrança da assinatura do ${workspaceName} não foi aprovada. ` +
          `Isso normalmente acontece quando o cartão expirou ou foi substituído.`,
        cta: "Atualizar forma de pagamento",
      };
    case "retry":
      return {
        subject: `Ainda não conseguimos processar seu pagamento: ${workspaceName}`,
        heading: "Ainda não conseguimos processar seu pagamento",
        body: `Continuamos sem conseguir cobrar a assinatura do ${workspaceName}. ` +
          `Atualize sua forma de pagamento para manter o acesso.`,
        cta: "Atualizar forma de pagamento",
      };
    case "final":
      return {
        subject: `Último aviso: o acesso ao ${workspaceName} será reduzido`,
        heading: "Último aviso",
        body: `Não conseguimos processar o pagamento da assinatura do ${workspaceName} após várias tentativas.`,
        alerta: `Sem uma forma de pagamento válida, o workspace será movido para o plano ` +
          `Free e os recursos do seu plano atual deixarão de funcionar.`,
        cta: "Regularizar agora",
      };
  }
}

export function buildDunningEmail(params: {
  stage: DunningStage;
  workspaceName: string;
  nextAttemptLabel: string | null;
  billingUrl: string;
}): string {
  // Raw values: every block escapes its own text.
  const copy = buildDunningCopy(params.stage, params.workspaceName, params.nextAttemptLabel);
  const final = params.stage === "final";
  const next = final ? null : params.nextAttemptLabel;
  const rows = [{ label: "Workspace", value: params.workspaceName }];
  if (next) rows.push({ label: "Próxima tentativa", value: next });
  const preheader = final
    ? "Sem um pagamento válido, o workspace vai para o plano Free."
    : next
    ? `Vamos tentar novamente em ${next}.`
    : "Atualize sua forma de pagamento para manter o acesso.";
  return mesaasEmail({
    preheader,
    eyebrow: final ? "Último aviso" : "Assinatura",
    eyebrowTone: final ? "danger" : "brand",
    sections: [
      heading(copy.heading) + paragraph(copy.body, "body", "0"),
      detailRows(rows) + (copy.alerta ? `<div style="margin: 12px 0 0;">${alert(copy.alerta)}</div>` : ""),
      button(params.billingUrl, copy.cta) +
        paragraph("Se você já atualizou seu pagamento, pode ignorar este e-mail.", "small", "16px 0 0"),
    ],
    footerLines: [],
  });
}
```

Imports: replace the `escapeHtml` import (if now unused) with:

```ts
import { mesaasEmail } from "./email/shell.ts";
import { alert, button, detailRows, heading, paragraph } from "./email/blocks.ts";
```

`sendDunningEmail` keeps calling `buildDunningCopy(...)` for the subject with the **raw** workspace name (it already does; confirm no `escapeHtml` wraps the subject).

- [ ] **Step 4: Implement `invite-email.ts`.** Replace `buildInviteEmail`:

```ts
export function buildInviteEmail(params: { actionLink: string; workspaceName: string }): string {
  return mesaasEmail({
    preheader: `Defina sua senha para entrar no ${params.workspaceName}.`,
    eyebrow: "Convite",
    sections: [
      heading(`Você foi convidado para o ${params.workspaceName}`) +
        paragraphHtml(`Para acessar o workspace ${strong(params.workspaceName)} no Mesaas, defina sua senha:`, "body", "0"),
      button(params.actionLink, "Definir minha senha") + fallbackLink(params.actionLink) +
        paragraph("Se você não esperava este convite, ignore este e-mail.", "small", "16px 0 0"),
    ],
    footerLines: [],
  });
}
```

Imports: `import { mesaasEmail } from "./email/shell.ts";` and `import { button, fallbackLink, heading, paragraph, paragraphHtml, strong } from "./email/blocks.ts";`. Drop the `escapeHtml` import if unused. Update the doc comment above it: escaping now happens inside the blocks.

- [ ] **Step 5: Implement `affiliate-public/email.ts`.** Replace `buildAffiliateLinkEmail`:

```ts
export function buildAffiliateLinkEmail(params: { nome: string; link: string }): string {
  const first = params.nome.split(" ")[0] || params.nome;
  return mesaasEmail({
    preheader: "Seu link de divulgação, indicações e comissões.",
    eyebrow: "Programa de afiliados",
    sections: [
      heading(`Olá, ${first}!`) +
        paragraph("Este é o link do seu painel de afiliado. Lá você encontra seu link de divulgação, acompanha suas indicações e comissões e cadastra sua chave PIX.", "body", "0"),
      button(params.link, "Abrir meu painel") +
        paragraph("O link é pessoal: não compartilhe este e-mail. Se você não pediu este acesso, ignore a mensagem.", "small", "16px 0 0"),
    ],
    footerLines: [],
  });
}
```

Imports: `import { mesaasEmail } from "../_shared/email/shell.ts";` and `import { button, heading, paragraph } from "../_shared/email/blocks.ts";`. Drop `escapeHtml` if unused.

- [ ] **Step 6: Run the three files + the dunning-notify consumers, expect PASS.**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/dunning-email_test.ts supabase/functions/__tests__/dunning-logic_test.ts supabase/functions/__tests__/invite-email_test.ts supabase/functions/__tests__/invite-actions_test.ts supabase/functions/__tests__/affiliate-public_test.ts`

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/dunning-email.ts supabase/functions/_shared/invite-email.ts supabase/functions/affiliate-public/email.ts supabase/functions/__tests__/dunning-email_test.ts supabase/functions/__tests__/invite-email_test.ts supabase/functions/__tests__/affiliate-public_test.ts
git commit -m "feat(email): cobrança, convite e afiliado no shell novo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Shared Agenda e-mail (client and guest)

**Files:**
- Modify: `supabase/functions/_shared/agenda-cliente-email.ts`
- Test: `supabase/functions/__tests__/agenda-cliente-email_test.ts`

**Interfaces:**
- Consumes: `brandedEmail`; `heading`, `paragraph`, `paragraphHtml`, `strong`, `button`, `eventCard`, `dateList`, `callout`, `quote`, `link` from blocks; `corSegura`, `linkSeguro` (already imported in Task 2); `EMAIL`.
- Produces: new export `mesDiaAgenda(q: QuandoAgenda): { mes: string; dia: string }`. `montarEmailAgendaCliente` keeps signature, return shape, subjects, attachments, button rules.

- [ ] **Step 1: Write the failing tests.** Append to `__tests__/agenda-cliente-email_test.ts` (reuse the file's existing item/ctx fixture builders; the names below assume a helper `item(overrides)` and `CTX`. If the file uses different helper names, use those):

```ts
import { mesDiaAgenda } from "../_shared/agenda-cliente-email.ts";

Deno.test("mesDiaAgenda: timed event uses its zone; all-day uses data_inicio_local", () => {
  assertEquals(mesDiaAgenda({ inicio: "2026-10-15T13:00:00Z", fim: "2026-10-15T14:00:00Z", dia_inteiro: false, tz: "America/Sao_Paulo" }), { mes: "OUT", dia: "15" });
  // 02:30Z on the 16th is still the 15th in Manaus (UTC-4).
  assertEquals(mesDiaAgenda({ inicio: "2026-10-16T02:30:00Z", fim: "2026-10-16T03:30:00Z", dia_inteiro: false, tz: "America/Manaus" }), { mes: "OUT", dia: "15" });
  // All-day: the stored local date wins, never inicio converted.
  assertEquals(mesDiaAgenda({ inicio: "2026-10-16T04:00:00Z", fim: "2026-10-17T04:00:00Z", dia_inteiro: true, data_inicio_local: "2026-10-16", tz: "America/Manaus" }), { mes: "OUT", dia: "16" });
});

Deno.test("agenda-cliente: tile day equals the 'quando' day for an all-day event in another zone", () => {
  const oc = { ocorrencia_id: 1, estado: "ativa" as const, sequencia: 0, inicio: "2026-11-02T04:00:00Z", fim: "2026-11-03T04:00:00Z", dia_inteiro: true, data_inicio_local: "2026-11-02", data_fim_local: "2026-11-03", tz: "America/Manaus", titulo: "Feriado", descricao: null, local: null, link_reuniao: null };
  const { html } = montarEmailAgendaCliente(item({ tipo: "convite", ocorrencias: [oc] }), CTX);
  assert(html.includes(">NOV<") && html.includes(">2<"), "tile");
  assert(html.includes("Segunda, 2 de novembro · dia inteiro"), "quando");
});

Deno.test("agenda-cliente: brand band kept, light brand flips tile/button text, organizer line, no emoji", () => {
  const { html } = montarEmailAgendaCliente(item({ tipo: "convite", brand_color: "#facc15", organizador_nome: "Ana Souza" }), CTX);
  assert(html.includes("background: #facc15"), "band");
  assert(html.includes("color: #171717;"), "dark text on light brand");
  assert(html.includes("Organizado por Ana Souza"));
  assert(!/[📅💬]/u.test(html));
  assert(html.includes(`<meta name="color-scheme" content="light">`));
});
```

(If `assertEquals` is not imported in this file, add it to the std import.)

- [ ] **Step 2: Run, expect FAIL.**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/agenda-cliente-email_test.ts`

- [ ] **Step 3: Add `mesDiaAgenda`** right after `formatarQuandoAgenda`:

```ts
/** "OUT" / "15" for the date tile. All-day rows use `data_inicio_local` as a
 * plain calendar date (same rule as formatarQuandoAgenda) so the tile can
 * never land a day off from the "quando" line. */
export function mesDiaAgenda(q: QuandoAgenda): { mes: string; dia: string } {
  const tz = tzSegura(q.tz);
  let d: Date;
  let zona: string;
  if (q.dia_inteiro) {
    const primeiro = q.data_inicio_local && YMD_RE.test(q.data_inicio_local)
      ? q.data_inicio_local
      : ymd(new Date(q.inicio), tz);
    d = dataLocal(primeiro);
    zona = "UTC";
  } else {
    d = new Date(q.inicio);
    zona = tz;
  }
  const p = partes(d, zona, { day: "numeric", month: "short" });
  return { mes: (p.month ?? "").replace(".", "").toUpperCase(), dia: p.day ?? "" };
}
```

- [ ] **Step 4: Replace the HTML helpers.** Delete `paragrafo`, `linha`, `citacao`, `cartaoEvento`, `listaCanceladas`, and `plural` (unused after the rewrite: `dateList` owns "e mais N datas"). Add imports:

```ts
import { brandedEmail } from "./email/shell.ts";
import { button, callout, dateList, eventCard, heading, link, paragraph, quote } from "./email/blocks.ts";
```

Remove `buildBrandHeaderBand`, `buildPreheader`, `pickHeaderTextColor` from the brand-header import if no longer used. Add:

```ts
/** Card for the first active occurrence; a series lists its dates below (one <li> each). */
function cartaoEvento(ativas: AgendaClienteOcorrencia[], cor: string, organizador: string | null): string {
  const base = ativas[0];
  const { mes, dia } = mesDiaAgenda(base);
  const linhas = [formatarQuandoAgenda(base)];
  if (base.local?.trim()) linhas.push(`Local: ${base.local.trim()}`);
  if (organizador) linhas.push(`Organizado por ${organizador}`);
  let html = eventCard({ mes, dia, tileColor: cor, titulo: base.titulo, lines: linhas, meetingUrl: base.link_reuniao });
  if (ativas.length > 1) {
    const visiveis = ativas.slice(0, DIAS_LISTADOS).map((o) =>
      `${o.titulo !== base.titulo ? `${o.titulo}: ` : ""}${formatarQuandoAgenda(o)}`
    );
    html += `<div style="margin: 14px 0 0;">${dateList(visiveis, ativas.length - visiveis.length)}</div>`;
  }
  if (base.descricao?.trim()) {
    html += `<p style="margin: 14px 0 0; font-size: 14px; line-height: 22px; color: #374151; white-space: pre-line; word-break: break-word;">${escapeHtml(base.descricao.trim())}</p>`;
  }
  return html;
}

function listaCanceladas(canceladas: AgendaClienteOcorrencia[], rotulo: string): string {
  const visiveis = canceladas.slice(0, DIAS_LISTADOS).map((o) => `${o.titulo}: ${formatarQuandoAgenda(o)}`);
  return callout(
    `<p style="margin: 0 0 6px; font-size: 13px; font-weight: 600; color: #4b5563;">${escapeHtml(rotulo)}</p>` +
      dateList(visiveis, canceladas.length - visiveis.length, true),
  );
}
```

- [ ] **Step 5: Rewrite the builder body from `let h1 = ""` to the end of the function.** Keep everything above it (subject, `brandColor = corSegura(...)`, `nome`, `saudacao` but as **raw** text, `organizador`, `remarcacao`, `respostaEquipe`). Change the greeting to raw: `const saudacao = nome ? \`Olá, ${nome}!\` : "Olá!";` and drop `safeWorkspace` (blocks escape). Then:

```ts
  let h1 = "";
  let preheader = "";
  let abertura = "";
  const secoes: string[] = [];
  let aviso: string | null = null;

  switch (variante) {
    case "convite": {
      if (convidado) {
        h1 = "Convite";
        abertura = organizador
          ? `${organizador} convidou você em nome de ${workspaceName}.`
          : `${workspaceName} convidou você para um evento.`;
        preheader = abertura;
      } else {
        h1 = "Novo evento";
        abertura = `${workspaceName} compartilhou um evento com você.`;
        preheader = abertura;
      }
      if (ativas.length > 0) secoes.push(cartaoEvento(ativas, brandColor, organizador));
      aviso = "Para adicionar ao seu calendário, abra o arquivo anexo.";
      break;
    }
    case "alteracao": {
      h1 = "Evento atualizado";
      abertura = `${workspaceName} atualizou um evento.`;
      preheader = abertura;
      if (ativas.length > 0) secoes.push(cartaoEvento(ativas, brandColor, organizador));
      if (canceladas.length > 0) secoes.push(listaCanceladas(canceladas, "Datas canceladas"));
      aviso = AVISO_ALTERACAO;
      break;
    }
    case "cancelamento": {
      h1 = "Evento cancelado";
      abertura = `${workspaceName} cancelou um evento.`;
      preheader = abertura;
      secoes.push(listaCanceladas(canceladas, canceladas.length === 1 ? "Data cancelada" : "Datas canceladas"));
      aviso = AVISO_CANCELAMENTO;
      break;
    }
    case "remarcacao_aceita": {
      h1 = "Remarcação aceita";
      abertura = `${workspaceName} aceitou seu pedido de remarcação.${ativas.length > 0 ? " O novo horário é:" : ""}`;
      preheader = `${workspaceName} aceitou seu pedido de remarcação.`;
      if (ativas.length > 0) secoes.push(cartaoEvento(ativas, brandColor, organizador));
      if (respostaEquipe) secoes.push(quote("Mensagem da equipe", respostaEquipe));
      if (ativas.length > 0) aviso = AVISO_ALTERACAO;
      break;
    }
    case "remarcacao_recusada": {
      h1 = "Remarcação não aceita";
      preheader = `${workspaceName} não pôde aceitar o horário que você sugeriu.`;
      const sugerido = remarcacao?.inicio_sugerido
        ? ` (${formatarInicioSugerido(remarcacao.inicio_sugerido, principal?.dia_inteiro ?? false, principal?.tz ?? TZ_PADRAO)})`
        : "";
      abertura = `${workspaceName} não pôde aceitar o horário que você sugeriu${sugerido}.`;
      if (respostaEquipe) secoes.push(quote("Mensagem da equipe", respostaEquipe));
      if (ativas.length > 0) {
        secoes.push(paragraph("O horário que continua valendo:", "body", "0 0 10px") + cartaoEvento(ativas, brandColor, organizador));
      }
      break;
    }
  }
```

Keep the attachment block (`anexar`, `attachments`) and the button-destination block (`confirmar`, `destino`, `rotuloBotao`) **byte-for-byte as they are**. Then replace the `botao`, `avisoHtml` and `html` construction with:

```ts
  const fecho = [
    aviso ? paragraph(aviso, "small", "0 0 16px") : "",
    button(destino, rotuloBotao, { brandColor }),
  ].join("");

  const html = brandedEmail({
    preheader,
    workspaceName,
    brandColor,
    logoUrl: item.logo_url ?? null,
    sections: [heading(h1) + paragraph(`${saudacao} ${abertura}`, "body", "0"), ...secoes, fecho].filter((s) => s !== ""),
    footerHtml: [
      `Enviado por ${escapeHtml(workspaceName)} via Mesaas`,
      link(ctx.unsubUrl, "Não quero mais receber esses avisos", "#4b5563"),
    ],
  });

  return { subject, html, attachments };
```

Note: the old guest convite copy had the organizer phrase inside the greeting paragraph; it still does (`${saudacao} ${abertura}`), and `Organizado por` is now also on the card when an organizer exists. For a guest the card line duplicates the opening; that is acceptable and matches the approved mockup. The guest e-mail must still not contain "portal": the footer and the guest button label (`Responder ao convite`) don't.

- [ ] **Step 6: Run the file, expect PASS.** Existing assertions that must still hold without edits: `<li` count 10 for the 12-date series (:250), no `"portal"` in the guest e-mail (:504), subjects, attachments, button destinations. Assertions that pinned old colours (`#f8f9fa`, `#111827`) are updated to the new markup.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/agenda-cliente-email.ts supabase/functions/__tests__/agenda-cliente-email_test.ts
git commit -m "feat(email): evento compartilhado no shell da agência, com bloco de data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Client pending-items digest

**Depends on:** Task 9 (`mesDiaAgenda`).

**Files:**
- Modify: `supabase/functions/_shared/client-event-email.ts`
- Test: `supabase/functions/__tests__/client-event-email_test.ts`, `supabase/functions/__tests__/client-event-email-cron_test.ts`

**Interfaces:**
- Consumes: `brandedEmail`; `heading`, `paragraph`, `postList`, `eventCard`, `callout`, `button`, `link`, `sectionTitle` from blocks; `mesDiaAgenda`, `formatarQuandoAgenda` from `./agenda-cliente-email.ts` (existing import direction).
- Produces: unchanged exports. `POST_TYPE_ICONS` and `postTypeIcon` deleted.

- [ ] **Step 1: Update tests first.** In `__tests__/client-event-email_test.ts`:
  - :134-145 (emoji per tipo, fallback 🖼) → assert the format labels instead:

```ts
  assert(html.includes(">Feed<") || html.includes("Feed</span>"), "expected the feed label");
  assert(html.includes("Reels"), "expected the reels label");
```
    and for the unknown-tipo test: `assert(html.includes("Post</span>"), "unknown tipo falls back to Post");`
  - :154 `#f8f9fa` → assert the unread copy itself, e.g. `assert(html.includes("<strong>3 mensagens não lidas</strong>"))` using the count that test's fixture passes (a `bgcolor="#f5f6f8"` check would be vacuous: the page background matches it);
  - :194-195 → `assert(escura.includes(\`bgcolor="#1a3d2b"\`) && escura.includes("color: #ffffff;"), "white CTA text on a dark brandColor");`
  - :197-198 → `assert(palida.includes(\`bgcolor="#fef3c7"\`) && palida.includes("color: #171717;"), "dark CTA text on a pale brandColor");`
  - :262-265 (16px radius) → `border-radius: 12px`;
  - :268-271 (cream footer) → assert the footer text `Enviado por` and the unsubscribe text, and `!html.includes("#f5f3ee")`.
  In `__tests__/client-event-email-cron_test.ts` :319-320 replace the 🖼/🎬 asserts with `assert(sent[0].html.includes("Feed"))` and `assert(sent[0].html.includes("Reels"))`.
  Append to `client-event-email_test.ts`:

```ts
Deno.test("pendências: event tiles in brand colour, light brand flips text, no emoji, invalid colour defaulted", () => {
  const ev = { ocorrencia_id: 7, inicio: "2026-10-15T13:00:00Z", fim: "2026-10-15T14:00:00Z", dia_inteiro: false, data_inicio_local: null, tz: "America/Sao_Paulo", titulo: "Sessão" };
  const html = buildClientEventEmail({ ...BASE_PARAMS, brandColor: "#facc15", hubUrl: "https://x.test/hub/tok", pendingEvents: [ev] });
  assert(html.includes(">OUT<") && html.includes(">15<"));
  assert(html.includes("color: #171717;"));
  assert(html.includes(`href="https://x.test/hub/tok/agenda?ocorrencia=7"`));
  assert(!/[🖼🗂🎬📱📅💬]/u.test(html));
  const bad = buildClientEventEmail({ ...BASE_PARAMS, brandColor: "red;x", hubUrl: "https://x.test/hub/tok" });
  assert(!bad.includes("red;x") && bad.includes("#eab308"));
});
```

- [ ] **Step 2: Run both files, expect FAIL.**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/client-event-email_test.ts supabase/functions/__tests__/client-event-email-cron_test.ts`

- [ ] **Step 3: Implement.** In `client-event-email.ts`: delete `POST_TYPE_ICONS`, `postTypeIcon`, `buildPostRow`, `buildEventRow`; change the imports to:

```ts
import { escapeHtml } from "./report-template/escape.ts";
import { sanitizeSubjectValue } from "./lifecycle-emails.ts";
import { formatarQuandoAgenda, mesDiaAgenda } from "./agenda-cliente-email.ts";
import { brandedEmail } from "./email/shell.ts";
import { button, callout, eventCard, heading, link, paragraph, postList, sectionTitle } from "./email/blocks.ts";
import { corSegura } from "./email/safe.ts";
```

Replace `buildClientEventEmail` with:

```ts
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
          return `<div style="margin: ${i === 0 ? "8px" : "10px"} 0 0;">${
            eventCard({
              mes, dia, tileColor: brandColor, titulo: ev.titulo,
              titleHref: hubBase ? `${hubBase}/agenda?ocorrencia=${ev.ocorrencia_id}` : null,
              lines: [formatarQuandoAgenda(ev)],
            })
          }</div>`;
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
```

Keep `buildPendingTitle`, `buildPendingPreheaderText`, `clientEventSubject`, `RENDERED_POSTS_CAP`, `CLIENT_EVENT_REMINDERS_HEADING` and all unsubscribe-token code unchanged. Do not import `paragraphHtml` here (unused).

- [ ] **Step 4: Run both files + `client-email-unsub_test.ts`, expect PASS.**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/client-event-email_test.ts supabase/functions/__tests__/client-event-email-cron_test.ts supabase/functions/__tests__/client-email-unsub_test.ts`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/client-event-email.ts supabase/functions/__tests__/client-event-email_test.ts supabase/functions/__tests__/client-event-email-cron_test.ts
git commit -m "feat(email): pendências do cliente com selos de formato e bloco de data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Monthly report e-mail

**Files:**
- Modify: `supabase/functions/_shared/report-template/email.ts`
- Test: `supabase/functions/__tests__/report-email_test.ts`

**Interfaces:**
- Consumes: `brandedEmail`; `heading`, `paragraphHtml`, `button`, `link`, `quote` from `../email/blocks.ts`; `EMAIL` from `../email/tokens.ts`; `corSegura` from `../email/safe.ts`.
- Produces: unchanged exports (`buildReportEmail`, `buildReportFrom`, `REPORT_FROM_ADDRESS`).

- [ ] **Step 1: Update tests first.** In `__tests__/report-email_test.ts`:
  - :13-15 → replace with `assertStringIncludes(h, "border-radius: 12px");`, `assert(!h.includes("#f5f3ee"));`, `assert(!h.includes("gestão inteligente"));`
  - :32-34, :45 → `#16a34a` becomes `#15803d` (positive delta now meets AA);
  - :43 → `'color: #6b7280;">0%</p>'` stays valid only if the markup below keeps that exact substring; it does;
  - :55 `"Relatório mensal"` stays;
  - :49 (`background: #… ; color: #171717` substring on the CTA) → `bgcolor="#…"` plus `color: #171717;` as two separate `includes`, keeping that test's colour;
  - :56 `#f8f9fa` → `assert(h.includes("Destaque do mês"))` (a border check would be vacuous: the card border matches it).
  Append:

```ts
Deno.test("report: 0..3 KPI tiles, CTA in sentence case, no unsubscribe link, color-scheme", () => {
  const base = { clientName: "Ana Lima", month: "2026-09", workspaceName: "Agência L", brandColor: "#7c3aed", logoUrl: null, aiSummary: null, pdfUrl: "https://x.test/r.pdf", hubUrl: "https://x.test/hub" };
  const none = buildReportEmail({ ...base, emailKpis: null });
  assert(!none.includes("Visualizações"), "no KPI row without kpis");
  const one = buildReportEmail({ ...base, emailKpis: { views: { value: 48200 } } });
  assert(one.includes("48,2 mil") && !one.includes("Interações"));
  const h = buildReportEmail({ ...base, emailKpis: { views: { value: 1, pct_change: 5 }, interactions: { value: 2 }, followers_gained: { value: 3 } } });
  assert(h.includes("Ver relatório completo") && !h.includes("Ver Relatório Completo"));
  assert(h.includes("Baixar em PDF") && !h.includes("Não quero mais receber"));
  assert(h.includes(`<meta name="color-scheme" content="light">`));
});
```

- [ ] **Step 2: Run, expect FAIL.**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/report-email_test.ts`

- [ ] **Step 3: Implement.** In `report-template/email.ts`: imports become

```ts
import { escapeHtml } from "./escape.ts";
import { sanitizeFromName } from "../email-headers.ts";
import { formatCompactPtBr, type EmailKpis } from "./brand-header.ts";
import { brandedEmail } from "../email/shell.ts";
import { button, heading, link, paragraphHtml, quote } from "../email/blocks.ts";
import { EMAIL } from "../email/tokens.ts";
import { corSegura } from "../email/safe.ts";
```

In `formatPctDelta` change `"#16a34a"` to `EMAIL.positive` and both `"#6b7280"` to `EMAIL.deltaNeutral` (same value). Replace `buildKpiRow` and `buildReportPreheader` + `buildReportEmail`:

```ts
/** Up to 3 bordered tiles; a missing metric drops alone; no kpis drops the row. */
function buildKpiRow(kpis: EmailKpis | null | undefined): string {
  if (!kpis) return "";
  const cells = KPI_TILES
    .map(({ key, label }) => {
      const entry = kpis[key];
      if (!entry || typeof entry.value !== "number") return "";
      return `<td class="m-kpi" width="33%" align="center" valign="top" style="padding: 14px 6px; border: 1px solid ${EMAIL.border}; border-radius: 10px;">
        <p style="margin: 0; font-size: 20px; line-height: 26px; font-weight: 700; color: ${EMAIL.ink};">${escapeHtml(formatCompactPtBr(entry.value))}</p>
        <p style="margin: 2px 0 0; font-size: 12px; line-height: 18px; color: ${EMAIL.muted};">${escapeHtml(label)}</p>
        ${kpiDeltaLine(entry.pct_change)}
      </td>`;
    })
    .filter(Boolean);
  if (cells.length === 0) return "";
  const withGaps = cells.map((c, i) => (i === cells.length - 1 ? c : `${c}<td class="m-kpi-gap" width="12"></td>`)).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: separate;"><tr>${withGaps}</tr></table>`;
}

function buildReportPreheaderText(monthLabel: string, kpis: EmailKpis | null | undefined): string {
  const pctChange = kpis?.views?.pct_change;
  if (typeof pctChange === "number") {
    return `Visualizações ${formatPctDelta(pctChange).text} em ${monthLabel}. Veja o relatório completo.`;
  }
  return `Seu relatório de ${monthLabel} está pronto.`;
}

export function buildReportEmail(params: ReportEmailParams & { emailKpis?: EmailKpis | null }): string {
  const { clientName, month, workspaceName, logoUrl, aiSummary, pdfUrl, hubUrl, emailKpis } = params;
  const brandColor = corSegura(params.brandColor);
  const monthLabel = formatMonthLabel(month);
  const firstName = clientName.split(" ")[0];

  const sections: string[] = [
    `<p style="margin: 0 0 6px; font-size: 13px; line-height: 18px; font-weight: 600; color: ${EMAIL.muted};">Relatório mensal · ${escapeHtml(monthLabel)}</p>` +
      heading(`Olá, ${firstName}!`),
  ];
  const kpiRow = buildKpiRow(emailKpis);
  if (kpiRow) sections.push(kpiRow);
  if (typeof aiSummary === "string" && aiSummary) sections.push(quote("Destaque do mês", aiSummary.substring(0, 300)));
  const cta = button(hubUrl, "Ver relatório completo", { brandColor });
  const pdf = pdfUrl ? paragraphHtml(link(pdfUrl, "Baixar em PDF", EMAIL.muted), "small", cta ? "12px 0 0" : "0") : "";
  if (cta || pdf) sections.push(cta + pdf);

  return brandedEmail({
    preheader: buildReportPreheaderText(monthLabel, emailKpis),
    workspaceName,
    brandColor,
    logoUrl,
    sections,
    footerHtml: [`Enviado por ${escapeHtml(workspaceName)} via Mesaas`],
  });
}
```

Delete the old `buildPreheader`/`buildBrandHeaderBand`/`pickHeaderTextColor` imports (now unused here). Keep `formatMonthLabel`, `KPI_TILES`, `formatPctDelta`, `kpiDeltaLine` (kpiDeltaLine keeps emitting `color: ${color};">${text}</p>`, which the `0%` test pins).

- [ ] **Step 4: Run the report tests + `email-kpis_test.ts`, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/report-template/email.ts supabase/functions/__tests__/report-email_test.ts
git commit -m "feat(email): relatório mensal no shell da agência

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Fixture matrix, visual check, full gates

**Files:**
- Create: `supabase/functions/__tests__/email-matrix_test.ts`
- Scratch (not committed): `<scratchpad>/render-matrix.ts`, `<scratchpad>/shot.cjs`

**Interfaces:**
- Consumes: every builder.

- [ ] **Step 1: Write the matrix test** (spec §7). It imports every builder, builds each fixture from the spec table, and checks the cross-builder invariants:

```ts
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildThankYouEmail, buildWelcomeEmail } from "../_shared/lifecycle-emails.ts";
import { buildDigestHtml } from "../_shared/notification-email.ts";
import { buildDunningEmail } from "../_shared/dunning-email.ts";
import { buildInviteEmail } from "../_shared/invite-email.ts";
import { buildLembreteEmail } from "../_shared/agenda-email.ts";
import { buildConnectedNoticeEmail, buildConnectLinkEmail } from "../_shared/instagram-connect-email.ts";
import { buildAffiliateLinkEmail } from "../affiliate-public/email.ts";
import { buildClientEventEmail } from "../_shared/client-event-email.ts";
import { montarEmailAgendaCliente } from "../_shared/agenda-cliente-email.ts";
import { buildReportEmail } from "../_shared/report-template/email.ts";

const APP = "https://app.test";
const HUB = "https://app.test/lume/hub/tok";
const tz = "America/Sao_Paulo";
const oc = (id: number, iso: string, extra: Record<string, unknown> = {}) => ({
  ocorrencia_id: id, estado: "ativa", sequencia: id, inicio: iso,
  fim: new Date(new Date(iso).getTime() + 3600_000).toISOString(), dia_inteiro: false,
  data_inicio_local: null, data_fim_local: null, tz, titulo: "Sessão de fotos",
  descricao: "Traga 2 trocas de roupa.", local: "Av. Paulista, 900", link_reuniao: null, ...extra,
});
const ag = (over: Record<string, unknown>) => ({
  id: 1, versao: 1, tipo: "convite", conta_id: "c", cliente_id: 1, ocorrencias: [oc(1, "2026-10-15T13:00:00Z")],
  remarcacao: null, cliente_email: "m@x.test", cliente_nome: "Clínica Sorriso", workspace_nome: "Agência Lume",
  brand_color: "#7c3aed", logo_url: null, destinatario: "cliente", organizador_nome: "Ana Souza", ...over,
  // deno-lint-ignore no-explicit-any
}) as any;
const actx = { hubUrl: HUB, unsubUrl: `${APP}/unsub/x`, agora: new Date("2026-10-10T12:00:00Z") };
const serie = Array.from({ length: 12 }, (_, i) => oc(i + 1, new Date(Date.UTC(2026, 9, 15 + i, 13)).toISOString()));
const cancelada = { ...oc(9, "2026-10-20T13:00:00Z"), estado: "cancelada" };
const ev = { ocorrencia_id: 7, inicio: "2026-10-15T13:00:00Z", fim: "2026-10-15T14:00:00Z", dia_inteiro: false, data_inicio_local: null, tz, titulo: "Sessão" };
const ce = { clienteNome: "Mariana Costa", workspaceName: "Agência Lume", brandColor: "#7c3aed", logoUrl: null, pendingPosts: [{ titulo: "Carrossel", tipo: "carrossel" }], unreadMessages: 2, hubUrl: HUB, unsubUrl: `${APP}/unsub/x`, pendingEvents: [ev] };
const rep = { clientName: "Ana Lima", month: "2026-09", workspaceName: "Agência Lume", brandColor: "#7c3aed", logoUrl: null, aiSummary: "Mês forte.", pdfUrl: `${APP}/r.pdf`, hubUrl: HUB };

const FIXTURES: Record<string, string> = {
  "welcome com nome": buildWelcomeEmail({ firstName: "Ana", appBaseUrl: APP }),
  "welcome sem nome": buildWelcomeEmail({ firstName: null, appBaseUrl: APP }),
  "thank you": buildThankYouEmail({ firstName: "Ana", workspaceName: "Agência Lume", appBaseUrl: APP }),
  "digest 1": buildDigestHtml([{ priority: 1, heading: "Falha ao publicar", link: "/a", badge: { tone: "danger", label: "Falha na publicação" } }], APP),
  "digest 3": buildDigestHtml([
    { priority: 1, heading: "A", link: "/a", badge: { tone: "danger", label: "Falha na publicação" } },
    { priority: 2, heading: "B", body: "Pode trocar a capa?", link: "/b", badge: { tone: "warning", label: "Correção" } },
    { priority: 4, heading: "C", link: "/c" },
  ], APP),
  "dunning first": buildDunningEmail({ stage: "first", workspaceName: "Agência Lume", nextAttemptLabel: "14 de outubro", billingUrl: `${APP}/c` }),
  "dunning retry": buildDunningEmail({ stage: "retry", workspaceName: "Agência Lume", nextAttemptLabel: null, billingUrl: `${APP}/c` }),
  "dunning final": buildDunningEmail({ stage: "final", workspaceName: "Agência Lume", nextAttemptLabel: null, billingUrl: `${APP}/c` }),
  "invite": buildInviteEmail({ actionLink: `${APP}/verify?t=1`, workspaceName: "Agência Lume" }),
  "lembrete hora": buildLembreteEmail({ titulo: "Pauta", inicio: "2026-10-12T17:00:00Z", fim: "2026-10-12T18:00:00Z", diaInteiro: false, local: "Rua Augusta", linkReuniao: "https://meet.test/x", tz, minutos: 60, abrirUrl: `${APP}/agenda`, appBaseUrl: APP }).html,
  "lembrete dia inteiro": buildLembreteEmail({ titulo: "Feriado", inicio: "2026-11-02T03:00:00Z", fim: "2026-11-03T03:00:00Z", diaInteiro: true, local: null, linkReuniao: null, tz, minutos: 1440, abrirUrl: `${APP}/agenda`, appBaseUrl: APP }).html,
  "ig connect": buildConnectLinkEmail({ agencyName: "Agência Lume", clienteName: "Clínica Sorriso", connectUrl: `${APP}/c/abc`, appBaseUrl: APP }),
  "ig connected": buildConnectedNoticeEmail({ clienteName: "Clínica Sorriso", igUsername: "clinica", clienteUrl: `${APP}/clientes/1`, appBaseUrl: APP }),
  "affiliate": buildAffiliateLinkEmail({ nome: "Ana Souza", link: `${APP}/afiliados/painel` }),
  "pendencias tudo": buildClientEventEmail(ce),
  "pendencias so eventos": buildClientEventEmail({ ...ce, pendingPosts: [], unreadMessages: 0 }),
  "pendencias sem hub (defensivo)": buildClientEventEmail({ ...ce, hubUrl: "" }),
  "agenda convite": montarEmailAgendaCliente(ag({}), actx).html,
  "agenda serie 12": montarEmailAgendaCliente(ag({ ocorrencias: serie }), actx).html,
  "agenda alteracao": montarEmailAgendaCliente(ag({ tipo: "alteracao", ocorrencias: [oc(1, "2026-10-15T13:00:00Z"), cancelada] }), actx).html,
  "agenda cancelamento": montarEmailAgendaCliente(ag({ tipo: "cancelamento", ocorrencias: [{ ...oc(1, "2026-10-15T13:00:00Z"), estado: "cancelada" }] }), actx).html,
  "agenda remarcacao aceita": montarEmailAgendaCliente(ag({ tipo: "remarcacao_aceita", remarcacao: { remarcacao_id: 1, inicio_sugerido: null, fim_sugerido: null, mensagem: null, resposta_equipe: "Combinado!" } }), actx).html,
  "agenda remarcacao recusada": montarEmailAgendaCliente(ag({ tipo: "remarcacao_recusada", remarcacao: { remarcacao_id: 1, inicio_sugerido: "2026-10-16T13:00:00Z", fim_sugerido: null, mensagem: null, resposta_equipe: null } }), actx).html,
  "agenda convidado": montarEmailAgendaCliente(ag({ destinatario: "convidado", cliente_id: null, nome: "Bia", email: "b@x.test", convidado_id: 3, convidado_token: "tok" }), { ...actx, botaoUrl: `${APP}/convite/tok` }).html,
  "agenda convidado cancelamento": montarEmailAgendaCliente(ag({ tipo: "cancelamento", destinatario: "convidado", cliente_id: null, nome: "Bia", ocorrencias: [{ ...oc(1, "2026-10-15T13:00:00Z"), estado: "cancelada" }] }), { ...actx, botaoUrl: `${APP}/convite/tok` }).html,
  "agenda dia inteiro": montarEmailAgendaCliente(ag({ ocorrencias: [oc(1, "2026-11-02T04:00:00Z", { dia_inteiro: true, data_inicio_local: "2026-11-02", data_fim_local: "2026-11-03", tz: "America/Manaus" })] }), actx).html,
  "report 3 kpis": buildReportEmail({ ...rep, emailKpis: { views: { value: 48200, pct_change: 18 }, interactions: { value: 1200 }, followers_gained: { value: 87 } } }),
  "report 1 kpi": buildReportEmail({ ...rep, emailKpis: { views: { value: 48200 } } }),
  "report sem kpis": buildReportEmail({ ...rep, emailKpis: null }),
  "report sem hub": buildReportEmail({ ...rep, hubUrl: "", emailKpis: null }),
};

export { FIXTURES };

const OLD_ICONS = /[🖼🗂🎬📱📅💬👥📋✅📈📚]/u;

for (const [name, html] of Object.entries(FIXTURES)) {
  Deno.test(`matrix: ${name}`, () => {
    assert(html.includes(`<meta name="color-scheme" content="light">`), "color-scheme");
    const pre = html.match(/<div style="display:none;[^>]*>([^&<]*)/);
    assert(pre && pre[1].trim().length > 0, "preheader");
    assert(html.includes(`width="560"`), "card width");
    assert(!html.includes("—"), "em-dash in authored copy");
    assert(!OLD_ICONS.test(html), "old emoji icon");
    assert(!html.includes("#1a3d2b") && !html.includes("#f5f3ee"), "old palette");
    assert(!html.includes("gestão inteligente"), "old tagline");
    assert(!/display:\s*(flex|grid)/.test(html), "flex/grid");
  });
}
```

(If a fixture's shape does not match the real type, read the builder's type and fix the fixture, not the builder. The `export { FIXTURES }` lets the scratch render script reuse them.)

- [ ] **Step 2: Run it, expect PASS.**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/email-matrix_test.ts`

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/__tests__/email-matrix_test.ts
git commit -m "test(email): matriz de fixtures do redesign

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Visual check (scratch only).** Write `<scratchpad>/render-matrix.ts`:

```ts
const { FIXTURES } = await import("/Users/eduardosouza/projects/sm-crm/.claude/worktrees/email-redesign-d46744/supabase/functions/__tests__/email-matrix_test.ts");
const out = Deno.args[0];
await Deno.mkdir(out, { recursive: true });
const logo = "/Users/eduardosouza/projects/sm-crm/.claude/worktrees/email-redesign-d46744/public/logo-black-email.png";
for (const [k, v] of Object.entries(FIXTURES as Record<string, string>)) {
  const file = k.replace(/[^a-z0-9]+/gi, "-");
  await Deno.writeTextFile(`${out}/${file}.html`, v.replaceAll("https://www.mesaas.com.br/logo-black-email.png", `file://${logo}`));
}
```

Run: `deno run --no-check --allow-read --allow-write --allow-env --allow-net <scratchpad>/render-matrix.ts <scratchpad>/after` (Deno.test calls register but do not run under `deno run`). Then screenshot each `.html` at 640 and 375 wide with the repo's `playwright-core` + system Chrome (`executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`), `fullPage: true`. Open the PNGs and compare against the mockups: brand band on whitelabel, ink buttons, date tiles, no horizontal scroll at 375 (check `document.documentElement.scrollWidth <= 375` in the page). Also check that the branded card's top corners stay rounded at 640px (the brand band `<td>` can paint square corners over the 12px radius; if it does, give the band row `border-radius: 11px 11px 0 0` via the shell, not by editing `buildBrandHeaderBand`). Fix any defect in the owning task's file and re-run that task's tests.

- [ ] **Step 5: Reset `node_modules` after Deno runs, then the full gates** (CLAUDE.md "Before pushing"):

```bash
npm ci
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run check:functions
npm run test:functions
git status --short
```

Expected: every command exits 0; `git status` shows no `deno.lock` change (if `test:functions` dirtied it, `git checkout deno.lock`).

- [ ] **Step 6: Confirm the deploy list with `deno info`** and paste the result into the PR description:

```bash
for f in supabase/functions/*/index.ts; do
  deno info --node-modules-dir=auto "$f" 2>/dev/null | grep -qE "_shared/email/|lifecycle-emails|notification-email|dunning-email|invite-email|agenda-email|instagram-connect-email|client-event-email|agenda-cliente-email|report-template/email|affiliate-public/email" && echo "$(dirname "$f" | xargs basename)"
done | sort -u
```

Expected: the 16 functions of spec §8 step 3 (plus any extra the graph shows; add those to the list, don't drop any).

---

## Deploy runbook (owner-gated, after merge; not a task)

1. Merge the PR (Vercel publishes `public/logo-black-email.png`).
2. `curl -sI https://www.mesaas.com.br/logo-black-email.png` → `HTTP/2 200` and `content-type: image/png`. Stop if not.
3. Staging, then prod, for each function from Task 12 Step 6:
   `npx supabase functions deploy <name> --no-verify-jwt --use-api --project-ref <ref>` (staging `wlyzhyfondykzpsiqsce`, prod `skjzpekeqefvlojenfsw`).
4. Rollback: redeploy the same functions from the pre-merge commit in a disposable worktree.
