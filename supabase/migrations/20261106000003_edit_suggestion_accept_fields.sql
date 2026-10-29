-- =====================================================================
-- Sugestões de edição sem auto-recusa, parte 3: aceitar por campo.
-- Spec: docs/superpowers/specs/2026-10-29-edit-suggestion-no-auto-reject-design.md §5.
--
-- Até aqui accept_edit_suggestion gravava os três campos da sugestão, mudados ou
-- não: uma sugestão só de texto devolvia ao post a legenda que o Hub tinha visto,
-- apagando uma edição da equipe. Agora:
--   p_fields text[]  campos lógicos a aplicar: 'texto' (conteudo + conteudo_plain)
--                    e 'legenda' (ig_caption).
-- A função só aplica o que o cliente de fato mudou (changed_fields) e pode ser
-- pedida só para um subconjunto.
--
-- Conflito = a equipe mudou, depois da base do cliente (original_*), um campo que
-- o cliente também mudou:
--   texto    COALESCE(conteudo_plain,'') difere OU o conjunto de r2Key de imagens
--            inline difere (formatação sozinha não conta: o round-trip do TipTap
--            reescreve o jsonb)
--   legenda  COALESCE(ig_caption,'') difere
-- p_fields NULL = todos os campos mudados, mas só se não houver conflito; com
-- conflito levanta suggestion_conflict (um CRM antigo, de 2 args, não sobrescreve
-- uma edição da equipe). Interseção vazia levanta no_fields.
--
-- Corpo de 20261105000001 (checagem de workspace, ordem de locks post -> sugestão,
-- suggestion_changed, app.*) mantido. A assinatura muda: DROP + CREATE, grants
-- reafirmados.
-- =====================================================================

drop function if exists public.accept_edit_suggestion(bigint, timestamptz);

create function public.accept_edit_suggestion(
  p_suggestion_id       bigint,
  p_expected_updated_at timestamptz default null,
  p_fields              text[]      default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_id      bigint;
  v_conta_id     uuid;
  v_post         record;
  v_suggestion   record;
  v_texto_chg    boolean;
  v_legenda_chg  boolean;
  v_texto_conf   boolean;
  v_legenda_conf boolean;
  v_do_texto     boolean;
  v_do_legenda   boolean;
begin
  select post_id, conta_id into v_post_id, v_conta_id
    from post_edit_suggestions
    where id = p_suggestion_id;

  if v_post_id is null
     or (coalesce(auth.role(), '') <> 'service_role'
         and v_conta_id is distinct from get_my_conta_id()) then
    raise exception 'Suggestion not found';
  end if;

  select conteudo, conteudo_plain, ig_caption into v_post
    from workflow_posts
    where id = v_post_id
    for update;

  select * into v_suggestion
    from post_edit_suggestions
    where id = p_suggestion_id
    for update;

  if v_suggestion is null then
    raise exception 'Suggestion not found';
  end if;

  if v_suggestion.status <> 'pending' then
    raise exception 'Suggestion is not pending (status: %)', v_suggestion.status;
  end if;

  if p_expected_updated_at is not null
     and v_suggestion.updated_at is distinct from p_expected_updated_at then
    raise exception 'suggestion_changed' using errcode = 'P0001';
  end if;

  -- campos lógicos que o cliente mudou
  v_texto_chg   := v_suggestion.changed_fields && array['conteudo', 'conteudo_plain'];
  v_legenda_chg := 'ig_caption' = any (v_suggestion.changed_fields);

  -- conflito: a equipe mexeu, depois da base do cliente, num campo que o cliente mudou
  v_texto_conf := v_texto_chg and (
    coalesce(v_post.conteudo_plain, '') <> coalesce(v_suggestion.original_conteudo_plain, '')
    or _tiptap_inline_image_keys(v_post.conteudo)
         is distinct from _tiptap_inline_image_keys(v_suggestion.original_conteudo)
  );
  v_legenda_conf := v_legenda_chg
    and coalesce(v_post.ig_caption, '') <> coalesce(v_suggestion.original_ig_caption, '');

  if p_fields is null then
    if v_texto_conf or v_legenda_conf then
      raise exception 'suggestion_conflict' using errcode = 'P0001';
    end if;
    v_do_texto   := v_texto_chg;
    v_do_legenda := v_legenda_chg;
  else
    v_do_texto   := v_texto_chg   and 'texto'   = any (p_fields);
    v_do_legenda := v_legenda_chg and 'legenda' = any (p_fields);
  end if;

  if not (v_do_texto or v_do_legenda) then
    raise exception 'no_fields' using errcode = 'P0001';
  end if;

  perform set_config('app.accepting_edit_suggestion', v_suggestion.id::text, true);

  -- source is forced to 'client' (the TEXT is client-authored), while
  -- actor_user_id still resolves to auth.uid() via the content-version
  -- trigger's fallback (see 20260923000001).
  perform set_config('app.event_source', 'client', true);
  perform set_config('app.post_edit_suggestion_id', v_suggestion.id::text, true);

  -- Um UPDATE por combinação, para não reatribuir uma coluna que não foi escolhida.
  -- texto mantém o COALESCE: há sugestões com suggested_conteudo NULL (legenda de Story).
  if v_do_texto and v_do_legenda then
    update workflow_posts set
      conteudo       = coalesce(v_suggestion.suggested_conteudo, conteudo),
      conteudo_plain = coalesce(v_suggestion.suggested_conteudo_plain, conteudo_plain),
      ig_caption     = v_suggestion.suggested_ig_caption
    where id = v_suggestion.post_id;
  elsif v_do_texto then
    update workflow_posts set
      conteudo       = coalesce(v_suggestion.suggested_conteudo, conteudo),
      conteudo_plain = coalesce(v_suggestion.suggested_conteudo_plain, conteudo_plain)
    where id = v_suggestion.post_id;
  else
    update workflow_posts set
      ig_caption = v_suggestion.suggested_ig_caption
    where id = v_suggestion.post_id;
  end if;

  update post_edit_suggestions set
    status      = 'accepted',
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = p_suggestion_id;
end;
$$;

revoke all on function public.accept_edit_suggestion(bigint, timestamptz, text[]) from public, anon;
grant execute on function public.accept_edit_suggestion(bigint, timestamptz, text[]) to authenticated, service_role;
