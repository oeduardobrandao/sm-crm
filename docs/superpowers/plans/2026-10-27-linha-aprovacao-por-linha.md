# Linha editorial: per-row approval — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Hub client approves or asks for an ajuste on each row of a linha, then finishes with one decision; the CRM shows each row's state and the approval progress.

**Architecture:** Row state lives on `linha_editorial_itens.aprovacao` (null = pending), written only by service-role RPCs called from `hub-linha-editorial`. The finish keeps using `record_linha_decision`, which now approves pending rows or refuses while a row has an ajuste. The CRM reads the columns through the existing table-level SELECT.

**Tech Stack:** Postgres/Supabase (plpgsql, psql entitlement suites), Deno edge function, React 19 + TanStack Query (CRM, Hub), Vitest, react-i18next (Hub).

**Spec:** `docs/superpowers/specs/2026-10-26-linha-editorial-design.md` §13 (the rest of the spec is v1, already built).

## Global Constraints

- No em dashes in user-facing copy. pt-BR copy in the CRM; Hub copy through `hubLinha` i18n (pt and en).
- `aprovacao` / `aprovacao_at` are never in an `authenticated` INSERT/UPDATE grant.
- Formatters run only on touched files (`npx prettier --write <files>`), never repo-wide.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Lanes touch disjoint files; never `git add -A`.

## Review Focus

1. A finish racing a row decision: `record_linha_decision` holds the linha `FOR UPDATE`; a row decision takes `FOR SHARE` first, so one waits for the other and the later one sees the committed status (`status_invalido` after the finish).
2. "Aprovar linha editorial" with pending rows approves them; with a row in ajuste the Hub must never offer it, and the server refuses with 409.
3. Re-send: ajustes rows reset to pending, approved stay, a row added after approval is pending.
4. A rascunho never sent (`rodada = 0`) shows no chips and no progress in the CRM.
5. An ajuste comment is a plain client `comentario` on the row, so it counts in the Hub bar, the CRM comment count, the CRM thread and the notification metadata, and survives the row's deletion as an ordinary comment.

---

### Task 1: Migration + entitlement suite (lane A)

**Files:**
- Create: `supabase/migrations/20261031000005_linha_item_aprovacao.sql` (already drafted; review it against §13.3)
- Modify: `supabase/tests/entitlements/99_linha_editorial_hub.sql`, `99_linha_editorial_rpcs.sql`, `99_linha_editorial_schema.sql`

**Interfaces — Produces:**
- `record_linha_item_decision(p_linha_id uuid, p_item_id uuid, p_conta_id uuid, p_cliente_id bigint, p_token text, p_acao text, p_comentario text) → jsonb {aprovados, ajustes, pendentes}`; raises `nao_encontrada`, `status_invalido`, `comentario_obrigatorio`, `acao_invalida`, `feature_disabled:feature_linha_editorial`.
- `record_linha_decision(...)` raises `itens_com_ajustes` on `aprovado` while a row has `aprovacao = 'ajustes'`.
- Notification metadata key `itens_ajustes` (int).

- [ ] Add suite cases listed in spec §13.8 (entitlement bullet), in the files' existing style.
- [ ] Run locally: `bash scripts/test-entitlements.sh` (needs the local stack; see memory reference_local_supabase_colima). Expected: all pass.
- [ ] Commit.

### Task 2: Edge function (lane B)

**Files:**
- Modify: `supabase/functions/hub-linha-editorial/handler.ts`
- Test: `supabase/functions/__tests__/hub-linha-editorial_test.ts`

**Interfaces — Consumes:** Task 1's RPC names and error codes. **Produces:** POST `{token, linha_id, acao: 'aprovado'|'ajustes'|'pendente', item_id, comentario?}` → `{ok: true, aprovados, ajustes, pendentes}`; GET items gain `aprovacao: 'aprovado' | 'ajustes' | null`.

