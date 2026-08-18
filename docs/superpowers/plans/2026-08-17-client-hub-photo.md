# Client Photo in the Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the agency upload a manual client photo (overriding the existing Instagram-derived avatar) and show it, bigger, on the Hub homepage next to "Olá, {name}".

**Architecture:** A new nullable `clientes.foto_url` column, uploaded to the existing public `avatars` Supabase Storage bucket exactly the way `WorkspaceTab.tsx` uploads the workspace logo. `hub-bootstrap` resolves `cliente_foto_url` with `foto_url` taking precedence over the existing Instagram-avatar lookup. The CRM's client-detail header avatar becomes a click-to-upload control, gated to owner/admin both in the UI and in the database (new trigger), since `clientes_update` RLS is otherwise open to every workspace member.

**Tech Stack:** React 19 + TanStack Query (CRM, Hub), Supabase Postgres/Storage/RLS, Deno edge functions, Vitest + Testing Library, `deno test`, psql (`supabase/tests/entitlements`).

## Global Constraints

- Never log or return raw Postgres/Storage error details to the client — generic toasts only (CLAUDE.md security rule).
- `clientes.id` is `bigserial` (bigint), not an integer and not a uuid — any storage-path/RLS cast must be `::bigint`.
- Gate anything permission-bearing on `workspaceRole` from `AuthContext`, never the plain `role` field (`role` goes stale on workspace switch — see `AuthContext.tsx`'s own doc comment).
- Migration filenames must have a unique version-prefix timestamp; re-check `git ls-tree origin/main:supabase/migrations | tail` immediately before opening the PR, not just when writing this plan (this repo has hit duplicate-prefix collisions twice before).
- Column-level `GRANT SELECT` allowlists on `clientes` (base table) and the `clientes_v` view must both include any new column, or it's invisible to the CRM (CLAUDE.md gotcha).
- `updateCliente(id, partial)` is already generic — no new store function needed for the write path.
- Full spec: `docs/superpowers/specs/2026-08-17-client-hub-photo-design.md`.

---

## File Structure

New files:
- `supabase/migrations/20260817000001_cliente_foto_manual_upload.sql` — column, grants, view, storage RLS, trigger.
- `supabase/tests/entitlements/66_cliente_foto_owner_admin.sql` — psql regression test for the new trigger.
- `apps/crm/src/pages/cliente-detalhe/clienteFoto.ts` — pure, testable image-resize helper (mirrors `apps/crm/src/pages/configuracao/reportSplash.ts`).
- `apps/crm/src/pages/cliente-detalhe/__tests__/clienteFoto.test.ts`
- `apps/crm/src/pages/cliente-detalhe/ClienteAvatarUpload.tsx` — the interactive avatar (hover overlay, file input, remove confirmation).
- `apps/crm/src/pages/cliente-detalhe/__tests__/ClienteAvatarUpload.test.tsx`
- `apps/hub/src/components/__tests__/ClientAvatar.test.tsx` — no test existed for this component; added alongside the fallback-sizing fix.

Modified files:
- `apps/crm/src/store/clients.ts` — `Cliente.foto_url`, `CLIENTE_SAFE_COLUMNS`.
- `apps/crm/src/pages/cliente-detalhe/ClienteDetalheHeader.tsx` — renders `ClienteAvatarUpload` instead of a static avatar block.
- `apps/crm/src/pages/cliente-detalhe/__tests__/ClienteDetalheHeader.test.tsx`
- `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx` — passes `clienteId`, `imageUrl`, `canEditPhoto`.
- `apps/crm/src/pages/cliente-detalhe/__tests__/ClienteDetalhePage.test.tsx`
- `apps/crm/style.css` — `.cliente-avatar-upload*` rules, appended after the existing `.cliente-detalhe-header__*` block (~line 9520).
- `supabase/functions/hub-bootstrap/handler.ts` — select `foto_url`, apply precedence.
- `supabase/functions/__tests__/hub-bootstrap_test.ts`
- `apps/hub/src/components/ClientAvatar.tsx` — size-aware fallback font.
- `apps/hub/src/pages/HomePage.tsx` — 128px avatar block above the heading.
- `apps/hub/src/pages/__tests__/contentPages.test.tsx`

---

### Task 1: Migration — schema, grants, storage RLS, DB-level enforcement

**Files:**
- Create: `supabase/migrations/20260817000001_cliente_foto_manual_upload.sql`
- Create: `supabase/tests/entitlements/66_cliente_foto_owner_admin.sql`

**Interfaces:**
- Produces: `clientes.foto_url` (nullable `text`), readable through `clientes_v`; a `trg_cliente_foto_owner_admin` trigger on `clientes` that rejects any `foto_url` change from a non-owner/admin of that client's workspace; narrowed `avatars_service_write`/`avatars_service_update` storage policies (now `TO service_role`); new `cliente_photo_insert`/`cliente_photo_update` storage policies scoped to `clientes/{id}/*`.

- [ ] **Step 1: Confirm the migration prefix is still free**

Run: `git ls-tree origin/main:supabase/migrations | tail -5`
Expected: no file starting with `20260817000001`. If one now exists, bump the prefix and use that number consistently in the two files below.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/20260817000001_cliente_foto_manual_upload.sql

ALTER TABLE public.clientes ADD COLUMN foto_url text;

-- Column-level grant allowlist must be re-declared in full (REVOKE was
-- already applied in 20260728000002; this extends that same explicit list).
REVOKE SELECT ON public.clientes FROM authenticated;
GRANT SELECT (
  id, user_id, conta_id, nome, sigla, cor, plano, email, telefone, status,
  created_at, notion_page_url, data_pagamento, especialidade, data_aniversario,
  dia_entrega, auto_publish_on_approval, send_report_email, include_ai_analysis,
  foto_url
) ON public.clientes TO authenticated;

CREATE OR REPLACE VIEW public.clientes_v WITH (security_barrier = true) AS
  SELECT c.id, c.user_id, c.conta_id, c.nome, c.sigla, c.cor, c.plano,
         c.email, c.telefone, c.status, c.created_at, c.notion_page_url,
         c.data_pagamento, c.especialidade, c.data_aniversario, c.dia_entrega,
         c.auto_publish_on_approval, c.send_report_email, c.include_ai_analysis,
         c.foto_url,
         CASE WHEN public.can_see_financials()
              THEN c.valor_mensal ELSE NULL END AS valor_mensal
  FROM public.clientes c
  WHERE c.conta_id = public.get_my_conta_id();

-- Storage RLS: path pattern clientes/{cliente_id}/foto.*
-- clientes.id is bigserial (bigint) — NOT the uuid workspace_id is.
CREATE POLICY "cliente_photo_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = 'clientes'
    AND (storage.foldername(name))[2]::bigint IN (
      SELECT c.id FROM public.clientes c
      WHERE c.conta_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
      )
    )
  );

