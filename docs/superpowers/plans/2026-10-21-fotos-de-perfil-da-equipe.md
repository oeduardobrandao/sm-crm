# Fotos de perfil da equipe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each team member gets one photo (set by themselves or by someone with `equipe:editar`) shown on every team-avatar surface of the CRM, never in the Hub.

**Architecture:** One SECURITY DEFINER RPC (`set_member_photo`) is the only writer of `profiles.avatar_url` / `membros.avatar_url`; it takes a storage path, verifies the uploaded object, and builds the public URL from the Vault `project_url`. Triggers on `membros` keep linked rows as copies of the profile photo and stop client writes. The CRM gets one `PessoaAvatar` component used everywhere and one upload hook used by Perfil and Equipe.

**Tech Stack:** Postgres/Supabase (RLS, storage policies, Vault), psql entitlement suites, React 19 + TanStack Query, Vitest + Testing Library, Deno tests for edge functions.

**Spec:** `docs/superpowers/specs/2026-10-21-fotos-de-perfil-da-equipe-design.md`

## Global Constraints

- Worktree: `/Users/eduardosouza/projects/sm-crm/.claude/worktrees/seamless-user-updates-539712`, branch `feat/fotos-perfil-equipe`. Every subagent runs `pwd && git branch --show-current` first and stays there.
- Migration version above main's tail (`20261021120000`): use `20261022000001_fotos_perfil_equipe.sql`. Re-check `ls supabase/migrations | tail -1` on origin/main before opening the PR.
- UI copy in pt-BR, no em-dashes (period or colon instead). Icons from `lucide-react`. Toasts via `toast()` from `sonner`.
- Uploads wrap the upload + RPC in `holdUnsavedWork()` from `@mesaas/app-lifecycle`. Never `useBlocker`.
- Stored value is `NULL`, never `''`.
- Photo processing: center square crop, max side 512px, JPEG quality 0.85, input limit 10MB (`10 * 1024 * 1024`).
- Storage: bucket `avatars`, paths `profiles/{auth.uid()}/{uuid}.jpg` (self) and `membros/{membro_id}/{uuid}.jpg` (by an editor), no upsert.
- Permission for editing someone else: `has_permission_for(auth.uid(), <conta do membro>, 'equipe', 'editar')` in SQL, `can('equipe','editar')` in the UI.
- Hub never shows a team photo.
- Formatter scope: run `npx prettier --write` only on files you touched, never repo-wide.

## Review Focus

1. **Photo that fails to load** (deleted object, offline): the avatar must fall back to initials, and a *new* URL must retry the image. Pinned in Task 3 (`resets the error when fotoUrl changes`).
2. **Non-square or huge phone photo** (4032×3024 HEIC/JPEG, 9MB): must crop centered, not stretch, and not be rejected by the 10MB limit. Pinned in Task 2 (`crops the centered square`, `accepts 9MB`).
3. **Member relinked to a different login**: the old person's face must not reach the new person's profile. Pinned in Task 1 (case `relink does not raise old photo`).
4. **Person who left a workspace**: that workspace's editors can no longer change their global photo, and the person's later photo changes don't touch that workspace's row. Pinned in Task 1 (cases `left-conta editor writes membro only`, `self sync skips left conta`).
5. **Agent sees a colleague's Equipe detail**: no camera button, no "Alterar foto". Pinned in Task 4 (`hides the editor without equipe:editar`).

---

### Task 1: Database: RPC, triggers, grants, storage policies, entitlement suite

**Files:**
- Create: `supabase/migrations/20261022000001_fotos_perfil_equipe.sql`
- Create: `supabase/tests/entitlements/67_fotos_perfil_equipe.sql`

**Interfaces:**
- Produces: `public.set_member_photo(p_membro_id bigint, p_user_id uuid, p_path text) RETURNS text` (the stored URL, or NULL when removing). Errors: `'Insufficient permissions'`, `'invalid_target'` (both or neither target), `'invalid_photo_path'`, `'photo_not_found'`, `'project_url_missing'`.