- [ ] Tests first: routing by `item_id` + `acao`; `pendente` without `item_id` → 400; `itens_com_ajustes` → 409; GET includes `aprovacao` (select list gains it); row decisions call neither `create_linha_notification` nor `auditLog`; write limit is 300/3600.
- [ ] Implement; `npm run check:functions` and `deno test --no-check supabase/functions/__tests__/hub-linha-editorial_test.ts` pass. Restore `deno.lock` if touched.
- [ ] Commit.

### Task 3: Hub UI (lane C)

**Files:**
- Modify: `apps/hub/src/types.ts` (`HubLinhaItem.aprovacao`, `HubLinhaAcao` gains `'pendente'`), `apps/hub/src/api.ts` (return type), `apps/hub/src/pages/aprovacoes/LinhaCard.tsx`, `packages/i18n/locales/{pt,en}/hubLinha.json`
- Test: create `apps/hub/src/pages/aprovacoes/__tests__/LinhaCard.test.tsx`

Behavior and copy: spec §13.5 and mockups https://claude.ai/artifact/WLkxfcX148bmTT1SWQCRG7 (artboards 1, 2). pt copy: "Aprovar", "Pedir ajuste", "Desfazer", "Aprovado", "Ajuste pedido", "O que precisa mudar?", "{a} de {total} aprovados", " · {n} com ajuste", "Enviar ajustes", "Os posts ainda sem resposta também serão aprovados.".

- [ ] Tests first (mock `submitLinhaAcao`): approve sends `{acao:'aprovado', item_id}`; Desfazer sends `pendente`; Pedir ajuste with an empty textarea does not submit when the row has no client comment, and submits without a comment when it has one; bar shows "Enviar ajustes" only (no Aprovar) when a row is in ajuste; bar progress copy; finished linha shows pills and no buttons; `isClientComment` counts an `ajustes` resposta with text.
- [ ] Implement; `npx vitest run apps/hub/src/pages/aprovacoes` and `npx tsc -p apps/hub/tsconfig.json --noEmit` pass.
- [ ] Commit.

### Task 4: CRM UI (lane D)

**Files:**
- Modify: `apps/crm/src/store/linhaEditorial.ts` (`LinhaItem.aprovacao?`, `aprovacao_at?` optional; `LinhaEditorial.itens_aprovados`; `listLinhasDoMes` embed `aprovados:linha_editorial_itens(count)` + `.eq('aprovados.aprovacao','aprovado')`), `LinhaClientRail.tsx` (`contagem()`), `LinhaEditorialView.tsx` (`resumo` progress), `LinhaTable.tsx` (chip in title cell), `LinhaPhoneView.tsx` (chip on cards), `apps/crm/src/lib/notification-config.ts` (ajustes body "{n} posts com ajuste"), `linha.css`
- Create: `apps/crm/src/pages/entregas/linha/LinhaAprovacaoChip.tsx`
- Test: existing files under `apps/crm/src/pages/entregas/linha/__tests__/`, `apps/crm/src/store/__tests__/linhaEditorial.test.ts`, the notification-config test

Behavior: spec §13.6 and mockups artboards 3, 4.

- [ ] Tests first: chip hidden at `rodada = 0`; "Ajuste pedido" chip click calls `onOpenComentarios(item.id)`; header progress omits zero parts; `contagem()` order (produção > aprovados when sent > posts); notification body with `itens_ajustes`.
- [ ] Implement; `npx vitest run apps/crm/src/pages/entregas/linha apps/crm/src/store/__tests__/linhaEditorial.test.ts` and `npx tsc -p apps/crm/tsconfig.json --noEmit` pass.
- [ ] Commit.

### Task 5: Integration (main session)

- [ ] Full gates: lint, format:check, 4×tsc, `npm run test` (alone), check:functions, test:functions, entitlement suites.
- [ ] Browser check on a local stack: approve rows, ajuste, finish both ways, re-send, CRM chips/progress.
- [ ] Update PR #748 body (migration 0005, function redeploy).