CREATE POLICY "cliente_photo_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = 'clientes'
    AND (storage.foldername(name))[2]::bigint IN (
      SELECT c.id FROM public.clientes c
      WHERE c.conta_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
      )
    )
  );

-- SECURITY-CRITICAL: avatars_service_write/_update (20260319_avatars_bucket.sql)
-- were created with no `TO` clause, defaulting to PUBLIC — today ANY
-- authenticated user can write to ANY path in the 'avatars' bucket, which
-- means the path-scoped policies above (and the pre-existing
-- workspace_logo_insert/_update ones) add no real restriction until this is
-- closed: RLS policies for the same command are OR'd together. Their own doc
-- comments already say the intent was service_role-only.
--
-- Verified safe: the only client-side writes into 'avatars' today
-- (WorkspaceTab's logo, RelatoriosTab's report-splash art, and this new
-- client photo) all live under workspaces/* or clientes/*, each with its own
-- dedicated scoped policy. service_role bypasses RLS entirely in Supabase,
-- so this is a no-op for edge-function writes.
DROP POLICY "avatars_service_write" ON storage.objects;
DROP POLICY "avatars_service_update" ON storage.objects;
CREATE POLICY "avatars_service_write"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'avatars');
CREATE POLICY "avatars_service_update"
  ON storage.objects FOR UPDATE
  TO service_role
  USING (bucket_id = 'avatars');

-- DB-level enforcement of "owner/admin only": clientes_update RLS permits
-- any workspace member to update a client row (20260315_rls_security_audit.sql),
-- so a UI-only role gate cannot stop an agent-role user from calling the API
-- directly and setting foto_url to an arbitrary string. SECURITY DEFINER +
-- SET search_path, matching get_my_conta_id()'s existing pattern, so this
-- check is deterministic regardless of the caller's own RLS visibility into
-- workspace_members.
CREATE OR REPLACE FUNCTION public.enforce_cliente_foto_owner_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.foto_url IS DISTINCT FROM OLD.foto_url THEN
    IF NOT EXISTS (
      SELECT 1 FROM workspace_members
      WHERE user_id = auth.uid()
        AND workspace_id = NEW.conta_id
        AND role IN ('owner', 'admin')
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cliente_foto_owner_admin
  BEFORE UPDATE ON public.clientes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_cliente_foto_owner_admin();
```

- [ ] **Step 3: Write the psql entitlement test**

Covers all three cases the design spec calls for: the trigger blocking an agent, the storage policy blocking a cross-tenant write, and the narrowed `avatars_service_write` still letting `service_role` through.

```sql
-- supabase/tests/entitlements/66_cliente_foto_owner_admin.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Regression test for 20260817000001_cliente_foto_manual_upload.sql's three
-- enforcement layers:
--   1. trg_cliente_foto_owner_admin — clientes_update RLS is open to any
--      workspace member, so without this trigger an agent-role user could
--      set foto_url to an arbitrary URL through a direct table update,
--      bypassing the CRM's UI-level workspaceRole gate entirely.
--   2. cliente_photo_insert (storage RLS) — an owner/admin of workspace A
--      must not be able to write to workspace B's client photo path.
--   3. avatars_service_write narrowed to `service_role` — must not have
--      collaterally locked out the edge functions that rely on it (the
--      Instagram-avatar cache, the report-splash art, this feature itself).
--
-- IMPORTANT — impersonates `authenticated`/`service_role`, not just a JWT
-- claim: the table owner bypasses RLS, and a claims-only version would not
-- exercise the same write path an authenticated client actually uses.
--
-- The storage.objects inserts below only set bucket_id/name — every other
-- column in Supabase's standard storage schema is nullable or has a
-- default. If this project's storage.objects has been customized with an
-- additional NOT NULL column, widen these inserts accordingly when Step 4
-- surfaces the failure.

begin;
select et_grant_hosted_parity();

do $$
declare
  v_ws_a uuid; v_ws_b uuid;
  v_owner_a uuid := gen_random_uuid();
  v_owner_b uuid := gen_random_uuid();
  v_agent uuid := gen_random_uuid();
  v_cli_a bigint; v_cli_b bigint;
  v_rejected boolean;
  v_foto text;
begin
  v_ws_a := et_make_workspace('start');
  v_ws_b := et_make_workspace('start');

  insert into auth.users (id) values (v_owner_a), (v_owner_b), (v_agent);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_owner_a, v_ws_a, 'owner'), (v_owner_b, v_ws_b, 'owner'), (v_agent, v_ws_a, 'agent');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a where id in (v_owner_a, v_agent);
  update profiles set conta_id = v_ws_b, active_workspace_id = v_ws_b where id = v_owner_b;

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_owner_a, v_ws_a, 'Cliente A', 'CA', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_owner_b, v_ws_b, 'Cliente B', 'CB', '#000') returning id into v_cli_b;

  -- ---- Case 1: agent-role (member of A, not owner/admin) cannot set foto_url ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_rejected := false;
  begin
    update clientes set foto_url = 'https://evil.example/x.png' where id = v_cli_a;
  exception when others then
    v_rejected := true;
  end;
  assert v_rejected,
    'clientes.foto_url: agent-role update was NOT rejected by trg_cliente_foto_owner_admin';

  -- The trigger is scoped to foto_url only — an agent must still be able to
  -- update an unrelated column on the same row.
  update clientes set telefone = '(85) 90000-0000' where id = v_cli_a;

  execute 'reset role';

  select foto_url into v_foto from clientes where id = v_cli_a;
  assert v_foto is null, 'clientes.foto_url: the rejected update leaked through anyway';

  -- ---- Case 1b: owner of A, same column, must succeed ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  update clientes set foto_url = 'https://cdn.mesaas.com/avatars/clientes/1/foto.png'
   where id = v_cli_a;

  execute 'reset role';

  select foto_url into v_foto from clientes where id = v_cli_a;
  assert v_foto = 'https://cdn.mesaas.com/avatars/clientes/1/foto.png',
    'clientes.foto_url: owner-role update was rejected';

  -- ---- Case 2: owner of A cannot write to B's client photo path ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_rejected := false;
  begin
    insert into storage.objects (bucket_id, name) values ('avatars', 'clientes/' || v_cli_b || '/foto.png');
  exception when others then
    v_rejected := true;
  end;
  assert v_rejected,
    'storage.objects: owner of workspace A wrote to workspace B''s client photo path';

  -- Owner CAN write to their OWN client's path — proves the policy filters
  -- by ownership rather than denying everything, which would also satisfy
  -- the assertion above for the wrong reason.
  insert into storage.objects (bucket_id, name) values ('avatars', 'clientes/' || v_cli_a || '/foto.png');

  -- ---- Case 2b: the same user cannot write outside clientes/* or workspaces/* at all ----
  -- (proves avatars_service_write's narrowing to service_role actually took —
  -- without it, this bucket-only check would have passed even with the two
  -- new path-scoped policies correctly in place.)
  v_rejected := false;
  begin
    insert into storage.objects (bucket_id, name) values ('avatars', 'arbitrary-path/x.png');
  exception when others then
    v_rejected := true;
  end;
  assert v_rejected,
    'storage.objects: an authenticated user wrote outside clientes/* and workspaces/* — avatars_service_write is still too broad';

  execute 'reset role';

  -- ---- Case 3: service_role can still write anywhere in the bucket ----
  -- (the Instagram-avatar cache and the report-splash art both rely on this;
  -- the narrowing in this migration must not have collaterally broken them.)
  execute 'set local role service_role';
  insert into storage.objects (bucket_id, name) values ('avatars', 'clientes/999/ig-cache.jpg');
  execute 'reset role';

  raise notice 'PASS 66_cliente_foto_owner_admin';
end $$;
rollback;
```

- [ ] **Step 4: Run the entitlement suite**

Run: `bash scripts/test-entitlements.sh` (requires local Supabase via `colima start` + `supabase start` — see CLAUDE.md/memory on this repo's local Supabase setup). If Docker/colima isn't available in this environment, skip locally and rely on the `entitlement-tests` CI job — note that explicitly rather than silently skipping.
Expected: `PASS 66_cliente_foto_owner_admin` and no failures in `40_cliente_tables_tenant_isolation.sql` or `56_profiles_write_lockdown.sql` (both touch overlapping tables). If any `storage.objects` insert errors on an unexpected NOT NULL column instead of the intended RLS rejection, widen the insert's column list per the comment above the test.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260817000001_cliente_foto_manual_upload.sql supabase/tests/entitlements/66_cliente_foto_owner_admin.sql
git commit -m "feat(db): add clientes.foto_url with owner/admin-only write enforcement"
```

---

### Task 2: Store layer types

**Files:**
- Modify: `apps/crm/src/store/clients.ts:4-23` (the `Cliente` interface), `:58-59` (`CLIENTE_SAFE_COLUMNS`)

**Interfaces:**
- Produces: `Cliente.foto_url?: string | null`, consumed by Task 4 (`ClienteAvatarUpload`) and Task 5 (`ClienteDetalhePage`/`ClienteDetalheHeader`).

- [ ] **Step 1: Add the field to the interface**

In `apps/crm/src/store/clients.ts`, inside `export interface Cliente { ... }`, add after `include_ai_analysis?: boolean;`:

```ts
  foto_url?: string | null;
```

- [ ] **Step 2: Extend the allowlist constant**

Change:
```ts
const CLIENTE_SAFE_COLUMNS =
  'id, user_id, conta_id, nome, sigla, cor, plano, email, telefone, status, created_at, notion_page_url, data_pagamento, especialidade, data_aniversario, dia_entrega, auto_publish_on_approval, send_report_email, include_ai_analysis';
```
to:
```ts
const CLIENTE_SAFE_COLUMNS =
  'id, user_id, conta_id, nome, sigla, cor, plano, email, telefone, status, created_at, notion_page_url, data_pagamento, especialidade, data_aniversario, dia_entrega, auto_publish_on_approval, send_report_email, include_ai_analysis, foto_url';
```

Keep it a single string literal (no `+` concatenation) — the file's own comment explains why (supabase-js's `.select()` type inference breaks on a concatenated expression).

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/store/clients.ts
git commit -m "feat(store): add foto_url to the Cliente type and safe-columns allowlist"
```

---

### Task 3: `clienteFoto.ts` resize helper

**Files:**
- Create: `apps/crm/src/pages/cliente-detalhe/clienteFoto.ts`
- Create: `apps/crm/src/pages/cliente-detalhe/__tests__/clienteFoto.test.ts`

**Interfaces:**
- Produces: `resizeClientePhoto(file: File, maxSize?: number): Promise<Blob>` — a PNG blob, square, side `= min(width, height, maxSize)`. Consumed by Task 4.
- Mirrors `apps/crm/src/pages/configuracao/reportSplash.ts`'s `downscaleImage` (same test-mocking technique: `vi.stubGlobal('createImageBitmap', ...)` + `vi.spyOn(document, 'createElement')`), and matches `WorkspaceTab.handleLogoUpload`'s existing resize math exactly — this is **not** a center-crop; a non-square source is stretched to fit the square, and sources smaller than `maxSize` are not upscaled. That's an intentional, accepted parity choice with the workspace logo upload, not a new limitation.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/crm/src/pages/cliente-detalhe/__tests__/clienteFoto.test.ts
import { describe, expect, it, vi } from 'vitest';
import { resizeClientePhoto } from '../clienteFoto';

function fakeBitmap(w: number, h: number) {
  return { width: w, height: h, close: vi.fn() } as unknown as ImageBitmap;
}

function stubCanvas(toBlob: (cb: (b: Blob | null) => void) => void) {
  const ctx = { drawImage: vi.fn() };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toBlob: vi.fn(toBlob),
  } as unknown as HTMLCanvasElement;
  vi.spyOn(document, 'createElement').mockReturnValue(canvas as HTMLElement & HTMLCanvasElement);
  return { canvas, ctx };
}

describe('resizeClientePhoto', () => {
  it('caps the square side at 512 for a large image', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => fakeBitmap(2000, 2000)));
    const { canvas } = stubCanvas((cb) => cb(new Blob(['x'], { type: 'image/png' })));

    await resizeClientePhoto(new File(['x'], 'a.png', { type: 'image/png' }));

    expect(canvas.width).toBe(512);
    expect(canvas.height).toBe(512);
  });

  it('does not upscale a small image', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => fakeBitmap(200, 300)));
    const { canvas } = stubCanvas((cb) => cb(new Blob(['x'], { type: 'image/png' })));

    await resizeClientePhoto(new File(['x'], 'a.png', { type: 'image/png' }));

    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(200);
  });

  it('uses the shorter side for a non-square source (WorkspaceTab-parity, not a crop)', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => fakeBitmap(800, 400)));
    const { canvas, ctx } = stubCanvas((cb) => cb(new Blob(['x'], { type: 'image/png' })));

    await resizeClientePhoto(new File(['x'], 'a.png', { type: 'image/png' }));

    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(400);
    // Whole source drawn into the square — this stretches non-square images,
    // matching WorkspaceTab.handleLogoUpload exactly.
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 400, 400);
  });

  it('outputs image/png', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => fakeBitmap(300, 300)));
    const { canvas } = stubCanvas((cb) => cb(new Blob(['x'], { type: 'image/png' })));

    await resizeClientePhoto(new File(['x'], 'a.png', { type: 'image/png' }));

    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
  });

  it('releases the bitmap even when getContext fails', async () => {
    const bitmap = fakeBitmap(300, 300);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
    const canvas = { width: 0, height: 0, getContext: () => null } as unknown as HTMLCanvasElement;
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as HTMLElement & HTMLCanvasElement);

    await expect(
      resizeClientePhoto(new File(['x'], 'a.png', { type: 'image/png' })),
    ).rejects.toThrow('Falha ao processar a imagem');
    expect((bitmap as unknown as { close: () => void }).close).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/__tests__/clienteFoto.test.ts`
Expected: FAIL — `../clienteFoto` has no exported member `resizeClientePhoto` (module doesn't exist yet).

- [ ] **Step 3: Implement**

```ts
// apps/crm/src/pages/cliente-detalhe/clienteFoto.ts

/**
 * Client-side resize for a manually-uploaded client photo: a square, side
 * `min(width, height, maxSize)`, output as PNG. Mirrors
 * WorkspaceTab.handleLogoUpload's resize exactly for consistency — this
 * stretches non-square sources to fit the square rather than cropping, and
 * never upscales past the source's own shorter side.
 */