- [ ] **Step 1: Write the failing entitlement suite** `67_fotos_perfil_equipe.sql`, modeled on `66_cliente_foto_owner_admin.sql` (`\i _helpers.sql`, `begin; select et_grant_hosted_parity();`, `et_make_workspace('max')`, impersonate with `set_config('request.jwt.claims', ...)` + `set local role authenticated`, `rollback` at the end). Seed `project_url` in Vault when missing (`select vault.create_secret('http://example.test', 'project_url')`), and insert `storage.objects` rows with `bucket_id, name, owner, owner_id` set to the impersonated user. Cases (each `RAISE EXCEPTION` on failure):
  - `self ok`: user U (member of A and B, linked membro in each) calls with `p_user_id = U`, path `profiles/U/x.jpg` → returns `'http://example.test/storage/v1/object/public/avatars/profiles/U/x.jpg'`; `profiles.avatar_url` and both membros rows equal it.
  - `self sync skips left conta`: delete U from B's `workspace_members`, set again → B's membro keeps the previous URL.
  - `self other user denied`: U calls with `p_user_id = V` → `Insufficient permissions`.
  - `editor ok, no login`: owner of A sets membro M (no `crm_user_id`) with `membros/M/y.jpg` → only M changes.
  - `editor ok, linked`: owner of A sets linked membro L (login U, still in A) → U's profile and U's membros in current contas change.
  - `left-conta editor writes membro only`: owner of B sets B's membro of U after U left B → only that membro row changes, U's profile unchanged.
  - `agent denied`: agent of A without custom role → `Insufficient permissions`.
  - `custom role with equipe:editar ok`.
  - `other conta denied`: owner of B targets A's membro.
  - `wrong prefix denied`: self call with `membros/M/x.jpg`, editor call with `profiles/U/x.jpg` → `invalid_photo_path`.
  - `missing object denied` → `photo_not_found`; `object of another owner denied` → `photo_not_found`.
  - `remove`: `p_path = NULL` → NULL everywhere the set wrote.
  - `insert forces null`: as authenticated, `insert into membros (..., avatar_url) values (..., 'https://evil.example/a.jpg')` → row has NULL; as `service_role` with `''` → NULL; as `service_role` with a URL → kept.
  - `direct update denied`: as authenticated, `update membros set avatar_url = 'x'` → permission denied.
  - `link copies profile photo`, `link raises membro photo when profile empty`, `relink does not raise old photo` (membro carrying X's copy relinked to Y with no photo → membro NULL, Y's profile NULL), `unlink keeps copy`.
  - `storage policy`: authenticated U can insert `profiles/U/z.jpg` but not `profiles/V/z.jpg`; agent cannot insert `membros/M/z.jpg`; owner of B cannot insert A's `membros/M/z.jpg`.

- [ ] **Step 2: Run it and see it fail**

Run: `npm run test:db` (needs Docker/colima; if unavailable locally, note it and rely on the CI `entitlement-tests` job after push).
Expected: FAIL, `function set_member_photo does not exist`.

