# Client photo in the Hub — design

**Date:** 2026-08-17
**Status:** Approved, ready for planning

## Motivation

The Hub already shows a client "photo" — it's the client's connected Instagram
avatar, cached to the public `avatars` bucket and served through
`hub-bootstrap`'s `cliente_foto_url` field. `HubSidebar` and `HubMobileNav`
already render it via the `ClientAvatar` component, with a graceful fallback
to the client's initial.

Two gaps:

1. The Hub homepage (`HomePage.tsx`) doesn't show it at all — it's only in the
   nav chrome.
2. There's no way to set a photo for a client with no connected Instagram
   account, or to override the IG-derived one.

This design adds a manual, agency-uploaded photo and a bigger rendering of it
on the Hub homepage.

## Decisions locked in during brainstorming

- **Uploader:** the agency, from the CRM's client detail page — not the
  client, and not from within the Hub. Matches how the workspace logo works
  today.
- **Scope:** once set, the manual photo overrides the Instagram-derived one
  everywhere in the Hub (sidebar, mobile nav, homepage) — one source of
  truth, with the existing IG-avatar → initials fallback chain preserved
  underneath it.
- **Upload location in the CRM:** click-to-upload directly on the avatar
  already shown in `ClienteDetalheHeader` (the CRM currently has this prop
  wired but never fed an image, so this also makes the CRM header show a
  photo for the first time).
- **Upload permission:** owner/admin only, same as the workspace logo.
- **Homepage size:** a 128px avatar, stacked above the "Olá, {name}" heading
  block — a real profile-page moment, not a small accent.

## Approach

Direct upload to the existing public `avatars` Supabase Storage bucket,
storing a plain public URL — mirroring `WorkspaceTab.tsx`'s existing
workspace-logo upload almost exactly, rather than routing through the
generic file-manage/R2 system (`uploadFile`/`useFileUrl`). That system is
built for authenticated CRM sessions; the token-based, unauthenticated Hub
would need `hub-bootstrap` to mint a presigned/public R2 URL on every load,
and the field would end up carrying two different URL shapes for the same
concept. A plain public URL is also exactly the shape `cliente_foto_url`
already has today (the cached IG avatar URL), so no downstream consumer
needs to special-case it.

## Schema & storage

One new migration (pick a timestamp prefix above main's current tail —
`20260817000001` as of this writing, but re-verify at PR-open time per the
project's migration-collision history — this repo has been bitten by this
exact mistake twice before):