export async function resizeClientePhoto(file: File, maxSize = 512): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const size = Math.min(bitmap.width, bitmap.height, maxSize);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Falha ao processar a imagem');
    ctx.drawImage(bitmap, 0, 0, size, size);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Falha ao processar a imagem'))),
        'image/png',
      );
    });
  } finally {
    bitmap.close?.();
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/__tests__/clienteFoto.test.ts`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe/clienteFoto.ts apps/crm/src/pages/cliente-detalhe/__tests__/clienteFoto.test.ts
git commit -m "feat(cliente-detalhe): add resizeClientePhoto helper"
```

---

### Task 4: `ClienteAvatarUpload` component

**Files:**
- Create: `apps/crm/src/pages/cliente-detalhe/ClienteAvatarUpload.tsx`
- Create: `apps/crm/src/pages/cliente-detalhe/__tests__/ClienteAvatarUpload.test.tsx`

**Interfaces:**
- Consumes: `resizeClientePhoto(file, maxSize?)` from Task 3; `updateCliente(id, partial): Promise<void>` and `Cliente` from `@/store` (Task 2); `supabase` from `@/lib/supabase`.
- Produces: `ClienteAvatarUpload(props: { clienteId: number; nome: string; cor: string; initials: string; imageUrl: string | null; canEdit: boolean })` — a React component. Consumed by Task 5 (`ClienteDetalheHeader`).

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/crm/src/pages/cliente-detalhe/__tests__/ClienteAvatarUpload.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../clienteFoto', () => ({
  resizeClientePhoto: vi.fn(async () => new Blob(['x'], { type: 'image/png' })),
}));
vi.mock('../../../store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../store')>()),
  updateCliente: vi.fn(async () => {}),
}));
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: vi.fn(async () => ({ error: null })),
        getPublicUrl: () => ({ data: { publicUrl: 'https://cdn.mesaas.com/avatars/clientes/1/foto.png' } }),
      }),
    },
  },
}));