- [ ] **Step 3: Write the migration** with, in order:
  1. `UPDATE membros SET avatar_url = NULL WHERE avatar_url = '';` and the same for `profiles`; `ALTER TABLE membros ALTER COLUMN avatar_url DROP DEFAULT` if a `''` default exists (check with `\d membros`).
  2. Remove `avatar_url` from the `GRANT UPDATE (...) ON membros TO authenticated` list: `REVOKE UPDATE ON public.membros FROM authenticated;` then re-grant the exact current column list from `20260430000001` minus `avatar_url` (read the current grant from the latest migration that touches it before writing).
  3. `trg_membros_avatar_insert` BEFORE INSERT: `IF auth.role() = 'service_role' THEN NEW.avatar_url := NULLIF(NEW.avatar_url, ''); ELSE NEW.avatar_url := NULL; END IF;`
  4. `trg_membros_link_photo` BEFORE UPDATE OF `crm_user_id`, SECURITY DEFINER function, the three rules of the spec (link / relink / unlink). The "raise to profile" write is `UPDATE profiles SET avatar_url = NEW.avatar_url WHERE id = NEW.crm_user_id AND avatar_url IS NULL`, only when `OLD.crm_user_id IS NULL`.
  5. `set_member_photo` (SECURITY DEFINER, `SET search_path = public, pg_temp`). Path regex: self `^profiles/<uid>/[^/]+$`, editor `^membros/<id>/[^/]+$`. Object check: `EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'avatars' AND o.name = p_path AND (o.owner_id = auth.uid()::text OR o.owner = auth.uid()))`. URL: `rtrim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url'), '/') || '/storage/v1/object/public/avatars/' || p_path`. "Current contas" = `conta_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = <login>)`. Then `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated;`.
  6. Storage policies `pessoa_photo_self_insert` (`(storage.foldername(name))[1] = 'profiles' AND (storage.foldername(name))[2] = auth.uid()::text`) and `pessoa_photo_membro_insert` (`[1] = 'membros'` and the membro's conta passes `has_permission_for(auth.uid(), m.conta_id, 'equipe', 'editar')`). INSERT only, no UPDATE policy.

- [ ] **Step 4: Run the suite and see it pass**

Run: `npm run test:db`
Expected: PASS for `67_fotos_perfil_equipe.sql` and no regression in `56_profiles_write_lockdown.sql` / `66_cliente_foto_owner_admin.sql`.

- [ ] **Step 5: Commit** `feat(equipe): RPC e triggers de foto de perfil`

### Task 2: Client data layer: crop helper, store call, upload hook, types

**Files:**
- Create: `apps/crm/src/lib/pessoaFoto.ts`, `apps/crm/src/lib/__tests__/pessoaFoto.test.ts`
- Create: `apps/crm/src/hooks/useFotoPessoa.ts`, `apps/crm/src/hooks/__tests__/useFotoPessoa.test.tsx`
- Modify: `apps/crm/src/store/team.ts` (type + new function), `apps/crm/src/context/AuthContext.tsx:40-47` (`avatar_url?: string | null` on `Profile`)

**Interfaces:**
- Consumes: `set_member_photo` from Task 1.
- Produces:
  - `export const MAX_PESSOA_FOTO_BYTES = 10 * 1024 * 1024;`
  - `export async function cropPessoaPhoto(file: File, maxSize = 512): Promise<Blob>` (JPEG 0.85).
  - `export type FotoAlvo = { kind: 'self'; userId: string } | { kind: 'membro'; membroId: number };`
  - `export async function setMemberPhoto(alvo: FotoAlvo, path: string | null): Promise<string | null>` in `store/team.ts`, re-exported from `@/store`.
  - `Membro.avatar_url: string | null`.
  - `export function useFotoPessoa(alvo: FotoAlvo): { uploading: boolean; pick: () => void; pickCamera: () => void; upload: (file: File) => Promise<boolean>; remove: () => Promise<void>; inputProps: InputProps; cameraInputProps: InputProps }` (`cameraInputProps` adds `capture: 'user'`).

- [ ] **Step 1: Failing tests.** `pessoaFoto.test.ts`: stub `createImageBitmap` (4032×3024) and a canvas whose `drawImage` spy records args; `crops the centered square` asserts `drawImage(bitmap, 504, 0, 3024, 3024, 0, 0, 512, 512)` and `toBlob` called with `'image/jpeg', 0.85`; `never upscales` (300×200 → canvas 200). `useFotoPessoa.test.tsx` (mock `@/lib/supabase` storage + `setMemberPhoto`): `rejects over 10MB` (toast `'A foto deve ter até 10 MB.'`, no upload); `accepts 9MB`; `uploads self to profiles/<uid>/<uuid>.jpg` with `contentType: 'image/jpeg'` and calls `setMemberPhoto({kind:'self',...}, path)`; `uploads membro to membros/<id>/`; `invalidates` `['membros']`, `['workspace-users']`, `['equipe-conversas']`, `['equipe-mensagens']`, `['equipe-chat-members']` and calls `refetchProfile()`; `holds unsaved work during upload`; `remove calls setMemberPhoto(alvo, null)`; error toast `'Erro ao enviar a foto.'`.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/lib/__tests__/pessoaFoto.test.ts apps/crm/src/hooks/__tests__/useFotoPessoa.test.tsx` → FAIL (modules missing).
- [ ] **Step 3: Implement** the four exports above. `setMemberPhoto` calls `supabase.rpc('set_member_photo', { p_membro_id, p_user_id, p_path })` with the unused target as `null`. Success toasts: `'Foto atualizada.'` / `'Foto removida.'`.
- [ ] **Step 4: Run** the same command → PASS; `npx tsc -p apps/crm/tsconfig.json --noEmit` shows only errors from `avatar_url: ''` writers (fixed in Task 5) or none.
- [ ] **Step 5: Commit** `feat(equipe): upload e corte da foto de perfil`

### Task 3: `PessoaAvatar` and `FotoPessoaEditor` components

**Files:**
- Create: `apps/crm/src/components/PessoaAvatar.tsx`, `apps/crm/src/components/__tests__/PessoaAvatar.test.tsx`
- Create: `apps/crm/src/components/FotoPessoaEditor.tsx`, `apps/crm/src/components/__tests__/FotoPessoaEditor.test.tsx`
- Modify: `apps/crm/style.css` (`.avatar img`/`.avatar--photo` rule: `object-fit: cover; overflow: hidden;`)

**Interfaces:**
- Consumes: `useFotoPessoa`, `FotoAlvo` (Task 2); `getInitials` (`@/lib/initials`), `avatarColorClass` (`@/lib/avatarColor`); `ActionSheet` (`@/components/mobile/ActionSheet`, actions with `immediate: true` for pickers).
- Produces:
  - `export function PessoaAvatar(props: { nome: string; fotoUrl?: string | null; seed?: string | number | null; size?: number; className?: string; alt?: string }): JSX.Element` — renders `<img className={cn('avatar avatar--photo', className)}>` when `fotoUrl` and no load error, else `<div className={cn('avatar', avatarColorClass(seed ?? nome), className)} aria-hidden>` with `getInitials(nome)`. `size` sets inline width/height (and font-size `size * 0.4`). `alt` defaults to `''`.
  - `export function FotoPessoaEditor(props: { alvo: FotoAlvo; nome: string; seed?: string | number | null; fotoUrl: string | null; variant: 'desktop' | 'phone'; descricao?: string }): JSX.Element`.

- [ ] **Step 1: Failing tests.** `PessoaAvatar`: `shows initials without photo` (`'Ana Lima'` → `'AL'`, color class from seed); `shows the photo`; `falls back on error` (`fireEvent.error(img)` → initials); `resets the error when fotoUrl changes` (rerender with a new URL → `img` again). `FotoPessoaEditor`: desktop renders camera button `aria-label` `'Alterar foto de <nome>'` (or `'Adicionar foto de <nome>'` without photo), buttons `'Alterar foto'`/`'Adicionar foto'` and `'Remover foto'` (only with photo), helper text `'JPG, PNG ou HEIC até 10 MB. A foto é recortada em quadrado.'`; `Remover foto` opens an AlertDialog titled `'Remover a foto?'` with description `'Volta a aparecer as iniciais.'` and confirm `'Remover'`; phone variant opens an ActionSheet titled `'Foto de perfil'` with `'Escolher da galeria'`, `'Tirar foto'`, `'Remover foto'` (destructive, only with photo).
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/components/__tests__/PessoaAvatar.test.tsx apps/crm/src/components/__tests__/FotoPessoaEditor.test.tsx` → FAIL.
- [ ] **Step 3: Implement.** Error state: `const [failedUrl, setFailedUrl] = useState<string | null>(null)`; show the image when `fotoUrl && fotoUrl !== failedUrl` (this is the reset). Layout follows the mockups (`Main.dc.html`, `Equipe.dc.html`, `Celular.dc.html` in https://claude.ai/artifact/D7Tg91XtipkJPo9hECsEoU).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(crm): PessoaAvatar e editor de foto`

### Task 4: Upload points: Perfil and Equipe/membro detail (desktop + phone), Equipe-area `''` writers

**Files:**
- Modify: `apps/crm/src/pages/configuracao/**/PerfilTab.tsx:145-149`, `.../PerfilPhone.tsx:125-129`, `.../ConfiguracaoIndex.tsx:66`, `.../MembrosTab.tsx:381-384`, `.../MembrosPhone.tsx:63-70` (display only)
- Modify: `apps/crm/src/pages/equipe/EquipePage.tsx:186,447-460`, `.../EquipePhone.tsx:233-236`, `.../MembroDetalhePage.tsx:130,169-172`, `.../MembroDetalhePhone.tsx:94-100`, `.../MembroFormDialog.tsx:208`
- Test: existing `__tests__` beside each file (`EquipePage.test.tsx`, `MembroDetalhePage.test.tsx`, `PerfilTab.test.tsx` — create the ones missing)

**Interfaces:**
- Consumes: `PessoaAvatar`, `FotoPessoaEditor` (Task 3), `FotoAlvo` (Task 2), `useAuth().profile.avatar_url`, `useAuth().can`.

- [ ] **Step 1: Failing tests.** `PerfilTab`: `shows the photo editor for self` (camera button `'Alterar foto de <nome>'`, alvo `{kind:'self', userId: profile.id}`). `MembroDetalhePage`: `shows the editor with equipe:editar` (alvo `{kind:'membro', membroId}`); `hides the editor without equipe:editar` (no camera button, avatar still shown). `EquipePage`: `renders member photos` (an `img` for a membro with `avatar_url`); update the existing `''` assertions at `EquipePage.test.tsx:157,212,280,435,503` so created/imported rows send no `avatar_url` key.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/equipe apps/crm/src/pages/configuracao` → FAIL.
- [ ] **Step 3: Implement.** Perfil (desktop/phone) gets `FotoPessoaEditor` above the name fields with `descricao` `'Aparece para a sua equipe em todo o CRM: Entregas, Tarefas, Agenda e Mensagens. Os clientes não veem.'`. Member detail (desktop/phone) gets it when `can('equipe','editar')`, else `PessoaAvatar`. Phone member detail exposes it from the existing "…" menu, mirroring `ClienteSectionsIndex`'s use of `useClienteFoto`. Other listed lines swap their initials markup for `PessoaAvatar` with the same size. Drop `avatar_url: ''` from `MembroFormDialog` and the import in `EquipePage`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(equipe): editar foto no perfil e na equipe`

### Task 5: Surfaces with initials only: shell, Entregas, Tarefas, Dashboard

**Files:**
- Modify: `apps/crm/src/components/layout/Sidebar.tsx:404-408`, `.../MobileNav.tsx:331-336`
- Modify: Entregas `WorkflowCard.tsx:367-370,441-444`, `PostProcessCard.tsx:398-407`, `PostsKanbanView.tsx:353-355`, `EntregasFilters.tsx:138-142`, `ResponsaveisPanel.tsx:93-97`, `phone/cardMenus.tsx:232-235`
- Modify: Tarefas `TarefaCard.tsx:131-135,183-186`, `TarefaDetailSheet.tsx:319-322,372-375`, `ListView.tsx:121-125`, `phone/parts.tsx:90-112`
- Modify: Dashboard `todayAgenda.ts:55,210` (carry `avatar_url`), `TodayCard.tsx:96`, `InicioPrazos.tsx:306-308`
- Test: existing tests beside them; `ResponsaveisPanel.test.tsx:8` fixture `avatar_url: ''` → `null`; `store.crud-writes.test.ts:247,259` `''` expectations removed.

**Interfaces:**
- Consumes: `PessoaAvatar` (Task 3), `Membro.avatar_url: string | null` (Task 2), `useAuth().profile.avatar_url` for the shell.

- [ ] **Step 1: Failing tests.** One per area, each rendering a person with `avatar_url: 'https://x.test/a.jpg'` and asserting an `img` with that `src`, plus one with `null` asserting initials: `Sidebar shows the user photo`, `WorkflowCard shows the assignee photo`, `EntregasFilters shows photos in the responsável list`, `TarefaCard shows the assignee photo`, `TodayCard shows the responsável photo` (and `todayAgenda` test: responsável keeps `avatar_url`).
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/components/layout apps/crm/src/pages/entregas apps/crm/src/pages/tarefas apps/crm/src/pages/dashboard` → FAIL.
- [ ] **Step 3: Implement**: replace each initials block with `PessoaAvatar` keeping the size and seed each site uses today (seed = membro id where the site has it).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(crm): foto da equipe em Entregas, Tarefas e Início`

### Task 6: Surfaces that already render images: migrate to `PessoaAvatar`

**Files:**
- Modify: Agenda `AgendaSidebar.tsx`, `AgendaFiltrosSheet.tsx`, `PessoasCombobox.tsx`, `EventoPopover.tsx`; `MentionList.tsx:41-61`; `PostCommentPopover.tsx:38-66`; `EquipeTable.tsx:37-64` + the phone analytics `Avatar` (FluxosPhone); chat `EquipeConversaAvatar`, `EquipeThread.tsx`, `phone/EquipeThreadPhone.tsx`, `NovaConversaDialog.tsx`, `EquipeDetalhesSheet.tsx`; `mensagens/components/Avatars.tsx` (`AutorAvatar`, team side only)
- Test: existing tests beside them.

**Interfaces:**
- Consumes: `PessoaAvatar` (Task 3).

- [ ] **Step 1: Failing tests.** `PostCommentPopover resolves the membro by crm_user_id` (author with no profile photo, membro with `crm_user_id = author` and a photo → that photo; a membro whose `user_id` matches but `crm_user_id` does not → not used). `EquipeThread falls back to initials when the photo fails` (`fireEvent.error`). Existing image assertions in these suites keep passing.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/calendario apps/crm/src/pages/mensagens apps/crm/src/components` → the two new tests FAIL.
- [ ] **Step 3: Implement**: swap each site's own `<img>`/initials pair for `PessoaAvatar` (same size, same seed); fix `resolveAuthor` to match `crm_user_id`. The `https`-only guard in the analytics `Avatar` goes away (URLs now come only from the RPC).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `refactor(crm): avatares da equipe passam por PessoaAvatar`

### Task 7: Hub and MCP: no team photo in the Hub, no `''` from MCP

**Files:**
- Modify: `supabase/functions/hub-mensagens/handler.ts:81-93`, `supabase/functions/__tests__/hub-mensagens_test.ts`
- Modify: `apps/hub/src/pages/MensagensPage.tsx:187-191`, `apps/hub/src/pages/__tests__/mensagensPage.test.tsx:65,143`
- Modify: `supabase/functions/mcp/queries.ts:289`, `supabase/functions/__tests__/mcp-import_test.ts:197`

- [ ] **Step 1: Failing tests.** `hub-mensagens`: `nulls author_avatar_url for every item` (RPC stub returns a URL → response has `null`). Hub page: `shows team initials even with author_avatar_url` (flip the existing image assertion). MCP: `create_member does not send avatar_url` (insert payload has no `avatar_url` key).
- [ ] **Step 2: Run** `deno test --no-check supabase/functions/__tests__/hub-mensagens_test.ts supabase/functions/__tests__/mcp-import_test.ts` and `npx vitest run apps/hub/src/pages/__tests__/mensagensPage.test.tsx` → FAIL.
- [ ] **Step 3: Implement**: map items to `{ ...item, author_avatar_url: null }`; Hub page renders initials for team authors unconditionally; drop `avatar_url: ""` from the MCP insert.
- [ ] **Step 4: Run** the same commands → PASS; `npm run check:functions` passes. Then `git checkout deno.lock && npm ci`.
- [ ] **Step 5: Commit** `fix(hub): foto da equipe não chega ao Hub`

### Task 8: Full battery, browser check, PR, deploy

- [ ] **Step 1:** `npm run lint`, `npm run format:check`, the four `tsc` (`apps/crm`, `apps/hub`, `apps/admin` with `--noEmit`, `tsconfig.scripts.json`), `npm run test`, `npm run check:functions`, `npm run test:functions`, then `git checkout deno.lock && npm ci`. All green.
- [ ] **Step 2:** Browser check (local CRM with stubbed data per memory `reference_local_browser_verify_stub_edge_functions`): Perfil upload flow, Equipe detail as owner and as agent, Entregas card, chat bubble, dark mode; phone width 390.
- [ ] **Step 3:** Push, open PR. Before merge: `db push` the migration to staging then prod (disposable checkout with #669's `20261015000001/2` files + `--include-all`, per memory), deploy `hub-mensagens` and `mcp` with `--no-verify-jwt --use-api --project-ref <ref>`, smoke 401 + `functions download` diff. Prod steps need the user's go-ahead.