```sql
ALTER TABLE public.clientes ADD COLUMN foto_url text;

-- Column-level grant allowlist must be re-declared in full (a table-level
-- REVOKE was already applied in 20260728000002; adding a column here means
-- extending that same explicit list, not a fresh REVOKE/GRANT pair).
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
-- clientes.id is bigserial (bigint), NOT the uuid workspace_id is — the
-- folder-segment check casts to ::bigint, not ::int or ::uuid.
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

-- SECURITY-CRITICAL, and NOT optional: avatars_service_write/_update
-- (20260319_avatars_bucket.sql) were created with no `TO` clause, which
-- Postgres defaults to PUBLIC — so today, ANY authenticated user can already
-- write to ANY path in the 'avatars' bucket, including other workspaces'
-- logos and, without this fix, other clients' photos. RLS policies for the
-- same command are OR'd, so the path-scoped policies above add no real
-- restriction until this gap is closed. Their doc comments already say the
-- intent was service_role-only; the `TO` clause was just missing.
--
-- Verified safe to narrow: the only three client-side writes into 'avatars'
-- today (WorkspaceTab's logo, RelatoriosTab's report-splash art, and this
-- new client photo) all live under path prefixes with their own dedicated
-- scoped policy (workspaces/*, clientes/*). service_role bypasses RLS
-- entirely in Supabase, so this is a no-op for edge-function writes and a
-- real fix for everyone else.
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
-- any workspace member to update a client row, so the CRM's UI-level role
-- gate alone cannot stop an agent-role user from calling the API directly
-- and setting foto_url to an arbitrary string — the storage policies above
-- don't help here, since this is a plain table UPDATE, not a storage write.
-- This codebase already has precedent for column-level DB enforcement
-- (financial_visibility's can_see_financials() masking, hub_brand's
-- trg_feature_brand trigger) — same idea, scoped to just this one column.
CREATE OR REPLACE FUNCTION public.enforce_cliente_foto_owner_admin()
RETURNS trigger
LANGUAGE plpgsql
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

The storage policies are the same `workspace_members` role table and shape
the workspace-logo policy already uses (`clientes.conta_id` and
`workspaces.id` are the same space `get_my_conta_id()` resolves to), just
walked from `clientes` instead of `workspaces` directly. Whether
`enforce_cliente_foto_owner_admin()` needs `SECURITY DEFINER` to read
`workspace_members` safely from inside a trigger on a different table
(avoiding any recursive-RLS surprise) needs a check against how
`get_my_conta_id()` and similar helpers already handle this — verify during
planning rather than treating the snippet above as final syntax.

## Store layer (`apps/crm/src/store/clients.ts`)

- Add `foto_url?: string | null;` to the `Cliente` interface.
- Add `foto_url` to `CLIENTE_SAFE_COLUMNS`.
- No new function needed — `updateCliente(id, { foto_url })` already works
  generically, same as every other client field.

## CRM: upload/remove UX

- `ClienteDetalhePage.tsx` passes `imageUrl={cliente.foto_url}` to
  `ClienteDetalheHeader` (the prop already exists and renders correctly;
  it's just never been fed a value).
- `ClienteDetalheHeader`'s avatar becomes interactive, gated to
  `workspaceRole === 'owner' || workspaceRole === 'admin'` (read from
  `AuthContext`) — **not** the plain `role` field `WorkspaceTab.tsx` uses.
  `AuthContext`'s own doc comment says to prefer `workspaceRole` for
  anything permission-bearing, since `role` comes from `profiles` and goes
  stale on workspace switch; `WorkspaceTab` predates that guidance and
  should not be copied here.
  - Hovering shows a semi-transparent overlay with a camera icon.
  - Clicking opens a hidden `<input type="file" accept="image/*">`.
  - On file select: reject files over 2MB with a toast (same limit as the
    workspace logo); otherwise resize client-side via `createImageBitmap` +
    `<canvas>`, following `WorkspaceTab.handleLogoUpload` exactly: canvas
    side = `min(width, height, 512)`, whole source image drawn into that
    square. This is **not** a center-crop — a non-square source gets
    stretched/squashed to fit, and small sources aren't upscaled to 512.
    That's an inherited, accepted quirk (same one the workspace logo already
    has in production), not something this feature introduces or fixes.
  - Upload to the `avatars` bucket at `clientes/{cliente.id}/foto.png` with
    `{ upsert: true, contentType: 'image/png' }`.
  - Read back the public URL via `getPublicUrl`, append `?t=${Date.now()}`
    for cache-busting, call `updateCliente(cliente.id, { foto_url: publicUrl })`.
    On success, invalidate **both** `['cliente', clienteId]` (the detail
    page's own query) and `['clientes']` (the roster page) — `updateCliente`
    returns `void`, and the two pages read from separate TanStack Query
    caches, so a single local `setState` on the detail page would leave the
    roster showing the old photo.
  - Non-owner/admin viewers see the avatar in its current read-only form (no
    hover affordance).
- When `cliente.foto_url` is set, a small remove control (e.g. an "x" badge)
  appears on hover. Clicking it opens an `AlertDialog` confirmation (mirrors
  `WorkspaceTab`'s remove-logo flow) and, on confirm, calls
  `updateCliente(cliente.id, { foto_url: null })`, invalidating the same two
  query keys. This does not delete the underlying storage object — same
  accepted trade-off as the workspace logo today (an orphaned blob in a
  bucket with no cleanup job).
- All failures surface as a generic toast (e.g. "Erro ao enviar foto."); raw
  Postgres/Storage error text is never shown, per the project's security
  rules. A `forbidden` error from the new DB trigger (a non-owner/admin
  bypassing the UI gate directly) maps to the same generic toast — it should
  never be reachable through the UI itself, so no special-cased message is
  needed for it.

## Hub: display

- `supabase/functions/hub-bootstrap/handler.ts`: the existing `clientes`
  query changes from `.select("nome")` to `.select("nome, foto_url")`. The
  existing best-effort Instagram lookup (`clienteFotoUrl` from
  `instagram_accounts.profile_picture_url`) is unchanged, but its result is
  now the fallback rather than the only source:

  ```ts
  const clienteFotoUrl = cliente?.foto_url || igFotoUrl || null;
  ```

  (`igFotoUrl` being the existing best-effort IG lookup, renamed for
  clarity — the try/catch around it and its "must never fail the whole
  bootstrap" comment stay as-is.)
- No change needed in `HubSidebar.tsx` or `HubMobileNav.tsx` — they already
  consume `bootstrap.cliente_foto_url` via `ClientAvatar`, so a manual photo
  flows through automatically.
- `apps/hub/src/pages/HomePage.tsx`: a new block renders
  `<ClientAvatar name={bootstrap.cliente_nome} photoUrl={bootstrap.cliente_foto_url} size={128} />`
  above the existing eyebrow/heading `<section>`, using the same
  `hub-fade-up` treatment the rest of the page uses.
- `ClientAvatar`'s initials fallback currently hardcodes `text-[11px]`
  regardless of the `size` prop — fine at the 28px it was built for, but a
  128px circle with an 11px monogram in the corner looks broken. `size`
  needs to drive the fallback's font size too (e.g. roughly
  `size * 0.4`), so a client with no photo at all still gets a legible,
  proportionally-sized initial on the homepage.

## Out of scope

- The CRM dashboard's `ClientHealthCard` and other IG-avatar consumers
  outside the Hub are untouched — this design only changes what the Hub
  shows and what the CRM's client-detail header shows.
- No entitlement/plan gate on the photo — it extends the existing free
  avatar display, not a new paid feature.
- No cleanup of orphaned storage objects on removal or re-upload (beyond the
  cache-busted filename already avoiding stale-URL issues) — consistent with
  the existing workspace-logo behavior.
- The client cannot upload their own photo from within the Hub.

## Testing

- Unit test for the `hub-bootstrap` precedence logic: manual `foto_url` set
  → wins; unset with a connected IG account → IG avatar; neither → `null`
  (existing `ClientAvatar` fallback to initials handles the rest).
- The CRM upload/remove interaction (hover overlay, file picker, resize,
  `AlertDialog`) has no existing automated coverage for its workspace-logo
  equivalent either — verify manually in the browser: upload, remove, and
  the owner/admin gate (an `agent`-role user should see no hover affordance).
- Verify the Hub homepage's 128px avatar rendering in the browser, both with
  and without a manual photo set, and both with and without a connected
  Instagram account.
- The new storage RLS policies, the narrowed `avatars_service_write`/
  `avatars_service_update`, and the `trg_cliente_foto_owner_admin` trigger
  are exactly the kind of thing `supabase/tests/entitlements/*.sql` already
  covers and CI gates on (`entitlement-tests`) — add cases there: an agent
  cannot set `foto_url` via a direct table update; an owner/admin from a
  *different* workspace cannot write to `clientes/{other_id}/foto.png`; a
  service-role write to an arbitrary `avatars` path still succeeds after the
  narrowing.