import { resizeClientePhoto } from '../clienteFoto';
import { updateCliente } from '../../../store';
import { ClienteAvatarUpload } from '../ClienteAvatarUpload';

const mockedResize = vi.mocked(resizeClientePhoto);
const mockedUpdateCliente = vi.mocked(updateCliente);

function renderIt(props: Partial<React.ComponentProps<typeof ClienteAvatarUpload>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ClienteAvatarUpload
          clienteId={1}
          nome="Aurora Estética"
          cor="#ffbf30"
          initials="AE"
          imageUrl={null}
          canEdit
          {...props}
        />
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  mockedResize.mockClear();
  mockedUpdateCliente.mockClear();
});

describe('ClienteAvatarUpload', () => {
  it('renders a plain, non-interactive avatar when canEdit is false', () => {
    renderIt({ canEdit: false });
    expect(screen.queryByRole('button', { name: /Alterar foto/ })).not.toBeInTheDocument();
    expect(screen.getByText('AE')).toBeInTheDocument();
  });

  it('uploads and calls updateCliente with the resulting public URL, then invalidates both cache keys', async () => {
    const { queryClient } = renderIt();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const file = new File(['x'], 'foto.png', { type: 'image/png' });

    const input = screen.getByLabelText(/Alterar foto/, { selector: 'input' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(mockedUpdateCliente).toHaveBeenCalledWith(1, {
      foto_url: expect.stringContaining('https://cdn.mesaas.com/avatars/clientes/1/foto.png'),
    }));
    expect(mockedResize).toHaveBeenCalledWith(file);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['cliente', 1] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clientes'] });
  });

  it('rejects a file over 2MB without calling resize or updateCliente', async () => {
    renderIt();
    const bigFile = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });

    const input = screen.getByLabelText(/Alterar foto/, { selector: 'input' });
    fireEvent.change(input, { target: { files: [bigFile] } });

    await waitFor(() => expect(mockedResize).not.toHaveBeenCalled());
    expect(mockedUpdateCliente).not.toHaveBeenCalled();
  });

  it('shows a remove control only when a photo is set, and confirms before removing', async () => {
    renderIt({ imageUrl: 'https://cdn.mesaas.com/avatars/clientes/1/foto.png' });

    const removeButton = screen.getByRole('button', { name: /Remover foto/ });
    fireEvent.click(removeButton);

    expect(screen.getByText(/Remover a foto do cliente\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remover' }));

    await waitFor(() =>
      expect(mockedUpdateCliente).toHaveBeenCalledWith(1, { foto_url: null }),
    );
  });

  it('does not show a remove control when there is no photo', () => {
    renderIt({ imageUrl: null });
    expect(screen.queryByRole('button', { name: /Remover foto/ })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/__tests__/ClienteAvatarUpload.test.tsx`
Expected: FAIL — `../ClienteAvatarUpload` does not exist.

- [ ] **Step 3: Implement**

```tsx
// apps/crm/src/pages/cliente-detalhe/ClienteAvatarUpload.tsx
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/lib/supabase';
import { updateCliente } from '@/store';
import { resizeClientePhoto } from './clienteFoto';

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

interface ClienteAvatarUploadProps {
  clienteId: number;
  nome: string;
  cor: string;
  initials: string;
  imageUrl: string | null;
  canEdit: boolean;
}

export function ClienteAvatarUpload({
  clienteId,
  nome,
  cor,
  initials,
  imageUrl,
  canEdit,
}: ClienteAvatarUploadProps) {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['cliente', clienteId] });
    qc.invalidateQueries({ queryKey: ['clientes'] });
  }

  async function handleUpload(file: File) {
    if (file.size > MAX_PHOTO_BYTES) {
      toast.error('Arquivo deve ser menor que 2MB.');
      return;
    }
    setUploading(true);
    try {
      const blob = await resizeClientePhoto(file);
      const path = `clientes/${clienteId}/foto.png`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { upsert: true, contentType: 'image/png' });
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = urlData.publicUrl + '?t=' + Date.now();
      await updateCliente(clienteId, { foto_url: publicUrl });
      invalidate();
      toast.success('Foto atualizada!');
    } catch {
      toast.error('Erro ao enviar foto.');
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    setUploading(true);
    try {
      await updateCliente(clienteId, { foto_url: null });
      invalidate();
      toast.success('Foto removida.');
    } catch {
      toast.error('Erro ao remover foto.');
    } finally {
      setUploading(false);
      setRemoveOpen(false);
    }
  }

  const avatar = imageUrl ? (
    <img className="cliente-detalhe-header__avatar" src={imageUrl} alt={nome} />
  ) : (
    <div
      className="cliente-detalhe-header__avatar cliente-detalhe-header__initials"
      style={{ background: cor }}
      aria-hidden="true"
    >
      {initials}
    </div>
  );

  if (!canEdit) return avatar;

  return (
    <div className="cliente-avatar-upload">
      <label className="cliente-avatar-upload__trigger">
        {avatar}
        <span className="cliente-avatar-upload__overlay" aria-hidden="true">
          <Camera size={16} />
        </span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          aria-label="Alterar foto do cliente"
          ref={inputRef}
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void handleUpload(file);
          }}
        />
      </label>
      {imageUrl && (
        <>
          <button
            type="button"
            className="cliente-avatar-upload__remove"
            aria-label="Remover foto do cliente"
            disabled={uploading}
            onClick={() => setRemoveOpen(true)}
          >
            <X size={12} />
          </button>
          <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remover a foto do cliente?</AlertDialogTitle>
                <AlertDialogDescription>
                  O Hub volta a mostrar o avatar do Instagram (se houver) ou as iniciais do
                  cliente.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleRemove}>Remover</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/__tests__/ClienteAvatarUpload.test.tsx`
Expected: PASS, all 5 tests. If the `getByLabelText(..., { selector: 'input' })` query doesn't resolve, confirm the `<label>` wraps the `<input>` directly (Testing Library associates them implicitly through DOM nesting, no `htmlFor`/`id` needed) — adjust the query, not the component, if this trips up.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe/ClienteAvatarUpload.tsx apps/crm/src/pages/cliente-detalhe/__tests__/ClienteAvatarUpload.test.tsx
git commit -m "feat(cliente-detalhe): add ClienteAvatarUpload"
```

---

### Task 5: Wire into `ClienteDetalheHeader` and `ClienteDetalhePage`, add CSS

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/ClienteDetalheHeader.tsx`
- Modify: `apps/crm/src/pages/cliente-detalhe/__tests__/ClienteDetalheHeader.test.tsx`
- Modify: `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx:149-157`
- Modify: `apps/crm/src/pages/cliente-detalhe/__tests__/ClienteDetalhePage.test.tsx`
- Modify: `apps/crm/style.css` (append after line ~9519, the end of the existing `.cliente-detalhe-header__initials` block)

**Interfaces:**
- Consumes: `ClienteAvatarUpload` (Task 4), `workspaceRole` from `useAuth()` (already destructured in `ClienteDetalhePage.tsx:39`).

- [ ] **Step 1: Update `ClienteDetalheHeader.tsx`**

Replace the whole file's avatar block and props:

```tsx
import { ArrowLeft, Edit2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ClienteAvatarUpload } from './ClienteAvatarUpload';

interface ClienteDetalheHeaderProps {
  clienteId: number;
  nome: string;
  initials: string;
  cor: string;
  plano: string;
  status: string;
  imageUrl?: string | null;
  canEditPhoto: boolean;
  onBack: () => void;
  onEdit: () => void;
}

const STATUS_CLASS: Record<string, string> = {
  ativo: 'badge-success',
  pausado: 'badge-warning',
  encerrado: 'badge-danger',
  vigente: 'badge-success',
  a_assinar: 'badge-warning',
  pago: 'badge-success',
  agendado: 'badge-neutral',
};

export function ClienteDetalheHeader(props: ClienteDetalheHeaderProps) {
  const { t } = useTranslation('clients');
  const { t: tc } = useTranslation();

  return (
    <header className="cliente-detalhe-header">
      <div className="cliente-detalhe-header__identity">
        <Button
          variant="outline"
          size="icon"
          className="cliente-detalhe-header__back"
          onClick={props.onBack}
          aria-label={t('detail.nav.backToClients')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <ClienteAvatarUpload
          clienteId={props.clienteId}
          nome={props.nome}
          cor={props.cor}
          initials={props.initials}
          imageUrl={props.imageUrl ?? null}
          canEdit={props.canEditPhoto}
        />
        <div className="cliente-detalhe-header__text">
          <h2 className="cliente-detalhe-header__name">{props.nome}</h2>
          <div className="cliente-detalhe-header__badges">
            <span className="badge badge-neutral">{props.plano}</span>
            <span className={`badge ${STATUS_CLASS[props.status] ?? 'badge-neutral'}`}>
              {tc(`status.${props.status}`, { defaultValue: props.status })}
            </span>
          </div>
        </div>
      </div>
      <Button variant="outline" className="cliente-detalhe-header__edit" onClick={props.onEdit}>
        <Edit2 className="h-4 w-4" /> {tc('actions.edit')}
      </Button>
    </header>
  );
}
```

- [ ] **Step 2: Update the existing header test to pass the two new required props**

In `apps/crm/src/pages/cliente-detalhe/__tests__/ClienteDetalheHeader.test.tsx`, add `clienteId={1}` and `canEditPhoto={false}` to the existing `<ClienteDetalheHeader ... />` call (with `canEditPhoto={false}`, `ClienteAvatarUpload` renders the plain read-only avatar, so the existing assertions are unaffected). Then add a second test:

```tsx
  it('shows the photo-upload control only when canEditPhoto is true', () => {
    render(
      <ClienteDetalheHeader
        clienteId={7}
        nome="Ana Beatriz Gois Bessa"
        initials="AB"
        cor="#eab308"
        plano="Social + Vídeo"
        status="ativo"
        canEditPhoto
        onBack={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Alterar foto do cliente')).toBeInTheDocument();
  });
```

- [ ] **Step 3: Run the header tests**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/__tests__/ClienteDetalheHeader.test.tsx`
Expected: PASS, both tests.

- [ ] **Step 4: Wire `ClienteDetalhePage.tsx`**

Change the `<ClienteDetalheHeader ... />` call at line 149:

```tsx
      <ClienteDetalheHeader
        clienteId={clienteId}
        nome={cliente.nome}
        initials={getInitials(cliente.nome)}
        cor={cliente.cor}
        plano={cliente.plano}
        status={cliente.status}
        imageUrl={cliente.foto_url}
        canEditPhoto={workspaceRole === 'owner' || workspaceRole === 'admin'}
        onBack={() => navigate('/clientes')}
        onEdit={() => setEditOpen(true)}
      />
```

(`workspaceRole` is already destructured from `useAuth()` at the top of this component — no new import needed.)

- [ ] **Step 5: Add owner/agent coverage to `ClienteDetalhePage.test.tsx`**

Add a test alongside the existing ones in that file (it already has `setAuth(workspaceRole, ...)` and `CLIENTE` fixtures set up):

```tsx
  it('shows the photo-upload control for an owner but not for an agent', async () => {
    setAuth('owner');
    mockedGetCliente.mockResolvedValue({ ...CLIENTE, foto_url: null });
    renderAt('/clientes/42/visao-geral');
    expect(await screen.findByLabelText('Alterar foto do cliente')).toBeInTheDocument();

    setAuth('agent');
    mockedGetCliente.mockResolvedValue({ ...CLIENTE, foto_url: null });
    renderAt('/clientes/42/visao-geral');
    await screen.findByText('conteudo visao-geral');
    expect(screen.queryByLabelText('Alterar foto do cliente')).not.toBeInTheDocument();
  });
```

- [ ] **Step 6: Run the page tests**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/__tests__/ClienteDetalhePage.test.tsx`
Expected: PASS, including the new test.

- [ ] **Step 7: Add CSS**

Append to `apps/crm/style.css`, directly after the existing `.cliente-detalhe-header__initials { ... }` block (~line 9519):

```css
.cliente-avatar-upload {
  position: relative;
  flex: 0 0 48px;
  width: 48px;
  height: 48px;
}

.cliente-avatar-upload__trigger {
  position: relative;
  display: block;
  width: 48px;
  height: 48px;
  cursor: pointer;
  border-radius: 50%;
}

.cliente-avatar-upload__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  opacity: 0;
  transition: opacity 0.15s ease;
  pointer-events: none;
}

.cliente-avatar-upload__trigger:hover .cliente-avatar-upload__overlay,
.cliente-avatar-upload__trigger:focus-within .cliente-avatar-upload__overlay {
  opacity: 1;
}

.cliente-avatar-upload__remove {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid var(--card-bg);
  background: var(--danger);
  color: #fff;
  display: none;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}

.cliente-avatar-upload:hover .cliente-avatar-upload__remove {
  display: flex;
}
```

- [ ] **Step 8: Typecheck and run the whole cliente-detalhe test folder**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit && npx vitest run apps/crm/src/pages/cliente-detalhe`
Expected: no type errors, all tests pass.

- [ ] **Step 9: Verify manually in the browser**

Start the CRM dev server, open a client detail page as an owner/admin: hover the avatar (camera overlay appears), upload a small image, confirm it appears and the roster page (`/clientes`) also shows it after navigating back. Remove it via the "x" badge + confirm dialog, verify it reverts to initials. Switch to an agent-role account (or a second test user) and confirm no hover affordance appears on the same page.

- [ ] **Step 10: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe/ClienteDetalheHeader.tsx apps/crm/src/pages/cliente-detalhe/__tests__/ClienteDetalheHeader.test.tsx apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx apps/crm/src/pages/cliente-detalhe/__tests__/ClienteDetalhePage.test.tsx apps/crm/style.css
git commit -m "feat(cliente-detalhe): wire click-to-upload photo into the client header"
```

---

### Task 6: `hub-bootstrap` precedence

**Files:**
- Modify: `supabase/functions/hub-bootstrap/handler.ts:62-82`
- Modify: `supabase/functions/__tests__/hub-bootstrap_test.ts`

**Interfaces:**
- Produces: `cliente_foto_url` in the bootstrap JSON response now resolves as `clientes.foto_url → instagram_accounts.profile_picture_url → null`, consumed unchanged by Task 8 (`HomePage.tsx`) and the existing `HubSidebar`/`HubMobileNav`.

- [ ] **Step 1: Update the handler**

In `supabase/functions/hub-bootstrap/handler.ts`, change:

```ts
    const { data: cliente } = await db
      .from("clientes")
      .select("nome")
      .eq("id", hubToken.cliente_id)
      .single();

    // The client's photo is their connected Instagram avatar, cached to the public
    // `avatars` bucket by instagram-integration (the live CDN urls expire). Clients
    // without a connected account are normal, so this is best-effort: a miss just
    // falls back to the initial, it must never fail the whole bootstrap.
    let clienteFotoUrl: string | null = null;
    try {
      const { data: igAccount } = await db
        .from("instagram_accounts")
        .select("profile_picture_url")
        .eq("client_id", hubToken.cliente_id)
        .maybeSingle();
      clienteFotoUrl = igAccount?.profile_picture_url || null;
    } catch {
      // intentionally ignored — falls back to the client's initial
    }
```

to:

```ts
    const { data: cliente } = await db
      .from("clientes")
      .select("nome, foto_url")
      .eq("id", hubToken.cliente_id)
      .single();

    // The client's photo: a manually-uploaded one (clientes.foto_url) takes
    // precedence, falling back to their connected Instagram avatar, cached to
    // the public `avatars` bucket by instagram-integration (the live CDN urls
    // expire). Clients with neither are normal, so the IG lookup is
    // best-effort: a miss just falls back to the initial, it must never fail
    // the whole bootstrap.
    let igFotoUrl: string | null = null;
    try {
      const { data: igAccount } = await db
        .from("instagram_accounts")
        .select("profile_picture_url")
        .eq("client_id", hubToken.cliente_id)
        .maybeSingle();
      igFotoUrl = igAccount?.profile_picture_url || null;
    } catch {
      // intentionally ignored — falls back to the client's initial
    }
    const clienteFotoUrl = cliente?.foto_url || igFotoUrl || null;
```

The rest of the function (the `return json({...})` block using `clienteFotoUrl`) is unchanged.

- [ ] **Step 2: Extend the test mock and add precedence tests**

In `supabase/functions/__tests__/hub-bootstrap_test.ts`, change `makeDb` to accept the cliente row and the Instagram row as parameters, defaulting to today's behavior so every existing test keeps passing unmodified:

```ts
function makeDb(
  tokenRow: unknown,
  clienteRow: { nome: string; foto_url?: string | null } = { nome: "Vanessa" },
  igRow: { profile_picture_url?: string | null } | null = null,
) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: tokenRow }) }),
          maybeSingle: async () => ({
            data:
              table === "workspaces" ? WORKSPACE_ROW
              : table === "instagram_accounts" ? igRow
              : tokenRow,
          }),
          gt: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: tokenRow }) }),
            maybeSingle: async () => ({ data: tokenRow }),
          }),
          single: async () => ({ data: clienteRow }),
        }),
      }),
    }),
    rpc: async () => ({ data: true, error: null }),
  };
}
```

Then add, near the other `cliente_foto_url`-adjacent assertions:

```ts
// --- cliente_foto_url precedence ------------------------------------------

