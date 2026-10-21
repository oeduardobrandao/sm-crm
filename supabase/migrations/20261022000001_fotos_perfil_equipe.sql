-- =============================================================
-- Fotos de perfil da equipe.
-- Spec: docs/superpowers/specs/2026-10-21-fotos-de-perfil-da-equipe-design.md
--
-- One photo per person:
--   * login (profiles row)      -> profiles.avatar_url
--   * membro without a login    -> membros.avatar_url
--   * membro linked to a login  -> membros.avatar_url is a COPY of that
--                                  login's profiles.avatar_url, kept by the
--                                  database (trg_membros_link_photo and
--                                  set_member_photo), never by the client.
--
-- set_member_photo() is the ONLY client-reachable writer of either column:
--   * profiles.avatar_url never had a client UPDATE grant and still has none
--     (20260729000002_profiles_write_lockdown.sql post-condition untouched).
--   * membros.avatar_url loses its UPDATE grant here, and a BEFORE INSERT
--     trigger forces it to NULL for every non-trusted caller.
--
-- Stored value is NULL, never ''.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Normalize '' to NULL. The chat RPCs read
--    COALESCE(mb.avatar_url, p.avatar_url), which does not fall back to the
--    profile when the membro carries ''. There is no column default to drop
--    (baseline: `avatar_url text`, no DEFAULT); '' only ever came from the
--    client writers, which stop sending it in the same release.
-- -------------------------------------------------------------
UPDATE public.membros  SET avatar_url = NULL WHERE avatar_url = '';
UPDATE public.profiles SET avatar_url = NULL WHERE avatar_url = '';

-- -------------------------------------------------------------
-- 1b. Drop untrusted legacy membro photos. Until this migration any agent
--     could write membros.avatar_url to any string (step 2 below closes
--     that), so a value that is not one of OUR public avatar URLs cannot be
--     trusted: the link trigger would otherwise carry it to a profile and to
--     every copy of that person. Only the base this project's own RPC builds
--     (Vault project_url + /storage/v1/object/public/avatars/) survives.
--     Without project_url there is no way to tell ours from theirs, so the
--     step is skipped (the link trigger then never raises a membro photo
--     either, see step 4).
-- -------------------------------------------------------------
DO $$
DECLARE
  v_base text;
  v_n    int;
BEGIN
  SELECT rtrim(ds.decrypted_secret, '/') INTO v_base
    FROM vault.decrypted_secrets ds WHERE ds.name = 'project_url';
  IF v_base IS NULL OR v_base = '' THEN
    RAISE NOTICE 'fotos_perfil_equipe: Vault project_url missing, legacy membros.avatar_url left as is';
    RETURN;
  END IF;

  UPDATE public.membros
     SET avatar_url = NULL
   WHERE avatar_url IS NOT NULL
     AND NOT starts_with(avatar_url, v_base || '/storage/v1/object/public/avatars/');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'fotos_perfil_equipe: % legacy membros.avatar_url outside avatars/ set to NULL', v_n;
END $$;

-- -------------------------------------------------------------
-- 2. Drop avatar_url from the membros UPDATE allowlist.
--    Previous list (20260430000001_notifications.sql):
--      (nome, cargo, tipo, custo_mensal, avatar_url, data_pagamento)
--    membros_update RLS is "same conta" only, so with that grant any agent
--    could point a colleague's photo at an arbitrary host.
--    NOTE: any new column added to `membros` must be appended to this GRANT
--    or it will be silently read-only for the `authenticated` role.
-- -------------------------------------------------------------
REVOKE UPDATE ON public.membros FROM authenticated;
GRANT UPDATE (nome, cargo, tipo, custo_mensal, data_pagamento)
  ON public.membros TO authenticated;

-- -------------------------------------------------------------
-- 3. INSERT can never carry a client-chosen photo.
--    membros_insert RLS is "same conta" only and does not restrict columns,
--    the same hole 20260817000001 closed for clientes.foto_url.
--
--    SECURITY INVOKER on purpose: under SECURITY DEFINER current_user would
--    always read back the function owner (postgres) and the trusted-caller
--    branch below would fire for everyone. Same whitelist as
--    guard_financial_write() (20260728000002). A SECURITY DEFINER function
--    owned by postgres that inserts membros is treated as trusted, which is
--    the documented consequence of that whitelist; no such function exists
--    today.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.membros_avatar_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() = 'service_role'
     OR current_user IN ('postgres', 'supabase_admin') THEN
    NEW.avatar_url := NULLIF(NEW.avatar_url, '');
  ELSE
    NEW.avatar_url := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_membros_avatar_insert ON public.membros;
CREATE TRIGGER trg_membros_avatar_insert
  BEFORE INSERT ON public.membros
  FOR EACH ROW
  EXECUTE FUNCTION public.membros_avatar_insert_guard();

-- -------------------------------------------------------------
-- 4. Keep the copy right when crm_user_id changes.
--    Covers every path that writes crm_user_id (set_membro_crm_user,
--    accept_workspace_invite's link step, _shared/invite-actions.ts with the
--    service-role client) without touching any of them.
--
--    * same value (set_membro_crm_user re-sets the current one): no-op.
--    * unlink (NEW null): the membro keeps the copy it had.
--    * login NOT a current member of this membro's conta (set_membro_crm_user
--      does not check membership): nothing crosses in either direction. The
--      profile photo is not copied into a conta the person is not in, and the
--      membro photo is not raised to their global profile (same rule as
--      set_member_photo's membro target). First link keeps the row's own
--      photo; relink sets NULL (the row must not keep the previous person's
--      face under the new link).
--    * first link (OLD null), member: the profile photo wins; if the profile
--      has none and the membro has one, the membro photo is raised to the
--      profile and to the person's other membros in the contas they are
--      still in (one person, one photo). Raised ONLY when it is a URL that
--      set_member_photo itself could have produced for THIS row:
--      {project_url}/storage/v1/object/public/avatars/membros/{NEW.id}/...
--      Anything else (legacy value written before this migration closed the
--      UPDATE grant, another row's folder) stays on the row only. No Vault
--      project_url means nothing is ever raised.
--    * relink to a different person, member: the membro takes the new
--      person's photo, or NULL. The membro photo is NEVER raised here, or the
--      previous person's face would land on the new person's profile.
--
--    SECURITY DEFINER: it writes profiles (no client grant) and other membros
--    rows. Nested UPDATEs only touch avatar_url, so they do not re-fire this
--    trigger (UPDATE OF crm_user_id).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.membros_link_photo_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile_photo text;
  v_membro_photo  text;
  v_is_member     boolean;
  v_base          text;
BEGIN
  IF OLD.crm_user_id IS NOT DISTINCT FROM NEW.crm_user_id THEN
    RETURN NEW;
  END IF;

  IF NEW.crm_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_is_member := EXISTS (SELECT 1 FROM public.workspace_members wm
                          WHERE wm.user_id = NEW.crm_user_id
                            AND wm.workspace_id = NEW.conta_id);

  IF NOT v_is_member THEN
    IF OLD.crm_user_id IS NOT NULL THEN
      NEW.avatar_url := NULL;
    ELSE
      NEW.avatar_url := NULLIF(NEW.avatar_url, '');
    END IF;
    RETURN NEW;
  END IF;

  SELECT NULLIF(p.avatar_url, '') INTO v_profile_photo
    FROM public.profiles p WHERE p.id = NEW.crm_user_id;

  IF OLD.crm_user_id IS NULL THEN
    v_membro_photo := NULLIF(NEW.avatar_url, '');
    SELECT rtrim(ds.decrypted_secret, '/') INTO v_base
      FROM vault.decrypted_secrets ds WHERE ds.name = 'project_url';
    IF v_profile_photo IS NOT NULL THEN
      NEW.avatar_url := v_profile_photo;
    ELSIF v_membro_photo IS NOT NULL
          AND v_base IS NOT NULL AND v_base <> ''
          AND starts_with(v_membro_photo, v_base || '/storage/v1/object/public/avatars/membros/'
                                          || NEW.id::text || '/') THEN
      UPDATE public.profiles
         SET avatar_url = v_membro_photo
       WHERE id = NEW.crm_user_id AND avatar_url IS NULL;
      UPDATE public.membros m
         SET avatar_url = v_membro_photo
       WHERE m.crm_user_id = NEW.crm_user_id
         AND m.id <> NEW.id
         AND m.conta_id IN (SELECT wm.workspace_id FROM public.workspace_members wm
                             WHERE wm.user_id = NEW.crm_user_id);
      NEW.avatar_url := v_membro_photo;
    ELSE
      NEW.avatar_url := v_membro_photo;
    END IF;
  ELSE
    NEW.avatar_url := v_profile_photo;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_membros_link_photo ON public.membros;
CREATE TRIGGER trg_membros_link_photo
  BEFORE UPDATE OF crm_user_id ON public.membros
  FOR EACH ROW
  EXECUTE FUNCTION public.membros_link_photo_sync();

-- -------------------------------------------------------------
-- 5. set_member_photo(p_membro_id, p_user_id, p_path) -> stored URL | NULL
--
--    Exactly one target. p_path NULL removes the photo.
--    * p_user_id: own photo only (p_user_id = auth.uid()). Path must be
--      profiles/{uid}/{file}. Writes profiles.avatar_url and the person's
--      membros in the contas they are still in (workspace_members); rows in
--      contas they left keep the copy they had.
--    * p_membro_id: needs equipe:editar in the membro's conta. Path must be
--      membros/{id}/{file}, even when the membro has a login. If the membro's
--      login is still a member of this conta, the write goes to that login's
--      profile and copies in its current contas; otherwise only this row.
--    The path must name an object in bucket `avatars` uploaded by the caller
--    (storage.objects.owner, or owner_id on storage-api versions that only
--    fill the newer column; read through to_jsonb so this compiles and runs
--    where owner_id does not exist, as in CI's storage-less stack). The URL is
--    built here from the Vault project_url, so neither host nor path comes
--    from the client as a URL.
--
--    Errors: 'Insufficient permissions' (also for a nonexistent membro: no
--    existence oracle), 'invalid_target', 'invalid_photo_path',
--    'photo_not_found', 'project_url_missing'.
--
--    File name is restricted to [A-Za-z0-9][A-Za-z0-9._-]* (the client sends
--    {uuid}.jpg): no nested segments, no '..', nothing that needs URL
--    escaping.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_member_photo(
  p_membro_id bigint,
  p_user_id   uuid,
  p_path      text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_conta       uuid;
  v_login       uuid;
  v_target_user uuid;
  v_prefix      text;
  v_base        text;
  v_url         text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  IF (p_membro_id IS NULL) = (p_user_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_target';
  END IF;

  IF p_user_id IS NOT NULL THEN
    IF p_user_id <> v_uid THEN
      RAISE EXCEPTION 'Insufficient permissions';
    END IF;
    v_target_user := v_uid;
    v_prefix := 'profiles/' || v_uid::text || '/';
  ELSE
    SELECT m.conta_id, m.crm_user_id INTO v_conta, v_login
      FROM public.membros m WHERE m.id = p_membro_id;
    IF v_conta IS NULL
       OR NOT public.has_permission_for(v_uid, v_conta, 'equipe', 'editar') THEN
      RAISE EXCEPTION 'Insufficient permissions';
    END IF;
    IF v_login IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.workspace_members wm
          WHERE wm.user_id = v_login AND wm.workspace_id = v_conta) THEN
      v_target_user := v_login;
    END IF;
    v_prefix := 'membros/' || p_membro_id::text || '/';
  END IF;

  IF p_path IS NOT NULL THEN
    -- v_prefix holds only [a-z0-9/-], so it is safe inside the pattern.
    IF p_path !~ ('^' || v_prefix || '[A-Za-z0-9][A-Za-z0-9._-]*$') THEN
      RAISE EXCEPTION 'invalid_photo_path';
    END IF;

    IF NOT EXISTS (
         SELECT 1 FROM storage.objects o
          WHERE o.bucket_id = 'avatars'
            AND o.name = p_path
            AND (o.owner = v_uid
                 OR to_jsonb(o) ->> 'owner_id' = v_uid::text)) THEN
      RAISE EXCEPTION 'photo_not_found';
    END IF;

    SELECT rtrim(ds.decrypted_secret, '/') INTO v_base
      FROM vault.decrypted_secrets ds WHERE ds.name = 'project_url';
    IF v_base IS NULL OR v_base = '' THEN
      RAISE EXCEPTION 'project_url_missing';
    END IF;

    v_url := v_base || '/storage/v1/object/public/avatars/' || p_path;
  END IF;

  IF v_target_user IS NOT NULL THEN
    UPDATE public.profiles SET avatar_url = v_url WHERE id = v_target_user;
    UPDATE public.membros m
       SET avatar_url = v_url
     WHERE m.crm_user_id = v_target_user
       AND m.conta_id IN (SELECT wm.workspace_id FROM public.workspace_members wm
                           WHERE wm.user_id = v_target_user);
  END IF;

  IF p_membro_id IS NOT NULL THEN
    UPDATE public.membros SET avatar_url = v_url WHERE id = p_membro_id;
  END IF;

  RETURN v_url;
END;
$$;

REVOKE ALL ON FUNCTION public.set_member_photo(bigint, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_photo(bigint, uuid, text) TO authenticated;

-- Trigger functions are not callable as RPCs (RETURNS trigger), but keep the
-- ACLs explicit like the rest of the repo's DEFINER functions.
REVOKE ALL ON FUNCTION public.membros_link_photo_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.membros_avatar_insert_guard() FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------------
-- 6. Storage: INSERT only (new {uuid}.jpg every time, no upsert), no UPDATE
--    policy. Both start with bucket_id = 'avatars'.
--
--    The membros policy uses the has_permission() wrapper (current user +
--    active workspace), NOT has_permission_for(): that one is executable
--    only by service_role (20260903000002) and a policy runs as the caller.
--    The membro must belong to the caller's active workspace, which is the
--    workspace has_permission() checks.
--
--    The bigint cast is guarded so a non-numeric folder is a clean denial
--    rather than a cast error.
-- -------------------------------------------------------------
DROP POLICY IF EXISTS pessoa_photo_self_insert ON storage.objects;
CREATE POLICY pessoa_photo_self_insert
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = 'profiles'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS pessoa_photo_membro_insert ON storage.objects;
CREATE POLICY pessoa_photo_membro_insert
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = 'membros'
    AND (CASE WHEN (storage.foldername(name))[2] ~ '^[0-9]{1,18}$'
              THEN ((storage.foldername(name))[2])::bigint
         END) IN (
      SELECT m.id FROM public.membros m
       WHERE m.conta_id = public.get_my_conta_id()
    )
    AND public.has_permission('equipe', 'editar')
  );

-- -------------------------------------------------------------
-- Post-conditions
-- -------------------------------------------------------------
DO $$
DECLARE
  v_actual   text[];
  v_expected text[] := ARRAY['cargo', 'custo_mensal', 'data_pagamento', 'nome', 'tipo'];
BEGIN
  SELECT array_agg(column_name::text ORDER BY column_name) INTO v_actual
    FROM information_schema.column_privileges
   WHERE table_schema = 'public' AND table_name = 'membros'
     AND grantee = 'authenticated' AND privilege_type = 'UPDATE';
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'authenticated UPDATE columns on membros are %, expected %',
      coalesce(array_to_string(v_actual, ','), '<none>'),
      array_to_string(v_expected, ',');
  END IF;

  IF has_column_privilege('authenticated', 'public.profiles', 'avatar_url', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated holds UPDATE on profiles.avatar_url';
  END IF;

  IF has_function_privilege('anon', 'public.set_member_photo(bigint, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute set_member_photo';
  END IF;
END $$;