Deno.test("cliente_foto_url uses the manual foto_url when set, ignoring a connected Instagram account", async () => {
  const handler = createHubBootstrapHandler({
    buildCorsHeaders: cors,
    createDb: () =>
      makeDb(
        { cliente_id: 15, conta_id: "ws-1", is_active: true },
        { nome: "Vanessa", foto_url: "https://cdn.mesaas.com/avatars/clientes/15/foto.png" },
        { profile_picture_url: "https://scontent.cdninstagram.com/ig.jpg" },
      ) as any,
    now: () => NOW,
    touchToken: async () => {},
  });
  const res = await handler(req());
  const body = await res.json();
  assertEquals(body.cliente_foto_url, "https://cdn.mesaas.com/avatars/clientes/15/foto.png");
});

Deno.test("cliente_foto_url falls back to the Instagram avatar when no manual photo is set", async () => {
  const handler = createHubBootstrapHandler({
    buildCorsHeaders: cors,
    createDb: () =>
      makeDb(
        { cliente_id: 15, conta_id: "ws-1", is_active: true },
        { nome: "Vanessa", foto_url: null },
        { profile_picture_url: "https://scontent.cdninstagram.com/ig.jpg" },
      ) as any,
    now: () => NOW,
    touchToken: async () => {},
  });
  const res = await handler(req());
  const body = await res.json();
  assertEquals(body.cliente_foto_url, "https://scontent.cdninstagram.com/ig.jpg");
});

Deno.test("cliente_foto_url is null when neither a manual photo nor a connected Instagram account exists", async () => {
  const handler = createHubBootstrapHandler({
    buildCorsHeaders: cors,
    createDb: () =>
      makeDb(
        { cliente_id: 15, conta_id: "ws-1", is_active: true },
        { nome: "Vanessa", foto_url: null },
        null,
      ) as any,
    now: () => NOW,
    touchToken: async () => {},
  });
  const res = await handler(req());
  const body = await res.json();
  assertEquals(body.cliente_foto_url, null);
});
```

- [ ] **Step 3: Run the suite**

Run: `deno test --allow-all supabase/functions/__tests__/hub-bootstrap_test.ts`
Expected: PASS, all tests (the pre-existing ones plus the 3 new ones) — confirms the `makeDb` signature change didn't break any caller relying on the two-argument form.

- [ ] **Step 4: Run the full Deno suite to catch any other `hub-bootstrap` consumer**

Run: `npm run test:functions`
Expected: PASS. (This dirties the root `deno.lock` — run `git checkout -- deno.lock` afterward per this repo's known gotcha.)

- [ ] **Step 5: Commit**

```bash
git checkout -- deno.lock
git add supabase/functions/hub-bootstrap/handler.ts supabase/functions/__tests__/hub-bootstrap_test.ts
git commit -m "feat(hub-bootstrap): prefer a manual client photo over the Instagram avatar"
```

---

### Task 7: `ClientAvatar` size-aware fallback

**Files:**
- Modify: `apps/hub/src/components/ClientAvatar.tsx`
- Create: `apps/hub/src/components/__tests__/ClientAvatar.test.tsx`

**Interfaces:**
- Produces: `ClientAvatar`'s initials fallback font size now scales with the `size` prop (previously hardcoded at 11px regardless of size). No prop signature change. `HubSidebar` calls with no `size` prop (true 28px default, fallback stays exactly 11px, byte-for-byte unaffected). **Correction, found during implementation:** `HubMobileNav` actually calls with `size={32}`, not the 28px default — its fallback initial moves from a fixed 11px to a computed 13px. Reviewed and accepted as an acceptable, barely-perceptible change to a rarely-seen fallback path (a client with neither a manual photo nor a connected Instagram account), not a regression worth special-casing.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/hub/src/components/__tests__/ClientAvatar.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ClientAvatar } from '../ClientAvatar';

describe('ClientAvatar', () => {
  it('renders the photo when photoUrl is provided', () => {
    render(<ClientAvatar name="Clínica Aurora" photoUrl="https://cdn.mesaas.com/foto.png" />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://cdn.mesaas.com/foto.png');
  });

  it('falls back to the initial when photoUrl is null', () => {
    render(<ClientAvatar name="Clínica Aurora" photoUrl={null} />);
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('falls back to the initial when the image fails to load', () => {
    render(<ClientAvatar name="Clínica Aurora" photoUrl="https://cdn.mesaas.com/broken.png" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('keeps the existing 11px fallback size at the default (28px) size', () => {
    render(<ClientAvatar name="Clínica Aurora" photoUrl={null} />);
    expect(screen.getByText('C')).toHaveStyle({ fontSize: '11px' });
  });

  it('scales the fallback font size up for a larger avatar', () => {
    render(<ClientAvatar name="Clínica Aurora" photoUrl={null} size={128} />);
    expect(screen.getByText('C')).toHaveStyle({ fontSize: '51px' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/hub/src/components/__tests__/ClientAvatar.test.tsx`
Expected: FAIL on the two font-size tests (the fallback currently has a fixed `text-[11px]` class, no inline `fontSize`, and no `role="img"` on the `<img>` — confirm the exact failure mode before moving on, since `<img>` gets an implicit `role="img"` from its `alt` attribute already being `""`; if the first two tests already pass, that's fine, only the fontSize-style assertions must be failing).

- [ ] **Step 3: Implement**

```tsx
// apps/hub/src/components/ClientAvatar.tsx
import { useState } from 'react';

/**
 * The client's photo — a manually-uploaded one if the agency set one,
 * otherwise their connected Instagram avatar, the same image the CRM shows
 * on the client detail page. Falls back to the initial when neither exists,
 * and also when the image fails to load: the avatar is served from a public
 * bucket, but a stale row can still point at an expired CDN url, and a
 * broken-image glyph next to the client's own name reads worse than a
 * monogram.
 */
export function ClientAvatar({
  name,
  photoUrl,
  size = 28,
}: {
  name: string;
  photoUrl: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const initial = name.trim().charAt(0).toUpperCase();
  const box = { width: size, height: size };

  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt=""
        style={box}
        onError={() => setFailed(true)}
        className="rounded-full object-cover flex-shrink-0 border hub-border"
      />
    );
  }

  // Sized proportionally so the fallback initial still reads at any size —
  // the 28px nav avatar and the 128px homepage one need very different font
  // sizes; a fixed 11px looked fine at 28px and lost in a 128px circle.
  const fontSize = Math.max(11, Math.round(size * 0.4));

  return (
    <div
      style={{ ...box, fontSize }}
      aria-hidden="true"
      className="rounded-full flex items-center justify-center flex-shrink-0 font-semibold hub-bg-soft hub-tx2 border hub-border"
    >
      {initial}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run apps/hub/src/components/__tests__/ClientAvatar.test.tsx`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/components/ClientAvatar.tsx apps/hub/src/components/__tests__/ClientAvatar.test.tsx
git commit -m "fix(hub): scale ClientAvatar's fallback initial with its size"
```

---

### Task 8: Hub homepage rendering

**Files:**
- Modify: `apps/hub/src/pages/HomePage.tsx:92-99`
- Modify: `apps/hub/src/pages/__tests__/contentPages.test.tsx`

**Interfaces:**
- Consumes: `ClientAvatar` (Task 7, unchanged signature), `bootstrap.cliente_foto_url` and `bootstrap.cliente_nome` from `useHub()` (already used elsewhere in this file).

- [ ] **Step 1: Extend the test fixture and add the assertion**

In `apps/hub/src/pages/__tests__/contentPages.test.tsx`, add `cliente_foto_url: null` to the shared `hubValue.bootstrap` object (harmless for every existing test; `HubBootstrap`'s type requires the field, so this is also a type-correctness fix, not just test setup):

```ts
const hubValue = {
  bootstrap: {
    workspace: {
      name: 'Mesaas',
      logo_url: 'https://cdn.mesaas.com/logo.png',
      brand_color: '#0f766e',
    },
    cliente_nome: 'Clínica Aurora',
    cliente_foto_url: null,
    is_active: true,
    cliente_id: 14,
    feature_mensagens: true,
  },
  token: 'token-publico',
  workspace: 'mesaas',
};
```

Then add a new test in the `describe('hub content pages', ...)` block, next to the existing HomePage test. `renderHubPage` always uses the shared `hubValue` fixture, so this test renders directly instead, to thread a `cliente_foto_url` override through `HubContext`:

```tsx
  it('shows a bigger client avatar above the greeting when a photo is set', async () => {
    mockedFetchPosts.mockResolvedValue({ posts: [] } as never);
    const withPhoto = {
      ...hubValue,
      bootstrap: { ...hubValue.bootstrap, cliente_foto_url: 'https://cdn.mesaas.com/foto.png' },
    };

    render(
      <QueryClientProvider client={createQueryClient()}>
        <HubContext.Provider value={withPhoto}>
          <MemoryRouter initialEntries={['/mesaas/hub/token-publico']}>
            <Routes>
              <Route path="/:workspace/hub/:token/*" element={<HomePage />} />
            </Routes>
          </MemoryRouter>
        </HubContext.Provider>
      </QueryClientProvider>,
    );

    const avatar = await screen.findByRole('img');
    expect(avatar).toHaveAttribute('src', 'https://cdn.mesaas.com/foto.png');
    expect(avatar).toHaveStyle({ width: '128px', height: '128px' });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/hub/src/pages/__tests__/contentPages.test.tsx`
Expected: the new test FAILs (no `role="img"` element rendered yet by `HomePage`); every pre-existing test in the file still passes (confirms the `cliente_foto_url: null` fixture addition is non-breaking).

- [ ] **Step 3: Implement**

In `apps/hub/src/pages/HomePage.tsx`, add the import and the new block. Change:

```tsx
import { useHub } from '../HubContext';
import { fetchPosts } from '../api';
import { PostCalendar } from '../components/PostCalendar';
import { DashboardSection } from '../components/dashboard/DashboardSection';
```

to:

```tsx
import { useHub } from '../HubContext';
import { fetchPosts } from '../api';
import { PostCalendar } from '../components/PostCalendar';
import { DashboardSection } from '../components/dashboard/DashboardSection';
import { ClientAvatar } from '../components/ClientAvatar';
```

And change the return's first `<section>`:

```tsx
  return (
    <div className="hub-fade-up flex flex-col gap-6">
      <section>
        <ClientAvatar name={bootstrap.cliente_nome} photoUrl={bootstrap.cliente_foto_url} size={128} />
        <p className="text-[13px] font-medium hub-tx3 mb-1.5 mt-4">{bootstrap.workspace.name}</p>
        <h1 className="font-display font-medium text-[clamp(2rem,5vw,3rem)] leading-[1.04] tracking-tight hub-txt mb-1.5">
          Olá, <em className="italic font-normal">{firstName}</em> 👋
        </h1>
      </section>
```

(Only the `<section>`'s contents change — the `mb-1.5` on the eyebrow `<p>` becomes `mb-1.5 mt-4` to add breathing room under the avatar; everything after stays exactly as-is.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run apps/hub/src/pages/__tests__/contentPages.test.tsx`
Expected: PASS, all tests including the new one.

- [ ] **Step 5: Typecheck the Hub project**

Run: `npx tsc -p apps/hub/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Verify manually in the browser**

Open the Hub homepage for a client with a manual photo set (from Task 5's manual check), confirm the 128px avatar renders above "Olá, {name}" in both light and dark mode. Open it for a client with no photo and no connected Instagram account, confirm a legible, proportionally-sized initial renders instead of a broken image or a tiny monogram.

- [ ] **Step 7: Commit**

```bash
git add apps/hub/src/pages/HomePage.tsx apps/hub/src/pages/__tests__/contentPages.test.tsx
git commit -m "feat(hub): show the client's photo above the homepage greeting"
```

---

## Final Verification

- [ ] Run the full CRM/Hub/Admin typecheck + lint + test sweep this repo requires before any push:

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run lint
npm run format:check
npm run test
npm run test:functions
```

- [ ] Re-verify the migration prefix one more time immediately before opening the PR: `git ls-tree origin/main:supabase/migrations | tail -5`.
- [ ] If Docker/colima is available, run `bash scripts/test-entitlements.sh`; otherwise rely on the CI `entitlement-tests` job and say so explicitly in the PR description.
