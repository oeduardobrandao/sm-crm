-- supabase/migrations/20261008000002_agenda_convidados.sql
-- Agenda (sub-projeto 4, migration B): external guests invited by e-mail. A
-- guest is not a member nor the client: it gets the invite with .ics and a
-- link to a public page (/convite/:token) where it confirms or declines each
-- occurrence. The client e-mail queue learns a second recipient kind.
-- Spec: docs/superpowers/specs/2026-10-07-agenda-camadas-convidados-design.md §3
-- Plan: docs/superpowers/plans/2026-10-07-agenda-camadas-convidados.md (Task 1 + amendments)
-- Rollback: step 4c of docs/superpowers/specs/assets/2026-10-05-agenda-rollback.sql
--
-- Sections: (1) tables, (2) queue columns, (3) notification type,
-- (4) sequencia bump + batch enqueue, (5) agenda_cliente_enfileirar with a
-- guest recipient, (6) agenda_definir_convidados, (7) the write RPCs with the
-- guest hooks, (8) the recipient-aware claim, (9) the convite RPCs,
-- (10) agenda_listar.convidados, (11) grants + assertions.
--
-- Replaced functions are copied verbatim from 20261007000001_agenda_hub.sql
-- (the newest definitions); every change is marked "-- [convidados]". This file
-- references nothing from 20261008000001_agenda_hub_periodo.sql.
--
-- One bump per write (amendment 7): agenda_cliente_enfileirar no longer bumps
-- agenda_ocorrencias.sequencia. Each write RPC builds every recipient's list
-- first (client and guests), then agenda_envios_enfileirar bumps the union of
-- their ids ONCE and patches each list with the new value before enqueueing.

-- ============ (1) TABLES ============

-- Guests of a series (series field, like the participants: it changes with
-- scope todas/seguintes). Removal is logical (removido_em) so the cancellation
-- e-mail goes out and the old link answers "not available"; deleting the
-- series cascades. A seguintes split copies the active guests to the new
-- series with the SAME token (and the source row's criado_em/adicionado_por),
-- so one link shows head and tail; removed and re-added = new row, new token.
CREATE TABLE public.agenda_convidados (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conta_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  evento_id bigint NOT NULL,
  email text NOT NULL CHECK (email = lower(email) AND char_length(email) <= 254),
  nome text NULL CHECK (nome IS NULL OR char_length(nome) <= 120),
  token text NOT NULL CHECK (token ~ '^[0-9a-f]{64}$'),
  adicionado_por uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  removido_em timestamptz NULL,
  CONSTRAINT agenda_convidados_id_conta_uq UNIQUE (id, conta_id),
  CONSTRAINT agenda_convidados_evento_fk FOREIGN KEY (evento_id, conta_id)
    REFERENCES public.agenda_eventos(id, conta_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX agenda_convidados_email_uq ON public.agenda_convidados (evento_id, email) WHERE removido_em IS NULL;
CREATE UNIQUE INDEX agenda_convidados_evento_token_uq ON public.agenda_convidados (evento_id, token) WHERE removido_em IS NULL;
CREATE INDEX agenda_convidados_token_idx ON public.agenda_convidados (token) WHERE removido_em IS NULL;
CREATE INDEX agenda_convidados_conta_criado_idx ON public.agenda_convidados (conta_id, criado_em);
-- the platform-wide daily cap scans the last 24 h of every workspace
CREATE INDEX agenda_convidados_criado_idx ON public.agenda_convidados (criado_em);

-- A guest's answer per occurrence. Effective answer = resposta when
-- inicio_respondido = the occurrence's inicio (timestamptz comparison) and the
-- guest row is active; otherwise "aguardando". A split re-points the rows of
-- the moved occurrences to the guest's copy.
CREATE TABLE public.agenda_respostas_convidado (
  ocorrencia_id bigint NOT NULL,
  convidado_id bigint NOT NULL,
  conta_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  resposta text NOT NULL CHECK (resposta IN ('sim', 'nao')),
  respondido_em timestamptz NOT NULL,
  inicio_respondido timestamptz NOT NULL,
  PRIMARY KEY (ocorrencia_id, convidado_id),
  CONSTRAINT agenda_respostas_convidado_ocorrencia_fk FOREIGN KEY (ocorrencia_id, conta_id)
    REFERENCES public.agenda_ocorrencias(id, conta_id) ON DELETE CASCADE,
  CONSTRAINT agenda_respostas_convidado_convidado_fk FOREIGN KEY (convidado_id, conta_id)
    REFERENCES public.agenda_convidados(id, conta_id) ON DELETE CASCADE
);
CREATE INDEX agenda_respostas_convidado_convidado_idx ON public.agenda_respostas_convidado (convidado_id);

-- Unsubscribe blocklist: that workspace sends no more Agenda e-mail to that
-- address (the invite page keeps working).
CREATE TABLE public.agenda_convidados_bloqueio (
  conta_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email) AND char_length(email) <= 254),
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conta_id, email)
);

-- service_role and the DEFINER RPCs only (pattern of 20261007000001)
ALTER TABLE public.agenda_convidados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_respostas_convidado ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_convidados_bloqueio ENABLE ROW LEVEL SECURITY;
CREATE POLICY agenda_convidados_service_role_bypass ON public.agenda_convidados
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY agenda_respostas_convidado_service_role_bypass ON public.agenda_respostas_convidado
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY agenda_convidados_bloqueio_service_role_bypass ON public.agenda_convidados_bloqueio
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.agenda_convidados, public.agenda_respostas_convidado, public.agenda_convidados_bloqueio
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.agenda_convidados, public.agenda_respostas_convidado, public.agenda_convidados_bloqueio
  TO service_role;
REVOKE ALL ON SEQUENCE public.agenda_convidados_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.agenda_convidados_id_seq TO service_role;

-- ============ (2) QUEUE: TWO RECIPIENT KINDS ============
-- An item goes to the client (cliente_id) or to one guest row (convidado_id +
-- the address at enqueue time). No FK to the guest, like evento_id: a
-- cancellation must survive the removal or the series DELETE. The client FK
-- stays (a NULL cliente_id is not checked). Guests never get remarcacao_*.
ALTER TABLE public.agenda_emails_cliente ALTER COLUMN cliente_id DROP NOT NULL;
ALTER TABLE public.agenda_emails_cliente
  ADD COLUMN convidado_id bigint NULL,
  ADD COLUMN convidado_email text NULL;
ALTER TABLE public.agenda_emails_cliente
  ADD CONSTRAINT agenda_emails_destinatario_ck CHECK (
    num_nonnulls(cliente_id, convidado_id) = 1 AND ((convidado_id IS NULL) = (convidado_email IS NULL))),
  ADD CONSTRAINT agenda_emails_convidado_tipo_ck CHECK (
    convidado_id IS NULL OR tipo IN ('convite', 'alteracao', 'cancelamento'));
-- sibling of agenda_emails_cliente_mescla_idx (cliente_id, evento_id)
CREATE INDEX agenda_emails_cliente_mescla_convidado_idx ON public.agenda_emails_cliente (convidado_id, evento_id) WHERE status = 'pendente';

-- ============ (3) NOTIFICATION TYPE event_guest_rsvp ============
-- Lists copied from 20261007000001_agenda_hub.sql (the most recent
-- definitions), only APPENDING event_guest_rsvp (e-mail eligible: team
-- digest). This file is now the most recent definition: the next migration
-- copies FROM HERE.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'post_approved', 'post_correction', 'post_message',
    'idea_submitted', 'briefing_answered',
    'step_activated', 'step_completed', 'post_assigned',
    'workflow_completed', 'deadline_approaching',
    'invite_accepted', 'member_role_changed', 'member_removed',
    'post_edit_suggestion', 'task_assigned', 'client_message',
    'mention', 'post_status_automation',
    'instagram_connected_by_client',
    'post_publish_failed', 'storage_autoclean_report',
    'instagram_automation_failed',
    'event_invited', 'event_updated', 'event_cancelled', 'event_rsvp', 'event_reminder',
    'event_client_rsvp', 'event_reschedule_requested', 'event_guest_rsvp'
  )
);

ALTER TABLE public.notification_inapp_prefs DROP CONSTRAINT notification_inapp_prefs_type_check;
ALTER TABLE public.notification_inapp_prefs ADD CONSTRAINT notification_inapp_prefs_type_check CHECK (type IN (
  'post_approved','post_correction','post_message','post_edit_suggestion',
  'idea_submitted','briefing_answered','step_activated','step_completed',
  'post_assigned','task_assigned','workflow_completed','deadline_approaching',
  'invite_accepted','member_role_changed','member_removed','client_message',
  'mention','post_status_automation','instagram_connected_by_client',
  'post_publish_failed','storage_autoclean_report','instagram_automation_failed',
  'event_invited','event_updated','event_cancelled','event_rsvp','event_reminder',
  'event_client_rsvp','event_reschedule_requested','event_guest_rsvp',
  '__all__'
));

ALTER TABLE public.notification_email_prefs DROP CONSTRAINT notification_email_prefs_type_check;
ALTER TABLE public.notification_email_prefs ADD CONSTRAINT notification_email_prefs_type_check CHECK (type IN (
  'post_approved','post_publish_failed','post_correction','post_message',
  'client_message','deadline_approaching','task_assigned','post_assigned',
  'mention',
  'event_invited','event_updated','event_cancelled','event_reminder',
  'event_client_rsvp','event_reschedule_requested','event_guest_rsvp',
  '__all__'
));

-- Body copied verbatim from 20261007000001_agenda_hub.sql; the only change
-- [convidados] is event_guest_rsvp appended to the array (team digest).
-- event_reminder is NOT here: reminder rows are written with emailed_at set and
-- mailed by their own path; event_rsvp has no e-mail.
create or replace function claim_notification_emails(
  p_settle_before timestamptz,
  p_after         timestamptz,
  p_limit         int
)
returns table (id uuid, user_id uuid, type text, metadata jsonb, link text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  update notifications n
     set emailed_at = now()
   where n.id in (
     select n2.id from notifications n2
     where n2.type = any (array[
       'post_approved','post_publish_failed','post_correction','post_message',
       'client_message','deadline_approaching','task_assigned','post_assigned',
       'mention',
       'event_invited','event_updated','event_cancelled',
       'event_client_rsvp','event_reschedule_requested','event_guest_rsvp'
     ])
       and n2.read_at is null and n2.dismissed_at is null and n2.emailed_at is null
       and n2.created_at <= p_settle_before and n2.created_at >= p_after
       and exists (
         select 1 from workspace_members wm
         where wm.workspace_id = n2.workspace_id and wm.user_id = n2.user_id
       )
       and not exists (
         select 1 from notification_email_prefs p
         where p.user_id = n2.user_id and p.enabled = false
           and (p.type = n2.type or p.type = '__all__')
       )
     order by n2.created_at asc
     limit p_limit
     for update skip locked
   )
  returning n.id, n.user_id, n.type, n.metadata, n.link, n.created_at;
$$;

-- REVOKE FROM PUBLIC também derruba service_role nesta instância — re-grant.
revoke all on function claim_notification_emails(timestamptz, timestamptz, int)
  from public, anon, authenticated;
grant execute on function claim_notification_emails(timestamptz, timestamptz, int)
  to service_role;

-- ============ (4) SEQUENCIA BUMP + BATCH ENQUEUE ============

-- Internal: sequencia + 1 on each id (rows that still exist). Called once per
-- write, through agenda_envios_enfileirar, for the union of the ids of every
-- list the write enqueues.
CREATE OR REPLACE FUNCTION public.agenda_ocorrencias_bump_sequencia(p_ids bigint[])
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.agenda_ocorrencias o SET sequencia = o.sequencia + 1
   WHERE o.id = ANY (coalesce(p_ids, '{}'::bigint[]));
$$;

-- Internal: the e-mails of one write. p_envios = [{ "cliente": id | null,
-- "convidado": id | null, "tipo": t, "ocorrencias": [snapshot entries] }],
-- every list built BEFORE this call (diffs are never recomputed after the
-- bump). Bumps the union of the ids of all lists once, rewrites each entry's
-- sequencia with the stored value (a row the write deleted carries its
-- snapshot value + 1, the rule of 20261007000001), then enqueues each list.
-- An empty list enqueues nothing and bumps nothing.
CREATE OR REPLACE FUNCTION public.agenda_envios_enfileirar(p_conta uuid, p_evento bigint, p_envios jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ids bigint[];
  v jsonb;
  v_lista jsonb;
BEGIN
  IF p_envios IS NULL OR jsonb_typeof(p_envios) <> 'array' OR jsonb_array_length(p_envios) = 0 THEN RETURN; END IF;
  v_ids := ARRAY(SELECT DISTINCT (x->>'ocorrencia_id')::bigint
                   FROM jsonb_array_elements(p_envios) en
                   CROSS JOIN LATERAL jsonb_array_elements(coalesce(en->'ocorrencias', '[]'::jsonb)) x);
  IF cardinality(v_ids) = 0 THEN RETURN; END IF;
  PERFORM public.agenda_ocorrencias_bump_sequencia(v_ids);

  FOR v IN SELECT en FROM jsonb_array_elements(p_envios) WITH ORDINALITY AS t(en, n) ORDER BY t.n LOOP
    SELECT coalesce(jsonb_agg(x || jsonb_build_object('sequencia', coalesce(o.sequencia, coalesce((x->>'sequencia')::int, 0) + 1))
                              ORDER BY t.n), '[]'::jsonb)
      INTO v_lista
      FROM jsonb_array_elements(coalesce(v->'ocorrencias', '[]'::jsonb)) WITH ORDINALITY AS t(x, n)
      LEFT JOIN public.agenda_ocorrencias o ON o.id = (t.x->>'ocorrencia_id')::bigint;
    PERFORM public.agenda_cliente_enfileirar(p_conta, (v->>'cliente')::bigint, p_evento, v->>'tipo', v_lista,
                                             NULL, (v->>'convidado')::bigint);
  END LOOP;
END $$;

-- Internal: the guests' variant of agenda_cliente_ocorrencias_snapshot (same
-- arguments, entry shape and expressions; keep them in sync). Controller
-- decision (fix round 2): a guest has no Hub, the e-mail is its only channel,
-- so its lists have NO 90-day bound: the next live occurrences (fim > now(),
-- not cancelled) ORDER BY inicio LIMIT 50, optionally from p_desde. With
-- p_ocorrencia: only that occurrence (as the cliente's). The cliente keeps its
-- own windowed function, unchanged.
CREATE OR REPLACE FUNCTION public.agenda_convidados_snapshot(
  p_evento bigint, p_estado text, p_ocorrencia bigint DEFAULT NULL, p_desde date DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(x.e ORDER BY x.inicio, x.id), '[]'::jsonb)
  FROM (
    SELECT o.id, o.inicio, jsonb_build_object(
             'ocorrencia_id', o.id,
             'estado', p_estado,
             'sequencia', o.sequencia,
             'inicio', o.inicio,
             'fim', o.fim,
             'dia_inteiro', e.dia_inteiro,
             'data_inicio_local', (o.inicio AT TIME ZONE e.tz)::date,
             'data_fim_local', CASE WHEN e.dia_inteiro THEN (o.fim AT TIME ZONE e.tz)::date
                                    ELSE ((o.fim AT TIME ZONE e.tz) - interval '1 microsecond')::date + 1 END,
             'tz', e.tz,
             'titulo', CASE WHEN 'titulo' = ANY (o.campos_sobrescritos) THEN o.titulo ELSE e.titulo END,
             'descricao', CASE WHEN 'descricao' = ANY (o.campos_sobrescritos) THEN o.descricao ELSE e.descricao END,
             'local', CASE WHEN 'local' = ANY (o.campos_sobrescritos) THEN o.local ELSE e.local END,
             'link_reuniao', CASE WHEN 'link_reuniao' = ANY (o.campos_sobrescritos) THEN o.link_reuniao ELSE e.link_reuniao END
           ) AS e
      FROM public.agenda_ocorrencias o
      JOIN public.agenda_eventos e ON e.id = o.evento_id AND e.conta_id = o.conta_id
     WHERE NOT o.cancelada
       AND o.fim > now()
       AND CASE WHEN p_ocorrencia IS NOT NULL
                THEN o.id = p_ocorrencia AND (p_evento IS NULL OR o.evento_id = p_evento)
                ELSE o.evento_id = p_evento
                     AND (p_desde IS NULL OR o.data_original >= p_desde) END
     ORDER BY o.inicio, o.id
     LIMIT 50
  ) x;
$$;

-- Internal: the envio of one list to each active guest of a series (helper of
-- the write RPCs).
CREATE OR REPLACE FUNCTION public.agenda_envios_convidados(p_convidados bigint[], p_tipo text, p_ocorrencias jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('cliente', NULL, 'convidado', g, 'tipo', p_tipo, 'ocorrencias', p_ocorrencias)
                            ORDER BY n), '[]'::jsonb)
    FROM unnest(coalesce(p_convidados, '{}'::bigint[])) WITH ORDINALITY AS t(g, n)
   WHERE coalesce(jsonb_array_length(p_ocorrencias), 0) > 0;
$$;

-- Internal: guests who LOST the series (removed by an edit, a private edit
-- included, or excluir todas). Called after the write enqueued their
-- 'cancelamento'. Every unsent, unleased pending item of those guest rows on
-- p_evento becomes a full cancellation: a 'convite' was never announced, so
-- it is descartado; anything else becomes tipo 'cancelamento' with every entry
-- 'cancelada' (a merged 'alteracao' can hold entries outside the snapshot
-- window of the cancellation, e.g. an esta move past 90 days, which would
-- otherwise stay 'ativa' and get the item discarded by the claim). versao + 1
-- (the content changed; nothing under lease is touched).
CREATE OR REPLACE FUNCTION public.agenda_convidados_perda(p_evento bigint, p_convidados bigint[])
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.agenda_emails_cliente q
     SET status = CASE WHEN q.tipo = 'convite' THEN 'descartado' ELSE q.status END,
         tipo = CASE WHEN q.tipo = 'convite' THEN q.tipo ELSE 'cancelamento' END,
         ocorrencias = CASE WHEN q.tipo = 'convite' THEN q.ocorrencias
                            ELSE (SELECT coalesce(jsonb_agg(y || '{"estado":"cancelada"}'::jsonb
                                                            ORDER BY (y->>'inicio')::timestamptz, (y->>'ocorrencia_id')::bigint), '[]'::jsonb)
                                    FROM jsonb_array_elements(q.ocorrencias) y) END,
         versao = q.versao + 1
   WHERE q.convidado_id = ANY (coalesce(p_convidados, '{}'::bigint[]))
     AND q.evento_id = p_evento
     AND q.status = 'pendente' AND q.lease_ate IS NULL;
$$;

-- ============ (5) agenda_cliente_enfileirar WITH A GUEST RECIPIENT ============
-- Body copied verbatim from 20261007000001_agenda_hub.sql; changes marked
-- "-- [convidados]". The 6-arg signature is dropped (its grant would otherwise
-- survive next to the new one); agenda_remarcacao_resolver's two direct
-- 6-arg calls bind to the new function through the DEFAULT NULL.
-- Internal: puts p_ocorrencias (snapshot entries) in the e-mail queue of ONE
-- recipient: the cliente p_cliente, or the guest row p_convidado (exactly one
-- of the two; both NULL enqueues nothing).
--  * [convidados] No bump any more: the entries carry the sequencia the write
--    RPC already stored (agenda_envios_enfileirar bumps once per write).
--  * Transaction GUC agenda.remarcacao (set by agenda_remarcacao_resolver while
--    it calls agenda_evento_editar): for the cliente only, an 'alteracao'
--    becomes 'remarcacao_aceita' with the remarcacao payload built from that
--    request row. A guest keeps 'alteracao' and never sees the conversation.
--  * One live entry per occurrence per recipient (amendment 7 of sub-projeto
--    3): the same ocorrencia_ids leave every OTHER mergeable item of this
--    recipient (pendente, no lease, enviar_apos ahead, not remarcacao_*); an
--    item left empty is descartado. A guest is every row with its token (the
--    split copies), so a pending item of the head series loses the moved ids.
--    An id taken from a pending 'convite' was never announced, so a
--    'cancelada' entry for it is dropped instead of queued.
--  * Non-remarcacao: merged into the mergeable item of (recipient, evento) when
--    there is one (latest state per ocorrencia_id wins; a 'cancelada' entry
--    for an item still of tipo 'convite' is dropped together with its earlier
--    entry: the recipient never heard of it), versao + 1, enviar_apos
--    unchanged; an item left empty is descartado. Merged tipo: convite stays
--    convite; a cancelamento that receives live entries becomes alteracao;
--    otherwise the item's tipo stays (the e-mail type is derived from the
--    snapshot at send).
--  * Otherwise a new item, enviar_apos = now() + 60 s (none when empty).
--    remarcacao_* items never merge and are never merged into.
DROP FUNCTION public.agenda_cliente_enfileirar(uuid, bigint, bigint, text, jsonb, jsonb);
CREATE FUNCTION public.agenda_cliente_enfileirar(
  p_conta uuid, p_cliente bigint, p_evento bigint, p_tipo text, p_ocorrencias jsonb, p_remarcacao jsonb DEFAULT NULL,
  p_convidado bigint DEFAULT NULL)  -- [convidados]
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tipo text := p_tipo;
  v_rem jsonb := p_remarcacao;
  v_guc text;
  v_ids bigint[];
  v_novas jsonb;
  v_nunca bigint[] := '{}';
  v_lista jsonb;
  v_item public.agenda_emails_cliente;
  r public.agenda_emails_cliente;
  v_email text;                     -- [convidados] the guest's address
  v_irmaos bigint[] := '{}';        -- [convidados] every row of the guest's token
BEGIN
  IF p_tipo IS NULL OR p_tipo NOT IN ('convite', 'alteracao', 'cancelamento', 'remarcacao_aceita', 'remarcacao_recusada') THEN
    RAISE EXCEPTION 'agenda_cliente_enfileirar: tipo inválido %', p_tipo;
  END IF;
  -- [convidados] exactly one recipient
  IF p_cliente IS NOT NULL AND p_convidado IS NOT NULL THEN
    RAISE EXCEPTION 'agenda_cliente_enfileirar: cliente e convidado juntos';
  END IF;
  IF p_convidado IS NOT NULL AND p_tipo NOT IN ('convite', 'alteracao', 'cancelamento') THEN
    RAISE EXCEPTION 'agenda_cliente_enfileirar: tipo inválido para convidado %', p_tipo;
  END IF;
  IF p_conta IS NULL OR (p_cliente IS NULL AND p_convidado IS NULL) OR p_evento IS NULL OR p_ocorrencias IS NULL
     OR jsonb_typeof(p_ocorrencias) <> 'array' OR jsonb_array_length(p_ocorrencias) = 0 THEN
    RETURN;
  END IF;
  IF p_convidado IS NOT NULL THEN
    SELECT g.email INTO v_email FROM public.agenda_convidados g WHERE g.id = p_convidado AND g.conta_id = p_conta;
    IF NOT FOUND THEN RAISE EXCEPTION 'agenda_cliente_enfileirar: convidado % não encontrado', p_convidado; END IF;
    v_irmaos := ARRAY(SELECT g2.id FROM public.agenda_convidados g
                        JOIN public.agenda_convidados g2 ON g2.token = g.token AND g2.conta_id = g.conta_id
                       WHERE g.id = p_convidado);
  END IF;

  v_guc := NULLIF(current_setting('agenda.remarcacao', true), '');
  IF v_guc IS NOT NULL AND v_tipo = 'alteracao' AND p_convidado IS NULL THEN  -- [convidados] cliente only
    v_tipo := 'remarcacao_aceita';
    SELECT jsonb_build_object('remarcacao_id', rm.id, 'inicio_sugerido', rm.inicio_sugerido,
                              'fim_sugerido', rm.fim_sugerido, 'mensagem', rm.mensagem,
                              'resposta_equipe', rm.resposta_equipe)
      INTO v_rem FROM public.agenda_remarcacoes rm WHERE rm.id = v_guc::bigint;
  END IF;

  -- [convidados] the entries as given (the write RPC bumped and patched them)
  v_ids := ARRAY(SELECT DISTINCT (x->>'ocorrencia_id')::bigint FROM jsonb_array_elements(p_ocorrencias) x);
  v_novas := p_ocorrencias;

  -- one live entry per occurrence per recipient
  FOR r IN
    SELECT q.* FROM public.agenda_emails_cliente q
     WHERE (CASE WHEN p_convidado IS NULL THEN q.cliente_id = p_cliente
                 ELSE q.convidado_id = ANY (v_irmaos) END)  -- [convidados]
       AND q.status = 'pendente' AND q.lease_ate IS NULL AND q.enviar_apos > now()
       AND q.tipo NOT IN ('remarcacao_aceita', 'remarcacao_recusada')
       AND (v_tipo IN ('remarcacao_aceita', 'remarcacao_recusada') OR q.evento_id <> p_evento
            OR q.convidado_id IS DISTINCT FROM p_convidado)  -- [convidados] another row of the token
       -- a reschedule outcome never steals the occurrence from an unsent
       -- invite: the client must get "Novo evento" first
       AND NOT (v_tipo IN ('remarcacao_aceita', 'remarcacao_recusada') AND q.tipo = 'convite')
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(q.ocorrencias) y WHERE (y->>'ocorrencia_id')::bigint = ANY (v_ids))
     ORDER BY q.id
     FOR UPDATE
  LOOP
    IF r.tipo = 'convite' THEN
      v_nunca := v_nunca || ARRAY(SELECT (y->>'ocorrencia_id')::bigint FROM jsonb_array_elements(r.ocorrencias) y
                                   WHERE (y->>'ocorrencia_id')::bigint = ANY (v_ids));
    END IF;
    SELECT coalesce(jsonb_agg(y ORDER BY (y->>'inicio')::timestamptz, (y->>'ocorrencia_id')::bigint), '[]'::jsonb) INTO v_lista
      FROM jsonb_array_elements(r.ocorrencias) y WHERE NOT ((y->>'ocorrencia_id')::bigint = ANY (v_ids));
    UPDATE public.agenda_emails_cliente q
       SET ocorrencias = v_lista, versao = q.versao + 1,
           status = CASE WHEN jsonb_array_length(v_lista) = 0 THEN 'descartado' ELSE q.status END
     WHERE q.id = r.id;
  END LOOP;

  IF v_tipo NOT IN ('remarcacao_aceita', 'remarcacao_recusada') THEN
    SELECT q.* INTO v_item FROM public.agenda_emails_cliente q
     WHERE (CASE WHEN p_convidado IS NULL THEN q.cliente_id = p_cliente
                 ELSE q.convidado_id = p_convidado END)  -- [convidados]
       AND q.evento_id = p_evento
       AND q.status = 'pendente' AND q.lease_ate IS NULL AND q.enviar_apos > now()
       AND q.tipo NOT IN ('remarcacao_aceita', 'remarcacao_recusada')
     ORDER BY q.id DESC LIMIT 1
     FOR UPDATE;
  END IF;

  IF v_item.id IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(z.e ORDER BY (z.e->>'inicio')::timestamptz, (z.e->>'ocorrencia_id')::bigint), '[]'::jsonb) INTO v_lista
      FROM (
        SELECT u.e FROM (
          SELECT y AS e FROM jsonb_array_elements(v_item.ocorrencias) y
           WHERE NOT ((y->>'ocorrencia_id')::bigint = ANY (v_ids))
          UNION ALL
          SELECT n FROM jsonb_array_elements(v_novas) n
           WHERE NOT (n->>'estado' = 'cancelada'
                      AND (v_item.tipo = 'convite' OR (n->>'ocorrencia_id')::bigint = ANY (v_nunca)))
        ) u
        ORDER BY (u.e->>'inicio')::timestamptz, (u.e->>'ocorrencia_id')::bigint
        LIMIT 50
      ) z;
    UPDATE public.agenda_emails_cliente q
       SET ocorrencias = v_lista,
           versao = q.versao + 1,
           tipo = CASE WHEN q.tipo = 'convite' THEN 'convite'
                       WHEN q.tipo = 'cancelamento' AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_lista) y WHERE y->>'estado' = 'ativa')
                         THEN 'alteracao'
                       ELSE q.tipo END,
           status = CASE WHEN jsonb_array_length(v_lista) = 0 THEN 'descartado' ELSE q.status END
     WHERE q.id = v_item.id;
    RETURN;
  END IF;

  SELECT coalesce(jsonb_agg(z.n ORDER BY (z.n->>'inicio')::timestamptz, (z.n->>'ocorrencia_id')::bigint), '[]'::jsonb) INTO v_lista
    FROM (
      SELECT n FROM jsonb_array_elements(v_novas) n
       WHERE NOT (n->>'estado' = 'cancelada' AND (n->>'ocorrencia_id')::bigint = ANY (v_nunca))
       ORDER BY (n->>'inicio')::timestamptz, (n->>'ocorrencia_id')::bigint
       LIMIT 50
    ) z;
  IF jsonb_array_length(v_lista) = 0 THEN RETURN; END IF;

  INSERT INTO public.agenda_emails_cliente (conta_id, cliente_id, convidado_id, convidado_email,  -- [convidados]
                                            evento_id, tipo, ocorrencias, remarcacao, enviar_apos)
  VALUES (p_conta, p_cliente, p_convidado, v_email, p_evento, v_tipo, v_lista,
          CASE WHEN v_tipo IN ('remarcacao_aceita', 'remarcacao_recusada') THEN v_rem END,
          now() + interval '60 seconds');
END $$;

-- ============ (6) agenda_definir_convidados ============
-- Internal: replaces the active guest set of series p_evento with
-- p_convidados ([{email, nome}], from the "convidados" key of p_evento). The
-- caller already holds the series (FOR UPDATE on edit, freshly inserted on
-- create) and checked that the user may edit it. Validation (exact copy, CRM
-- shows it through formatAgendaError): every e-mail matches a simple regex
-- and has at most 254 characters after lower(btrim()); duplicates collapse
-- (the first wins); at most 20; none on a private series; none that is the
-- auth e-mail of a member of the workspace (lower-case comparison). nome is
-- trimmed, blank -> NULL, cut at 120; an entry without the "nome" key keeps
-- the stored nome of a kept guest.
-- Daily caps (amendment 17), after pg_advisory_xact_lock on the workspace
-- (then on the platform, only when something counts): the distinct e-mails of
-- the workspace's guest rows created in the last 24 h plus the new e-mails not
-- already among them must stay <= 50; the same over every workspace (distinct
-- conta_id, e-mail) <= 1000. Split copies keep the source row's criado_em and
-- a re-add is an e-mail already counted, so neither ever counts.
-- Removed guests get removido_em = now() (their answers stay, inert); new ones
-- get a fresh 64-hex token. audit_log per add/remove. Returns the ids added
-- and removed; the caller enqueues their convite/cancelamento together with
-- every other e-mail of the write (one sequencia bump, amendment 7).
CREATE OR REPLACE FUNCTION public.agenda_definir_convidados(
  p_evento bigint, p_convidados jsonb, OUT adicionados bigint[], OUT removidos bigint[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_e public.agenda_eventos;
  v_user uuid := auth.uid();
  v_lista jsonb := '[]'::jsonb;  -- [{email, nome, tem_nome, n}] normalized, deduplicated
  x jsonb;
  v_n int := 0;
  v_email text;
  v_membro text;
  v_novos text[];
  v_contar text[];
  v_ws int;
  v_plat int;
BEGIN
  SELECT e.* INTO v_e FROM public.agenda_eventos e WHERE e.id = p_evento;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;

  IF p_convidados IS NULL OR jsonb_typeof(p_convidados) <> 'array' THEN
    RAISE EXCEPTION 'agenda: informe e-mails válidos para os convidados.';
  END IF;
  FOR x IN SELECT t.e FROM jsonb_array_elements(p_convidados) WITH ORDINALITY AS t(e, n) ORDER BY t.n LOOP
    IF jsonb_typeof(x) <> 'object' OR jsonb_typeof(x->'email') IS DISTINCT FROM 'string'
       OR (x ? 'nome' AND jsonb_typeof(x->'nome') NOT IN ('string', 'null')) THEN
      RAISE EXCEPTION 'agenda: informe e-mails válidos para os convidados.';
    END IF;
    v_email := lower(btrim(x->>'email'));
    IF char_length(v_email) > 254 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RAISE EXCEPTION 'agenda: informe e-mails válidos para os convidados.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_lista) y WHERE y->>'email' = v_email) THEN
      v_n := v_n + 1;
      v_lista := v_lista || jsonb_build_array(jsonb_build_object(
        'email', v_email,
        'nome', left(NULLIF(btrim(x->>'nome'), ''), 120),
        'tem_nome', x ? 'nome',
        'n', v_n));
    END IF;
  END LOOP;

  IF jsonb_array_length(v_lista) > 20 THEN
    RAISE EXCEPTION 'agenda: no máximo 20 convidados externos por evento.';
  END IF;
  IF v_e.privado AND jsonb_array_length(v_lista) > 0 THEN
    RAISE EXCEPTION 'agenda: evento privado não pode ter convidados externos.';
  END IF;
  SELECT y->>'email' INTO v_membro
    FROM jsonb_array_elements(v_lista) y
   WHERE EXISTS (SELECT 1 FROM public.workspace_members wm
                   JOIN auth.users u ON u.id = wm.user_id
                  WHERE wm.workspace_id = v_e.conta_id AND lower(u.email) = y->>'email')
   ORDER BY (y->>'n')::int
   LIMIT 1;
  IF v_membro IS NOT NULL THEN
    RAISE EXCEPTION 'agenda: % já é da equipe. Adicione como participante.', v_membro;
  END IF;

  -- serializes the caps of concurrent writes in the workspace
  PERFORM pg_advisory_xact_lock(hashtextextended('agenda-convidados:' || v_e.conta_id::text, 0));

  v_novos := ARRAY(SELECT y->>'email' FROM jsonb_array_elements(v_lista) y
                    WHERE NOT EXISTS (SELECT 1 FROM public.agenda_convidados g
                                       WHERE g.evento_id = p_evento AND g.removido_em IS NULL AND g.email = y->>'email')
                    ORDER BY (y->>'n')::int);
  v_contar := ARRAY(SELECT d.email FROM unnest(v_novos) AS d(email)
                     WHERE NOT EXISTS (SELECT 1 FROM public.agenda_convidados g
                                        WHERE g.conta_id = v_e.conta_id AND g.email = d.email
                                          AND g.criado_em > now() - interval '24 hours'));
  IF cardinality(v_contar) > 0 THEN
    SELECT count(DISTINCT g.email) INTO v_ws FROM public.agenda_convidados g
     WHERE g.conta_id = v_e.conta_id AND g.criado_em > now() - interval '24 hours';
    IF v_ws + cardinality(v_contar) > 50 THEN
      RAISE EXCEPTION 'agenda: limite diário de convites externos atingido. Tente amanhã.';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('agenda-convidados:plataforma', 0));
    SELECT count(*) INTO v_plat
      FROM (SELECT DISTINCT g.conta_id, g.email FROM public.agenda_convidados g
             WHERE g.criado_em > now() - interval '24 hours') d;
    IF v_plat + cardinality(v_contar) > 1000 THEN
      RAISE EXCEPTION 'agenda: limite diário de convites externos atingido. Tente amanhã.';
    END IF;
  END IF;

  -- removed
  WITH r AS (
    UPDATE public.agenda_convidados g SET removido_em = now()
     WHERE g.evento_id = p_evento AND g.removido_em IS NULL
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_lista) y WHERE y->>'email' = g.email)
    RETURNING g.id, g.email
  ), a AS (
    INSERT INTO public.audit_log (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
    SELECT v_e.conta_id, v_user, 'agenda_convidado_removido', 'agenda_evento', p_evento::text, jsonb_build_object('email', r.email)
      FROM r
  )
  SELECT coalesce(array_agg(r.id ORDER BY r.id), '{}') INTO removidos FROM r;

  -- kept: the nome follows the payload when it carries one
  UPDATE public.agenda_convidados g SET nome = y->>'nome'
    FROM jsonb_array_elements(v_lista) y
   WHERE g.evento_id = p_evento AND g.removido_em IS NULL AND g.email = y->>'email'
     AND (y->>'tem_nome')::boolean AND g.nome IS DISTINCT FROM y->>'nome';

  -- added
  WITH i AS (
    INSERT INTO public.agenda_convidados (conta_id, evento_id, email, nome, token, adicionado_por)
    SELECT v_e.conta_id, p_evento, y->>'email', y->>'nome', encode(extensions.gen_random_bytes(32), 'hex'), v_user
      FROM jsonb_array_elements(v_lista) y
     WHERE y->>'email' = ANY (v_novos)
     ORDER BY (y->>'n')::int
    RETURNING id, email
  ), a AS (
    INSERT INTO public.audit_log (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
    SELECT v_e.conta_id, v_user, 'agenda_convidado_adicionado', 'agenda_evento', p_evento::text, jsonb_build_object('email', i.email)
      FROM i
  )
  SELECT coalesce(array_agg(i.id ORDER BY i.id), '{}') INTO adicionados FROM i;
END $$;

-- ============ (7) WRITE RPCs WITH THE GUEST HOOKS ============
-- Each body is copied verbatim from 20261007000001_agenda_hub.sql; every
-- addition is marked "-- [convidados]". p_evento may carry "convidados":
-- [{email, nome}] (absent on edit = unchanged; ignored for scope esta; []
-- removes all). agenda_remarcacao_resolver is not replaced: its accept path
-- runs agenda_evento_editar(esta), so the guests get a plain 'alteracao'.

-- ---- client RPC: create ----
-- Returns the first occurrence and the normalized dtstart (the UI warns "A série
-- começa em {data}" when it differs from the chosen start). An event dated past
-- the 24-month materialization horizon has no occurrence yet: ocorrencia_id is
-- NULL and the generator materializes it when "today" catches up.
CREATE OR REPLACE FUNCTION public.agenda_evento_criar(p_evento jsonb, p_participantes uuid[])
RETURNS TABLE (evento_id bigint, ocorrencia_id bigint, dtstart timestamp)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_conta uuid;
  v_user uuid;
  v_e public.agenda_eventos;
  v_id bigint;
  v_oc bigint;
  v_parts uuid[];
  v_conv_add bigint[] := '{}';   -- [convidados] guests added by the payload
  v_envios jsonb := '[]'::jsonb; -- [convidados]
BEGIN
  v_conta := get_my_conta_id(); v_user := auth.uid();
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'agenda: sessão sem workspace ativo'; END IF;
  IF NOT public.effective_plan_feature(v_conta, 'feature_agenda') THEN
    RAISE EXCEPTION 'feature_disabled:feature_agenda' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.has_permission('calendario', 'editar') THEN
    RAISE EXCEPTION 'agenda: você não pode criar eventos';
  END IF;

  v_e := public.agenda_validar_payload(v_conta, p_evento, NULL);
  v_e.organizador_id := v_user;
  v_e.dtstart := public.agenda_normalizar_dtstart(v_e);

  v_parts := ARRAY(SELECT DISTINCT d.u FROM unnest(coalesce(p_participantes, '{}'::uuid[])) AS d(u)
                    WHERE d.u IS NOT NULL AND d.u <> v_user);
  IF cardinality(v_parts) > 50 THEN
    RAISE EXCEPTION 'agenda: no máximo 50 participantes';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_parts) AS d(u)
              WHERE NOT EXISTS (SELECT 1 FROM public.workspace_members wm
                                 WHERE wm.user_id = d.u AND wm.workspace_id = v_conta)) THEN
    RAISE EXCEPTION 'agenda: participante fora do workspace';
  END IF;

  INSERT INTO public.agenda_eventos (
    conta_id, organizador_id, titulo, descricao, local, link_reuniao, tipo, cor, cliente_id,
    privado, dia_inteiro, tz, dtstart, duracao_min, duracao_dias, freq, intervalo, dias_semana,
    mensal_modo, mensal_ordinal, ate, contagem, lembretes,
    compartilhado_cliente)  -- [hub]
  VALUES (
    v_conta, v_user, v_e.titulo, v_e.descricao, v_e.local, v_e.link_reuniao, v_e.tipo, v_e.cor, v_e.cliente_id,
    v_e.privado, v_e.dia_inteiro, v_e.tz, v_e.dtstart, v_e.duracao_min, v_e.duracao_dias, v_e.freq, v_e.intervalo,
    v_e.dias_semana, v_e.mensal_modo, v_e.mensal_ordinal, v_e.ate, v_e.contagem, v_e.lembretes,
    v_e.compartilhado_cliente)  -- [hub]
  RETURNING agenda_eventos.id INTO v_id;

  INSERT INTO public.agenda_participantes (evento_id, conta_id, user_id, resposta, respondido_em)
  VALUES (v_id, v_conta, v_user, 'sim', now());
  INSERT INTO public.agenda_participantes (evento_id, conta_id, user_id, resposta)
  SELECT v_id, v_conta, d.u, 'pendente' FROM unnest(v_parts) AS d(u);

  PERFORM public.agenda_materializar(v_id, (public.agenda_hoje(v_e.tz) + interval '24 months')::date);

  SELECT o.id INTO v_oc FROM public.agenda_ocorrencias o
   WHERE o.evento_id = v_id ORDER BY o.data_original LIMIT 1;

  PERFORM public.agenda_notificar(v_conta, v_id, v_oc, 'event_invited', v_parts, v_user, '{}'::jsonb);

  -- [convidados] the external guests of the payload (validated, capped, audited)
  IF p_evento ? 'convidados' THEN
    SELECT d.adicionados INTO v_conv_add FROM public.agenda_definir_convidados(v_id, p_evento->'convidados') d;
  END IF;

  -- [hub] shared with the client: 'convite' with the next occurrences
  -- [convidados] and each guest a 'convite' with its own (unbounded) snapshot,
  -- with one bump for all
  IF v_e.compartilhado_cliente AND v_e.cliente_id IS NOT NULL THEN
    v_envios := jsonb_build_array(jsonb_build_object('cliente', v_e.cliente_id, 'convidado', NULL,
      'tipo', 'convite', 'ocorrencias', public.agenda_cliente_ocorrencias_snapshot(v_id, 'ativa')));
  END IF;
  IF cardinality(v_conv_add) > 0 THEN
    v_envios := v_envios || public.agenda_envios_convidados(v_conv_add, 'convite',
      public.agenda_convidados_snapshot(v_id, 'ativa'));
  END IF;
  PERFORM public.agenda_envios_enfileirar(v_conta, v_id, v_envios);

  RETURN QUERY SELECT v_id, v_oc, v_e.dtstart;
END $$;
REVOKE ALL ON FUNCTION public.agenda_evento_criar(jsonb, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agenda_evento_criar(jsonb, uuid[]) TO authenticated, service_role;

-- ---- client RPC: edit ----
-- p_escopo: 'esta' (exceptions on this occurrence), 'seguintes' (split the
-- series at this occurrence's data_original), 'todas' (the whole series). A
-- series without a rule ignores the scope (todas); 'seguintes' at the first live
-- occurrence is 'todas'. p_evento follows the merge rule of
-- agenda_validar_payload (an absent key keeps the stored value, so a drag sends
-- only inicio_local/fim_local). The form and the drag carry the start of THIS
-- occurrence; the series dtstart is derived with the date delta of this edit
-- (spec "Como o payload vira dtstart") and then normalized. Returns the
-- occurrence that represents the edited one: the same id, or (when its date
-- left the rule) the first live occurrence from that date on, else the series'
-- first, else NULL (a one-off moved past the materialization horizon has no
-- occurrence until the generator reaches it).
CREATE OR REPLACE FUNCTION public.agenda_evento_editar(p_ocorrencia_id bigint, p_escopo text, p_evento jsonb, p_participantes uuid[] DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conta uuid;
  v_user uuid;
  v_o public.agenda_ocorrencias;
  v_e public.agenda_eventos;
  v_base public.agenda_eventos;
  v_novo public.agenda_eventos;
  v_escopo text;
  v_primeira boolean;
  v_tem_horario boolean;
  v_delta int;
  v_hoje date;
  v_h date;
  v_c date;
  v_datas date[];
  v_alvo bigint;          -- series that ends up holding the edited occurrence
  v_ret bigint;
  v_regen boolean := false;
  v_reset boolean := false;
  v_notifica boolean := false;
  v_regra_igual boolean;
  v_contagem int;
  v_add uuid[] := '{}';
  v_rem uuid[] := '{}';
  v_atuais uuid[];
  v_pedidos uuid[];
  v_campos text[];
  v_ini timestamptz; v_fim timestamptz;
  v_gen_ini timestamptz; v_gen_fim timestamptz;
  v_old_titulo text; v_old_local text; v_old_link text;
  v_destinatarios uuid[];
  v_cli_antes bigint;            -- [hub] cliente the series was shared with (NULL: not shared)
  v_cli_depois bigint;           -- [hub] same, after the edit (series v_alvo)
  v_antes jsonb := '[]'::jsonb;  -- [hub] affected future occurrences, before the edit
  v_convs_antes bigint[] := '{}';   -- [convidados] active guests of the series before the edit
  v_conv_add bigint[] := '{}';      -- [convidados] added by this edit (on v_alvo)
  v_conv_rem bigint[] := '{}';      -- [convidados] removed by this edit (on v_alvo)
  v_conv_manter bigint[] := '{}';   -- [convidados] active on v_alvo and not added now
  v_conv_n int;                     -- [convidados]
  v_antes_g jsonb := '[]'::jsonb;   -- [convidados] same as v_antes, guest snapshot (no 90-day bound)
  v_diff jsonb := '[]'::jsonb;      -- [convidados] the client's diff
  v_diff_g jsonb := '[]'::jsonb;    -- [convidados] the guests' diff
  v_snap jsonb;                     -- [convidados]
  v_snap_g jsonb;                   -- [convidados]
  v_cancel jsonb;                   -- [convidados] v_antes as 'cancelada'
  v_cancel_g jsonb;                 -- [convidados] v_antes_g as 'cancelada'
  v_envios jsonb := '[]'::jsonb;    -- [convidados] every e-mail of this write
BEGIN
  v_conta := get_my_conta_id(); v_user := auth.uid();
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'agenda: sessão sem workspace ativo'; END IF;
  IF NOT public.effective_plan_feature(v_conta, 'feature_agenda') THEN
    RAISE EXCEPTION 'feature_disabled:feature_agenda' USING ERRCODE = 'P0001';
  END IF;
  IF p_escopo IS NULL OR p_escopo NOT IN ('esta', 'seguintes', 'todas') THEN
    RAISE EXCEPTION 'agenda: escopo inválido';
  END IF;
  IF p_evento IS NULL OR jsonb_typeof(p_evento) <> 'object' THEN
    RAISE EXCEPTION 'agenda: dados do evento incompletos';
  END IF;

  SELECT o.* INTO v_o FROM public.agenda_ocorrencias o
   WHERE o.id = p_ocorrencia_id AND o.conta_id = v_conta AND NOT o.cancelada;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;
  SELECT e.* INTO v_e FROM public.agenda_eventos e
   WHERE e.id = v_o.evento_id AND e.conta_id = v_conta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;
  IF NOT public.agenda_pode_editar(v_e, v_user, v_conta) THEN
    RAISE EXCEPTION 'agenda: você não pode editar este evento';
  END IF;
  -- re-read the occurrence after the series lock (it may have changed meanwhile)
  SELECT o.* INTO v_o FROM public.agenda_ocorrencias o
   WHERE o.id = p_ocorrencia_id AND o.evento_id = v_e.id AND NOT o.cancelada;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;

  v_primeira := NOT EXISTS (SELECT 1 FROM public.agenda_ocorrencias o
                             WHERE o.evento_id = v_e.id AND NOT o.cancelada AND o.data_original < v_o.data_original);
  IF v_e.freq IS NULL OR (p_escopo = 'seguintes' AND v_primeira) THEN
    v_escopo := 'todas';
  ELSE
    v_escopo := p_escopo;
  END IF;

  -- [hub] what the client sees before the edit, scope-dependent: esta -> this
  -- occurrence; todas -> the series' future occurrences; seguintes -> those
  -- from the cut. Taken before any regenerate/split/delete.
  v_cli_antes := CASE WHEN v_e.compartilhado_cliente THEN v_e.cliente_id END;
  IF v_cli_antes IS NOT NULL THEN
    v_antes := public.agenda_cliente_ocorrencias_snapshot(
      v_e.id, 'ativa',
      CASE WHEN v_escopo = 'esta' THEN v_o.id END,
      CASE WHEN v_escopo = 'seguintes' THEN v_o.data_original END);
  END IF;
  -- [convidados] the same for the guests, from their unbounded snapshot
  v_convs_antes := ARRAY(SELECT g.id FROM public.agenda_convidados g
                          WHERE g.evento_id = v_e.id AND g.removido_em IS NULL ORDER BY g.id);
  IF cardinality(v_convs_antes) > 0 THEN
    v_antes_g := public.agenda_convidados_snapshot(
      v_e.id, 'ativa',
      CASE WHEN v_escopo = 'esta' THEN v_o.id END,
      CASE WHEN v_escopo = 'seguintes' THEN v_o.data_original END);
  END IF;

  v_tem_horario := p_evento ? 'inicio_local' OR p_evento ? 'fim_local';
  v_hoje := public.agenda_hoje(v_e.tz);
  v_c := v_o.data_original;
  v_old_titulo := CASE WHEN 'titulo' = ANY (v_o.campos_sobrescritos) THEN v_o.titulo ELSE v_e.titulo END;
  v_old_local := CASE WHEN 'local' = ANY (v_o.campos_sobrescritos) THEN v_o.local ELSE v_e.local END;
  v_old_link := CASE WHEN 'link_reuniao' = ANY (v_o.campos_sobrescritos) THEN v_o.link_reuniao ELSE v_e.link_reuniao END;
  -- current participants other than the organizer, still members (what the form shows)
  v_atuais := ARRAY(SELECT ap.user_id FROM public.agenda_participantes ap
                      JOIN public.workspace_members wm ON wm.user_id = ap.user_id AND wm.workspace_id = v_conta
                     WHERE ap.evento_id = v_e.id AND ap.user_id IS DISTINCT FROM v_e.organizador_id
                     ORDER BY ap.user_id);

  -- ======== esta ========
  IF v_escopo = 'esta' THEN
    -- base: the series with this occurrence's effective content, so a drag that
    -- sends only times keeps an existing content override
    v_base := v_e;
    v_base.titulo := v_old_titulo;
    v_base.descricao := CASE WHEN 'descricao' = ANY (v_o.campos_sobrescritos) THEN v_o.descricao ELSE v_e.descricao END;
    v_base.local := v_old_local;
    v_base.link_reuniao := v_old_link;
    v_novo := public.agenda_validar_payload(v_conta, p_evento, v_base);

    IF v_novo.tipo IS DISTINCT FROM v_e.tipo
       OR v_novo.cor IS DISTINCT FROM v_e.cor
       OR v_novo.cliente_id IS DISTINCT FROM v_e.cliente_id
       OR v_novo.privado IS DISTINCT FROM v_e.privado
       -- [hub] sharing is a series field; compared as effective sharing, since a
       -- deleted cliente leaves compartilhado_cliente true with cliente_id NULL
       -- and agenda_validar_payload then reports false
       OR (v_novo.compartilhado_cliente AND v_novo.cliente_id IS NOT NULL)
          IS DISTINCT FROM (v_e.compartilhado_cliente AND v_e.cliente_id IS NOT NULL)
       OR v_novo.dia_inteiro IS DISTINCT FROM v_e.dia_inteiro
       OR ARRAY(SELECT x FROM unnest(v_novo.lembretes) x ORDER BY x) IS DISTINCT FROM ARRAY(SELECT x FROM unnest(v_e.lembretes) x ORDER BY x)
       OR (v_novo.freq, v_novo.intervalo, v_novo.dias_semana, v_novo.mensal_modo, v_novo.mensal_ordinal, v_novo.ate, v_novo.contagem)
          IS DISTINCT FROM (v_e.freq, v_e.intervalo, v_e.dias_semana, v_e.mensal_modo, v_e.mensal_ordinal, v_e.ate, v_e.contagem) THEN
      RAISE EXCEPTION 'agenda: este campo vale para toda a série';
    END IF;
    IF p_participantes IS NOT NULL THEN
      v_pedidos := ARRAY(SELECT DISTINCT d.u FROM unnest(p_participantes) AS d(u)
                          WHERE d.u IS NOT NULL AND d.u IS DISTINCT FROM v_e.organizador_id ORDER BY d.u);
      IF v_pedidos IS DISTINCT FROM v_atuais THEN
        RAISE EXCEPTION 'agenda: este campo vale para toda a série';
      END IF;
    END IF;

    IF v_tem_horario THEN
      SELECT f.inicio, f.fim INTO v_ini, v_fim FROM public.agenda_inicio_fim(v_novo, v_novo.dtstart::date) f;
    ELSE
      v_ini := v_o.inicio; v_fim := v_o.fim;
    END IF;
    SELECT g.inicio, g.fim INTO v_gen_ini, v_gen_fim FROM public.agenda_inicio_fim(v_e, v_o.data_original) g;

    -- [hub] the occurrence moves: its pending reschedule request is superseded
    IF (v_ini, v_fim) IS DISTINCT FROM (v_o.inicio, v_o.fim) THEN
      PERFORM public.agenda_cliente_substituir_pedidos(v_e.id, v_o.id);
    END IF;

    -- a field differing from the series is an override (even NULL); equal to
    -- the series value it is dropped from the list
    v_campos := ARRAY(SELECT c.campo FROM unnest(ARRAY['titulo', 'descricao', 'local', 'link_reuniao']) WITH ORDINALITY AS c(campo, n)
                       WHERE CASE c.campo
                               WHEN 'titulo' THEN v_novo.titulo IS DISTINCT FROM v_e.titulo
                               WHEN 'descricao' THEN v_novo.descricao IS DISTINCT FROM v_e.descricao
                               WHEN 'local' THEN v_novo.local IS DISTINCT FROM v_e.local
                               ELSE v_novo.link_reuniao IS DISTINCT FROM v_e.link_reuniao
                             END
                       ORDER BY c.n);

    UPDATE public.agenda_ocorrencias o
       SET titulo = CASE WHEN 'titulo' = ANY (v_campos) THEN v_novo.titulo END,
           descricao = CASE WHEN 'descricao' = ANY (v_campos) THEN v_novo.descricao END,
           local = CASE WHEN 'local' = ANY (v_campos) THEN v_novo.local END,
           link_reuniao = CASE WHEN 'link_reuniao' = ANY (v_campos) THEN v_novo.link_reuniao END,
           campos_sobrescritos = v_campos,
           inicio = v_ini,
           fim = v_fim,
           horario_alterado = (v_ini, v_fim) IS DISTINCT FROM (v_gen_ini, v_gen_fim)
     WHERE o.id = v_o.id;

    v_notifica := v_novo.titulo IS DISTINCT FROM v_old_titulo
               OR v_novo.local IS DISTINCT FROM v_old_local
               OR v_novo.link_reuniao IS DISTINCT FROM v_old_link
               OR (v_ini, v_fim) IS DISTINCT FROM (v_o.inicio, v_o.fim);
    v_alvo := v_e.id;
    v_ret := v_o.id;

  ELSE
    -- ======== todas / seguintes: derive the series dtstart ========
    v_novo := public.agenda_validar_payload(v_conta, p_evento, v_e);
    -- [convidados] a private series has no guests: the set after this edit is
    -- the payload's list when the key is present, else the current one
    IF v_novo.privado THEN
      v_conv_n := CASE WHEN NOT (p_evento ? 'convidados') THEN cardinality(v_convs_antes)
                       WHEN jsonb_typeof(p_evento->'convidados') = 'array' THEN jsonb_array_length(p_evento->'convidados')
                       ELSE 0 END;  -- not an array: agenda_definir_convidados refuses it below
      IF v_conv_n > 0 THEN
        IF v_e.privado THEN
          RAISE EXCEPTION 'agenda: evento privado não pode ter convidados externos.';
        END IF;
        RAISE EXCEPTION 'agenda: remova os convidados externos antes de tornar o evento privado.';
      END IF;
    END IF;
    IF v_tem_horario THEN
      v_delta := v_novo.dtstart::date - (v_o.inicio AT TIME ZONE v_e.tz)::date;
      -- Moving a recurring series to another day needs an explicit regra (the
      -- form always sends one): a stored rule cannot follow a shifted date in
      -- general (biweekly sets crossing a week boundary, monthly ordinals,
      -- ate). The UI sends date-changing drags of a recurring event as esta,
      -- so this is a backstop. A same-day time change (delta 0) keeps working.
      IF v_e.freq IS NOT NULL AND NOT (p_evento ? 'regra') AND v_delta <> 0 THEN
        RAISE EXCEPTION 'agenda: para mudar o dia da repetição, edite o evento';
      END IF;
      IF v_escopo = 'todas' THEN
        v_novo.dtstart := (v_e.dtstart::date + v_delta) + v_novo.dtstart::time;
      ELSE
        v_novo.dtstart := (v_c + v_delta) + v_novo.dtstart::time;
      END IF;
    ELSIF v_escopo = 'seguintes' THEN
      v_novo.dtstart := v_c + v_e.dtstart::time;
    END IF;

    IF v_escopo = 'seguintes' THEN
      -- contagem of the new series: a payload contagem equal to the stored one
      -- (or no regra at all, a same-day drag) means "the end was not touched", whatever
      -- else the rule changed (the form re-derives dias_semana from a moved
      -- date), so the remaining count carries over (tombstones count). A
      -- different contagem is the user's new end and is taken as sent.
      v_regra_igual := NOT (p_evento ? 'regra')
        OR (v_novo.freq, v_novo.intervalo, v_novo.dias_semana, v_novo.mensal_modo, v_novo.mensal_ordinal, v_novo.ate, v_novo.contagem)
           IS NOT DISTINCT FROM (v_e.freq, v_e.intervalo, v_e.dias_semana, v_e.mensal_modo, v_e.mensal_ordinal, v_e.ate, v_e.contagem);
      IF v_e.contagem IS NOT NULL AND v_novo.contagem IS NOT DISTINCT FROM v_e.contagem THEN
        v_contagem := v_e.contagem - (SELECT count(*) FROM public.agenda_datas_regra(v_e, v_e.dtstart::date, v_c - 1));
        IF v_contagem <= 0 THEN RAISE EXCEPTION 'agenda: a repetição não gera nenhuma data'; END IF;
        v_novo.contagem := v_contagem;
      END IF;
    END IF;

    IF v_novo.dtstart::date < least(v_e.dtstart::date, v_hoje - 366) THEN
      RAISE EXCEPTION 'agenda: a data de início é antiga demais';
    END IF;
    IF v_novo.freq IS NOT NULL AND v_novo.ate IS NOT NULL
       AND v_novo.ate > (v_novo.dtstart::date + interval '5 years')::date THEN
      RAISE EXCEPTION 'agenda: repetição inválida';
    END IF;
    v_novo.dtstart := public.agenda_normalizar_dtstart(v_novo);
    v_reset := v_novo.dia_inteiro IS DISTINCT FROM v_e.dia_inteiro;

    IF v_escopo = 'todas' THEN
      v_regen := (v_novo.freq, v_novo.intervalo, v_novo.dias_semana, v_novo.mensal_modo, v_novo.mensal_ordinal, v_novo.ate, v_novo.contagem)
                   IS DISTINCT FROM (v_e.freq, v_e.intervalo, v_e.dias_semana, v_e.mensal_modo, v_e.mensal_ordinal, v_e.ate, v_e.contagem)
              OR v_novo.dtstart IS DISTINCT FROM v_e.dtstart
              OR v_novo.duracao_min IS DISTINCT FROM v_e.duracao_min
              OR v_novo.duracao_dias IS DISTINCT FROM v_e.duracao_dias
              OR v_reset;
      v_notifica := v_regen
                 OR v_novo.titulo IS DISTINCT FROM v_e.titulo
                 OR v_novo.local IS DISTINCT FROM v_e.local
                 OR v_novo.link_reuniao IS DISTINCT FROM v_e.link_reuniao;

      UPDATE public.agenda_eventos ev
         SET titulo = v_novo.titulo, descricao = v_novo.descricao, local = v_novo.local,
             link_reuniao = v_novo.link_reuniao, tipo = v_novo.tipo, cor = v_novo.cor,
             cliente_id = v_novo.cliente_id, privado = v_novo.privado, dia_inteiro = v_novo.dia_inteiro,
             dtstart = v_novo.dtstart, duracao_min = v_novo.duracao_min, duracao_dias = v_novo.duracao_dias,
             freq = v_novo.freq, intervalo = v_novo.intervalo, dias_semana = v_novo.dias_semana,
             mensal_modo = v_novo.mensal_modo, mensal_ordinal = v_novo.mensal_ordinal,
             ate = v_novo.ate, contagem = v_novo.contagem, lembretes = v_novo.lembretes,
             compartilhado_cliente = v_novo.compartilhado_cliente  -- [hub]
       WHERE ev.id = v_e.id;

      IF p_participantes IS NOT NULL THEN
        SELECT d.adicionados, d.removidos INTO v_add, v_rem
          FROM public.agenda_definir_participantes(v_e.id, v_conta, v_e.organizador_id, p_participantes) d;
      END IF;
      -- [convidados] after the series UPDATE (privado is the new value)
      IF p_evento ? 'convidados' THEN
        SELECT d.adicionados, d.removidos INTO v_conv_add, v_conv_rem
          FROM public.agenda_definir_convidados(v_e.id, p_evento->'convidados') d;
      END IF;

      -- [hub] before agenda_regenerar deletes or moves rows: pending requests
      -- are superseded (the cascade would erase them); a cliente switch or
      -- un-share also drops the previous cliente's answers
      v_cli_depois := CASE WHEN v_novo.compartilhado_cliente THEN v_novo.cliente_id END;
      IF v_regen OR v_cli_depois IS DISTINCT FROM v_cli_antes THEN
        PERFORM public.agenda_cliente_substituir_pedidos(v_e.id);
      END IF;
      IF v_cli_antes IS NOT NULL AND v_cli_depois IS DISTINCT FROM v_cli_antes THEN
        DELETE FROM public.agenda_respostas_cliente rc
         USING public.agenda_ocorrencias o
         WHERE rc.ocorrencia_id = o.id AND o.evento_id = v_e.id AND rc.cliente_id = v_cli_antes;
      END IF;

      IF v_regen THEN
        -- a one-off keeps its single occurrence (id, RSVPs, deep links): move
        -- its identity date along before regenerating
        IF v_e.freq IS NULL AND v_novo.freq IS NULL THEN
          UPDATE public.agenda_ocorrencias o
             SET data_original = v_novo.dtstart::date
           WHERE o.evento_id = v_e.id;
        END IF;
        PERFORM public.agenda_regenerar(v_e.id, v_reset);
      END IF;
      v_alvo := v_e.id;

    ELSE
      -- ======== seguintes: split at v_c ========
      v_notifica := NOT v_regra_igual
                 OR v_novo.dtstart IS DISTINCT FROM (v_c + v_e.dtstart::time)
                 OR v_novo.duracao_min IS DISTINCT FROM v_e.duracao_min
                 OR v_novo.duracao_dias IS DISTINCT FROM v_e.duracao_dias
                 OR v_reset
                 OR v_novo.titulo IS DISTINCT FROM v_e.titulo
                 OR v_novo.local IS DISTINCT FROM v_e.local
                 OR v_novo.link_reuniao IS DISTINCT FROM v_e.link_reuniao;

      -- [hub] before the split moves and deletes rows from the cut: pending
      -- requests there are superseded; a cliente switch or un-share also drops
      -- the previous cliente's answers on those rows
      v_cli_depois := CASE WHEN v_novo.compartilhado_cliente THEN v_novo.cliente_id END;
      PERFORM public.agenda_cliente_substituir_pedidos(v_e.id, NULL, v_c);
      IF v_cli_antes IS NOT NULL AND v_cli_depois IS DISTINCT FROM v_cli_antes THEN
        DELETE FROM public.agenda_respostas_cliente rc
         USING public.agenda_ocorrencias o
         WHERE rc.ocorrencia_id = o.id AND o.evento_id = v_e.id AND o.data_original >= v_c
           AND rc.cliente_id = v_cli_antes;
      END IF;

      -- 1. the old series ends the day before the cut
      UPDATE public.agenda_eventos ev
         SET ate = v_c - 1, contagem = NULL, materializacao_completa = true
       WHERE ev.id = v_e.id;

      -- 2. the new series, with the participants (and their series answers) copied
      INSERT INTO public.agenda_eventos (
        conta_id, organizador_id, titulo, descricao, local, link_reuniao, tipo, cor, cliente_id,
        privado, dia_inteiro, tz, dtstart, duracao_min, duracao_dias, freq, intervalo, dias_semana,
        mensal_modo, mensal_ordinal, ate, contagem, lembretes, serie_origem_id,
        compartilhado_cliente)  -- [hub] the tail stays shared
      VALUES (
        v_conta, v_e.organizador_id, v_novo.titulo, v_novo.descricao, v_novo.local, v_novo.link_reuniao,
        v_novo.tipo, v_novo.cor, v_novo.cliente_id, v_novo.privado, v_novo.dia_inteiro, v_e.tz,
        v_novo.dtstart, v_novo.duracao_min, v_novo.duracao_dias, v_novo.freq, v_novo.intervalo,
        v_novo.dias_semana, v_novo.mensal_modo, v_novo.mensal_ordinal, v_novo.ate, v_novo.contagem,
        v_novo.lembretes, v_e.id,
        v_novo.compartilhado_cliente)  -- [hub]
      RETURNING id INTO v_alvo;
      SELECT * INTO v_novo FROM public.agenda_eventos ev WHERE ev.id = v_alvo;

      INSERT INTO public.agenda_participantes (evento_id, conta_id, user_id, resposta, respondido_em)
      SELECT v_alvo, v_conta, ap.user_id, ap.resposta, ap.respondido_em
        FROM public.agenda_participantes ap WHERE ap.evento_id = v_e.id;
      -- [convidados] and the active guests, with the SAME token and the source
      -- row's criado_em/adicionado_por (a copy is not a new invite: no audit,
      -- no daily cap)
      INSERT INTO public.agenda_convidados (conta_id, evento_id, email, nome, token, adicionado_por, criado_em)
      SELECT v_conta, v_alvo, g.email, g.nome, g.token, g.adicionado_por, g.criado_em
        FROM public.agenda_convidados g
       WHERE g.evento_id = v_e.id AND g.removido_em IS NULL
       ORDER BY g.id;

      -- 3. old rows from the cut: those on the new rule move over (exceptions,
      --    tombstones and per-occurrence RSVPs preserved), the rest go
      v_h := (v_hoje + interval '24 months')::date;
      v_h := greatest(coalesce(v_e.horizonte_ate, v_h), v_h);
      v_datas := coalesce(ARRAY(SELECT d FROM public.agenda_datas_regra(v_novo, v_novo.dtstart::date, v_h) d), '{}');
      UPDATE public.agenda_ocorrencias o
         SET evento_id = v_alvo
       WHERE o.evento_id = v_e.id AND o.data_original >= v_c AND o.data_original = ANY (v_datas);
      -- [convidados] the guests' answers on the moved rows follow their copy
      UPDATE public.agenda_respostas_convidado r
         SET convidado_id = c.id
        FROM public.agenda_convidados h, public.agenda_convidados c, public.agenda_ocorrencias o
       WHERE r.convidado_id = h.id AND h.evento_id = v_e.id
         AND c.evento_id = v_alvo AND c.token = h.token AND c.removido_em IS NULL
         AND o.id = r.ocorrencia_id AND o.evento_id = v_alvo;
      DELETE FROM public.agenda_ocorrencias o
       WHERE o.evento_id = v_e.id AND o.data_original >= v_c;
      UPDATE public.agenda_ocorrencias o
         SET inicio = f.inicio,
             fim = f.fim,
             horario_alterado = CASE WHEN v_reset THEN false ELSE o.horario_alterado END
        FROM public.agenda_ocorrencias o2
        CROSS JOIN LATERAL public.agenda_inicio_fim(v_novo, o2.data_original) f
       WHERE o.id = o2.id AND o.evento_id = v_alvo
         AND (v_reset OR NOT o.horario_alterado);
      PERFORM public.agenda_materializar(v_alvo, v_h);

      -- participants left out lose their answers on the moved rows (helper)
      IF p_participantes IS NOT NULL THEN
        SELECT d.adicionados, d.removidos INTO v_add, v_rem
          FROM public.agenda_definir_participantes(v_alvo, v_conta, v_e.organizador_id, p_participantes) d;
      END IF;
      -- [convidados] a guest added or removed in a seguintes edit concerns the
      -- tail only (its copy on v_alvo)
      IF p_evento ? 'convidados' THEN
        SELECT d.adicionados, d.removidos INTO v_conv_add, v_conv_rem
          FROM public.agenda_definir_convidados(v_alvo, p_evento->'convidados') d;
      END IF;

      -- 4. an old series left without a live occurrence is deleted
      IF NOT EXISTS (SELECT 1 FROM public.agenda_ocorrencias o WHERE o.evento_id = v_e.id AND NOT o.cancelada) THEN
        DELETE FROM public.agenda_eventos ev WHERE ev.id = v_e.id;
      END IF;
    END IF;

    -- the edited occurrence takes the times of this edit even if it had been
    -- moved by hand before (other hand-moved occurrences keep theirs)
    IF v_tem_horario THEN
      SELECT * INTO v_novo FROM public.agenda_eventos ev WHERE ev.id = v_alvo;
      -- (its data_original as stored now: a one-off moved it along)
      UPDATE public.agenda_ocorrencias o
         SET inicio = f.inicio, fim = f.fim, horario_alterado = false
        FROM public.agenda_ocorrencias o2
        CROSS JOIN LATERAL public.agenda_inicio_fim(v_novo, o2.data_original) f
       WHERE o.id = o2.id AND o.id = v_o.id AND o.evento_id = v_alvo;
    END IF;

    SELECT o.id INTO v_ret FROM public.agenda_ocorrencias o
     WHERE o.evento_id = v_alvo AND NOT o.cancelada
     ORDER BY (o.id = v_o.id) DESC, (o.data_original >= v_c) DESC, o.data_original
     LIMIT 1;
  END IF;

  -- ---- [hub] e-mail to the client ----
  -- Same cliente before and after: 'alteracao' with the affected occurrences
  -- whose inicio/fim/titulo/descricao/local/link changed (rows the edit
  -- deleted enter as 'cancelada' with their previous content). Sharing turned
  -- off or the cliente switched: 'cancelamento' to the previous cliente; turned
  -- on or switched: 'convite' to the new one. A split enqueues under the new
  -- series (v_alvo). Inside agenda_remarcacao_resolver the 'alteracao' becomes
  -- 'remarcacao_aceita' (GUC agenda.remarcacao, see agenda_cliente_enfileirar).
  -- [convidados] Guests, from their own unbounded snapshots
  -- (agenda_convidados_snapshot): the ones kept get the 'alteracao' diff of
  -- v_antes_g (computed once, before the bump); the ones added get 'convite'
  -- with the series' (the tail's) next occurrences; the ones removed get
  -- 'cancelamento' with what they knew (v_antes_g). Every list is built first,
  -- then agenda_envios_enfileirar bumps their union once and enqueues them.
  SELECT CASE WHEN ev.compartilhado_cliente THEN ev.cliente_id END INTO v_cli_depois
    FROM public.agenda_eventos ev WHERE ev.id = v_alvo;
  v_conv_manter := ARRAY(SELECT g.id FROM public.agenda_convidados g
                          WHERE g.evento_id = v_alvo AND g.removido_em IS NULL AND NOT (g.id = ANY (v_conv_add))
                          ORDER BY g.id);
  v_cancel := (SELECT coalesce(jsonb_agg(x || '{"estado":"cancelada"}'::jsonb), '[]'::jsonb) FROM jsonb_array_elements(v_antes) x);
  v_cancel_g := (SELECT coalesce(jsonb_agg(x || '{"estado":"cancelada"}'::jsonb), '[]'::jsonb) FROM jsonb_array_elements(v_antes_g) x);
  IF v_cli_antes IS NOT NULL AND v_cli_depois IS NOT DISTINCT FROM v_cli_antes THEN
    v_diff := public.agenda_cliente_diff(v_antes,
      public.agenda_cliente_ocorrencias_snapshot(v_alvo, 'ativa', CASE WHEN v_escopo = 'esta' THEN v_o.id END));
  END IF;
  IF cardinality(v_conv_manter) > 0 THEN
    v_diff_g := public.agenda_cliente_diff(v_antes_g,
      public.agenda_convidados_snapshot(v_alvo, 'ativa', CASE WHEN v_escopo = 'esta' THEN v_o.id END));
  END IF;
  IF (v_cli_antes IS NULL OR v_cli_depois IS DISTINCT FROM v_cli_antes) AND v_cli_depois IS NOT NULL THEN
    v_snap := public.agenda_cliente_ocorrencias_snapshot(v_alvo, 'ativa');
  END IF;
  IF cardinality(v_conv_add) > 0 THEN
    v_snap_g := public.agenda_convidados_snapshot(v_alvo, 'ativa');
  END IF;
  IF v_cli_antes IS NOT NULL AND v_cli_depois IS NOT DISTINCT FROM v_cli_antes THEN
    v_envios := v_envios || jsonb_build_array(jsonb_build_object(
      'cliente', v_cli_antes, 'convidado', NULL, 'tipo', 'alteracao', 'ocorrencias', v_diff));
  ELSE
    IF v_cli_antes IS NOT NULL THEN
      v_envios := v_envios || jsonb_build_array(jsonb_build_object(
        'cliente', v_cli_antes, 'convidado', NULL, 'tipo', 'cancelamento', 'ocorrencias', v_cancel));
    END IF;
    IF v_cli_depois IS NOT NULL THEN
      v_envios := v_envios || jsonb_build_array(jsonb_build_object(
        'cliente', v_cli_depois, 'convidado', NULL, 'tipo', 'convite', 'ocorrencias', v_snap));
    END IF;
  END IF;
  v_envios := v_envios
           || public.agenda_envios_convidados(v_conv_manter, 'alteracao', v_diff_g)
           || public.agenda_envios_convidados(v_conv_add, 'convite', v_snap_g)
           || public.agenda_envios_convidados(v_conv_rem, 'cancelamento', v_cancel_g);
  PERFORM public.agenda_envios_enfileirar(v_conta, v_alvo, v_envios);
  -- [convidados] a removed guest's pending items become a full cancellation
  PERFORM public.agenda_convidados_perda(v_alvo, v_conv_rem);

  -- ---- notifications (the actor is excluded by agenda_notificar) ----
  IF v_notifica THEN
    v_destinatarios := ARRAY(SELECT ap.user_id FROM public.agenda_participantes ap
                              WHERE ap.evento_id = v_alvo AND NOT (ap.user_id = ANY (v_add)));
    PERFORM public.agenda_notificar(v_conta, v_alvo, v_ret, 'event_updated', v_destinatarios, v_user,
                                    jsonb_build_object('escopo', v_escopo));
  END IF;
  IF cardinality(v_add) > 0 THEN
    PERFORM public.agenda_notificar(v_conta, v_alvo, v_ret, 'event_invited', v_add, v_user,
                                    jsonb_build_object('escopo', v_escopo));
  END IF;
  IF cardinality(v_rem) > 0 THEN
    PERFORM public.agenda_notificar(v_conta, v_alvo, v_ret, 'event_cancelled', v_rem, v_user,
                                    jsonb_build_object('escopo', v_escopo, 'motivo', 'removido'));
  END IF;

  RETURN v_ret;
END $$;
REVOKE ALL ON FUNCTION public.agenda_evento_editar(bigint, text, jsonb, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agenda_evento_editar(bigint, text, jsonb, uuid[]) TO authenticated, service_role;

-- ---- client RPC: delete ----
-- 'esta' leaves a tombstone (EXDATE); 'seguintes' ends the series the day
-- before (and drops the rows from there); 'todas' deletes the series (cascade).
-- A series left without a live occurrence (and nothing more to materialize) is
-- deleted. Participants except the actor get event_cancelled BEFORE the delete,
-- so the notification still carries the title and date.
CREATE OR REPLACE FUNCTION public.agenda_evento_excluir(p_ocorrencia_id bigint, p_escopo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conta uuid;
  v_user uuid;
  v_o public.agenda_ocorrencias;
  v_e public.agenda_eventos;
  v_escopo text;
  v_primeira boolean;
  v_convs bigint[];               -- [convidados] active guests, read before any DELETE
  v_envios jsonb := '[]'::jsonb;  -- [convidados]
BEGIN
  v_conta := get_my_conta_id(); v_user := auth.uid();
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'agenda: sessão sem workspace ativo'; END IF;
  IF NOT public.effective_plan_feature(v_conta, 'feature_agenda') THEN
    RAISE EXCEPTION 'feature_disabled:feature_agenda' USING ERRCODE = 'P0001';
  END IF;
  IF p_escopo IS NULL OR p_escopo NOT IN ('esta', 'seguintes', 'todas') THEN
    RAISE EXCEPTION 'agenda: escopo inválido';
  END IF;

  SELECT o.* INTO v_o FROM public.agenda_ocorrencias o
   WHERE o.id = p_ocorrencia_id AND o.conta_id = v_conta AND NOT o.cancelada;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;
  SELECT e.* INTO v_e FROM public.agenda_eventos e
   WHERE e.id = v_o.evento_id AND e.conta_id = v_conta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;
  IF NOT public.agenda_pode_editar(v_e, v_user, v_conta) THEN
    RAISE EXCEPTION 'agenda: você não pode editar este evento';
  END IF;
  SELECT o.* INTO v_o FROM public.agenda_ocorrencias o
   WHERE o.id = p_ocorrencia_id AND o.evento_id = v_e.id AND NOT o.cancelada;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;

  v_primeira := NOT EXISTS (SELECT 1 FROM public.agenda_ocorrencias o
                             WHERE o.evento_id = v_e.id AND NOT o.cancelada AND o.data_original < v_o.data_original);
  IF v_e.freq IS NULL OR (p_escopo = 'seguintes' AND v_primeira) THEN
    v_escopo := 'todas';
  ELSE
    v_escopo := p_escopo;
  END IF;

  PERFORM public.agenda_notificar(
    v_conta, v_e.id, v_o.id, 'event_cancelled',
    ARRAY(SELECT ap.user_id FROM public.agenda_participantes ap WHERE ap.evento_id = v_e.id),
    v_user, jsonb_build_object('escopo', v_escopo));

  -- [hub] before any delete: pending reschedule requests of the affected
  -- occurrences are superseded, and a shared series sends the client a
  -- 'cancelamento' whose snapshot survives the DELETE below
  PERFORM public.agenda_cliente_substituir_pedidos(v_e.id,
    CASE WHEN v_escopo = 'esta' THEN v_o.id END,
    CASE WHEN v_escopo = 'seguintes' THEN v_o.data_original END);
  -- [convidados] and each active guest the same 'cancelamento' (read before
  -- the DELETE: the cascade would erase the guests), one bump for all
  v_convs := ARRAY(SELECT g.id FROM public.agenda_convidados g
                    WHERE g.evento_id = v_e.id AND g.removido_em IS NULL ORDER BY g.id);
  IF (v_e.compartilhado_cliente AND v_e.cliente_id IS NOT NULL) OR cardinality(v_convs) > 0 THEN
    IF v_e.compartilhado_cliente AND v_e.cliente_id IS NOT NULL THEN
      v_envios := jsonb_build_array(jsonb_build_object('cliente', v_e.cliente_id, 'convidado', NULL,
        'tipo', 'cancelamento', 'ocorrencias', public.agenda_cliente_ocorrencias_snapshot(v_e.id, 'cancelada',
          CASE WHEN v_escopo = 'esta' THEN v_o.id END,
          CASE WHEN v_escopo = 'seguintes' THEN v_o.data_original END)));
    END IF;
    -- the guests' list has no 90-day bound (agenda_convidados_snapshot)
    v_envios := v_envios || public.agenda_envios_convidados(v_convs, 'cancelamento',
      public.agenda_convidados_snapshot(v_e.id, 'cancelada',
        CASE WHEN v_escopo = 'esta' THEN v_o.id END,
        CASE WHEN v_escopo = 'seguintes' THEN v_o.data_original END));
    PERFORM public.agenda_envios_enfileirar(v_conta, v_e.id, v_envios);
    -- [convidados] the whole series goes: the guests' pending items become a
    -- full cancellation (esta/seguintes keep the guests, nothing to convert)
    IF v_escopo = 'todas' THEN
      PERFORM public.agenda_convidados_perda(v_e.id, v_convs);
    END IF;
  END IF;

  IF v_escopo = 'todas' THEN
    DELETE FROM public.agenda_eventos ev WHERE ev.id = v_e.id;
    RETURN;
  ELSIF v_escopo = 'esta' THEN
    UPDATE public.agenda_ocorrencias o SET cancelada = true WHERE o.id = v_o.id;
  ELSE
    UPDATE public.agenda_eventos ev
       SET ate = v_o.data_original - 1, contagem = NULL, materializacao_completa = true
     WHERE ev.id = v_e.id;
    DELETE FROM public.agenda_ocorrencias o
     WHERE o.evento_id = v_e.id AND o.data_original >= v_o.data_original;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.agenda_ocorrencias o WHERE o.evento_id = v_e.id AND NOT o.cancelada)
     AND EXISTS (SELECT 1 FROM public.agenda_eventos ev WHERE ev.id = v_e.id AND ev.materializacao_completa) THEN
    DELETE FROM public.agenda_eventos ev WHERE ev.id = v_e.id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.agenda_evento_excluir(bigint, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agenda_evento_excluir(bigint, text) TO authenticated, service_role;

-- ============ (8) QUEUE CLAIM, RECIPIENT-AWARE ============
-- Body copied verbatim from 20261007000001_agenda_hub.sql; changes marked
-- "-- [convidados]". Internal (service_role). First settles what must no
-- longer be claimed: expired leases at the 3-attempt cap -> 'falhou'; due
-- items whose gate is closed -> 'descartado' (no retry).
--  * cliente items: feature_agenda off, cliente not 'ativo', empty e-mail,
--    send_event_email off, unsubscribed, or (except a cancellation, i.e. tipo
--    cancelamento or a snapshot with no 'ativa' entry) the event no longer
--    shared with this cliente.
--  * [convidados] guest items: feature_agenda off; the address in the
--    workspace's agenda_convidados_bloqueio; or (except a cancellation, same
--    rule as the cliente) the series private or the guest row removed or gone.
--    A cancellation always goes out: removing the guests to make the series
--    private, removing one, or deleting the series must reach them.
-- Then claims due 'pendente' items and expired leases (FOR UPDATE SKIP
-- LOCKED): status 'enviando', a 2-minute lease, one more attempt. Returns
-- what the e-mail needs, the brand header included, with a discriminated
-- recipient: destinatario 'cliente' | 'convidado', email, nome, convidado_id,
-- convidado_token (NULL for a cliente and for a removed or deleted guest row),
-- organizador_nome (NULL once the series is gone) and organizador_email
-- (lower-case auth e-mail, NULL when the organizer is no longer a member or
-- the series is gone). cliente_email / cliente_nome stay for compatibility
-- (NULL for guests).
CREATE OR REPLACE FUNCTION public.agenda_cliente_claim_emails(p_limit int DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v jsonb;
BEGIN
  UPDATE public.agenda_emails_cliente q
     SET status = 'falhou', lease_ate = NULL
   WHERE q.status = 'enviando' AND q.lease_ate < now() AND q.tentativas >= 3;

  UPDATE public.agenda_emails_cliente q
     SET status = 'descartado', lease_ate = NULL
    FROM public.clientes c
   WHERE c.id = q.cliente_id AND c.conta_id = q.conta_id
     AND ((q.status = 'pendente' AND q.enviar_apos <= now()) OR (q.status = 'enviando' AND q.lease_ate < now()))
     AND (NOT public.effective_plan_feature(q.conta_id, 'feature_agenda')
          OR c.status IS DISTINCT FROM 'ativo'
          OR coalesce(btrim(c.email), '') = ''
          OR NOT c.send_event_email
          OR c.event_email_unsub_at IS NOT NULL
          OR (q.tipo <> 'cancelamento'
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(q.ocorrencias) y WHERE y->>'estado' = 'ativa')
              AND NOT EXISTS (SELECT 1 FROM public.agenda_eventos e
                               WHERE e.id = q.evento_id AND e.conta_id = q.conta_id
                                 AND e.compartilhado_cliente AND e.cliente_id = q.cliente_id AND NOT e.privado)));

  -- [convidados] the guest gates, before the claim below takes the item
  UPDATE public.agenda_emails_cliente q
     SET status = 'descartado', lease_ate = NULL
   WHERE q.convidado_id IS NOT NULL
     AND ((q.status = 'pendente' AND q.enviar_apos <= now()) OR (q.status = 'enviando' AND q.lease_ate < now()))
     AND (NOT public.effective_plan_feature(q.conta_id, 'feature_agenda')
          OR EXISTS (SELECT 1 FROM public.agenda_convidados_bloqueio b
                      WHERE b.conta_id = q.conta_id AND b.email = lower(q.convidado_email))
          OR (q.tipo <> 'cancelamento'
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(q.ocorrencias) y WHERE y->>'estado' = 'ativa')
              AND (EXISTS (SELECT 1 FROM public.agenda_eventos e
                            WHERE e.id = q.evento_id AND e.conta_id = q.conta_id AND e.privado)
                   OR NOT EXISTS (SELECT 1 FROM public.agenda_convidados g
                                   WHERE g.id = q.convidado_id AND g.conta_id = q.conta_id AND g.removido_em IS NULL))));

  WITH alvo AS (
    SELECT q.id FROM public.agenda_emails_cliente q
     WHERE ((q.status = 'pendente' AND q.enviar_apos <= now()) OR (q.status = 'enviando' AND q.lease_ate < now()))
       AND q.tentativas < 3
     ORDER BY q.enviar_apos, q.id
     LIMIT greatest(coalesce(p_limit, 20), 0)
     FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.agenda_emails_cliente q
       SET status = 'enviando', lease_ate = now() + interval '2 minutes', tentativas = q.tentativas + 1
      FROM alvo a
     WHERE q.id = a.id
    RETURNING q.*
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', u.id, 'versao', u.versao, 'tipo', u.tipo, 'conta_id', u.conta_id, 'cliente_id', u.cliente_id,
           'evento_id', u.evento_id, 'tentativas', u.tentativas,
           'ocorrencias', u.ocorrencias, 'remarcacao', u.remarcacao,
           'cliente_email', btrim(c.email), 'cliente_nome', c.nome,
           'workspace_nome', w.name, 'brand_color', w.brand_color, 'logo_url', w.logo_url,
           -- [convidados]
           'destinatario', CASE WHEN u.convidado_id IS NOT NULL THEN 'convidado' ELSE 'cliente' END,
           'email', CASE WHEN u.convidado_id IS NOT NULL THEN u.convidado_email ELSE btrim(c.email) END,
           'nome', CASE WHEN u.convidado_id IS NOT NULL THEN g.nome ELSE c.nome END,
           'convidado_id', u.convidado_id,
           'convidado_token', CASE WHEN g.removido_em IS NULL THEN g.token END,
           'organizador_nome', pr.nome,
           'organizador_email', CASE WHEN wm.user_id IS NOT NULL THEN lower(au.email) END)
         ORDER BY u.enviar_apos, u.id), '[]'::jsonb)
    INTO v
    FROM upd u
    LEFT JOIN public.clientes c ON c.id = u.cliente_id AND c.conta_id = u.conta_id      -- [convidados] LEFT
    LEFT JOIN public.agenda_convidados g ON g.id = u.convidado_id AND g.conta_id = u.conta_id
    LEFT JOIN public.agenda_eventos e ON e.id = u.evento_id AND e.conta_id = u.conta_id
    LEFT JOIN public.profiles pr ON pr.id = e.organizador_id
    LEFT JOIN public.workspace_members wm ON wm.workspace_id = u.conta_id AND wm.user_id = e.organizador_id
    LEFT JOIN auth.users au ON au.id = e.organizador_id
    JOIN public.workspaces w ON w.id = u.conta_id;
  RETURN v;
END $$;

-- ============ (9) CONVITE RPCs (agenda-convite edge function) ============
-- Called with the service role after the function checked the token format
-- (^[0-9a-f]{64}$). Errors: RAISE 'agenda_convite:<codigo>' (P0001), codes
-- nao_encontrado, horario_mudou, ja_aconteceu, desligado; anything else (a
-- malformed argument) is a plain error the function answers with 500. A guest
-- sees title, times in the event's tz, place, meeting link, description,
-- workspace name/brand and the organizer's name: never the other
-- participants, guests, cliente, tipo, cor or reminders.

-- Internal: the ConviteItem of one occurrence for the guest row p_convidado,
-- or NULL when the guest may not see it (row removed, occurrence of another
-- series, cancelled, series private). The fields of agenda_hub_item without
-- remarcacao (expressions of agenda_listar; keep them in sync), resposta =
-- the guest's effective answer (valid only for the current inicio).
CREATE OR REPLACE FUNCTION public.agenda_convite_item(p_convidado bigint, p_ocorrencia bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
           'ocorrencia_id', o.id,
           'sequencia', o.sequencia,
           'inicio', o.inicio,
           'fim', o.fim,
           'dia_inteiro', e.dia_inteiro,
           'data_inicio_local', (o.inicio AT TIME ZONE e.tz)::date,
           'data_fim_local', CASE WHEN e.dia_inteiro THEN (o.fim AT TIME ZONE e.tz)::date
                                  ELSE ((o.fim AT TIME ZONE e.tz) - interval '1 microsecond')::date + 1 END,
           'tz', e.tz,
           'titulo', CASE WHEN 'titulo' = ANY (o.campos_sobrescritos) THEN o.titulo ELSE e.titulo END,
           'descricao', CASE WHEN 'descricao' = ANY (o.campos_sobrescritos) THEN o.descricao ELSE e.descricao END,
           'local', CASE WHEN 'local' = ANY (o.campos_sobrescritos) THEN o.local ELSE e.local END,
           'link_reuniao', CASE WHEN 'link_reuniao' = ANY (o.campos_sobrescritos) THEN o.link_reuniao ELSE e.link_reuniao END,
           'resposta', CASE WHEN rg.inicio_respondido = o.inicio THEN rg.resposta END)
    FROM public.agenda_convidados g
    JOIN public.agenda_ocorrencias o ON o.evento_id = g.evento_id AND o.conta_id = g.conta_id
    JOIN public.agenda_eventos e ON e.id = o.evento_id AND e.conta_id = g.conta_id
    LEFT JOIN public.agenda_respostas_convidado rg ON rg.ocorrencia_id = o.id AND rg.convidado_id = g.id
   WHERE g.id = p_convidado AND g.removido_em IS NULL
     AND o.id = p_ocorrencia AND NOT o.cancelada AND NOT e.privado;
$$;

-- The rate-limit identity of a token (index lookup only, no gate): the newest
-- active guest row with that token, {convidado_id, conta_id}, or NULL.
CREATE OR REPLACE FUNCTION public.agenda_convite_resolver(p_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('convidado_id', g.id, 'conta_id', g.conta_id)
    FROM public.agenda_convidados g
   WHERE g.token = p_token AND g.removido_em IS NULL
   ORDER BY g.id DESC
   LIMIT 1;
$$;

-- The invite page. The token resolves to every active guest row carrying it
-- (one per series after seguintes splits; the newest row's workspace wins,
-- so all share conta_id), minus private series. Unknown or removed token,
-- flag off, or nothing left: {"estado":"nao_encontrado"}. Otherwise the
-- envelope with the newest row's id (rate-limit key), the workspace brand,
-- the organizer's name and title of the newest row's series, and itens = the
-- non-cancelled occurrences of those series with fim >= now() - 30 days,
-- ORDER BY inicio, id, at most 100, each the ConviteItem of its series' row.
CREATE OR REPLACE FUNCTION public.agenda_convite_ler(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_g public.agenda_convidados;
  v_e public.agenda_eventos;
  v_itens jsonb;
BEGIN
  SELECT g.* INTO v_g
    FROM public.agenda_convidados g
    JOIN public.agenda_eventos e ON e.id = g.evento_id AND e.conta_id = g.conta_id
   WHERE g.token = p_token AND g.removido_em IS NULL AND NOT e.privado
   ORDER BY g.id DESC
   LIMIT 1;
  IF NOT FOUND OR NOT public.effective_plan_feature(v_g.conta_id, 'feature_agenda') THEN
    RETURN jsonb_build_object('estado', 'nao_encontrado');
  END IF;
  SELECT e.* INTO v_e FROM public.agenda_eventos e WHERE e.id = v_g.evento_id;

  SELECT coalesce(jsonb_agg(public.agenda_convite_item(x.convidado_id, x.id) ORDER BY x.inicio, x.id), '[]'::jsonb) INTO v_itens
    FROM (
      SELECT o.id, o.inicio, g.id AS convidado_id
        FROM public.agenda_convidados g
        JOIN public.agenda_eventos e ON e.id = g.evento_id AND e.conta_id = g.conta_id
        JOIN public.agenda_ocorrencias o ON o.evento_id = e.id AND o.conta_id = e.conta_id
       WHERE g.token = p_token AND g.removido_em IS NULL AND g.conta_id = v_g.conta_id AND NOT e.privado
         AND NOT o.cancelada
         AND o.fim >= now() - interval '30 days'
       ORDER BY o.inicio, o.id
       LIMIT 100
    ) x;

  RETURN jsonb_build_object(
    'estado', 'ok',
    'convidado_id', v_g.id,
    'conta_id', v_g.conta_id,
    'workspace', (SELECT jsonb_build_object('nome', w.name, 'brand_color', w.brand_color, 'logo_url', w.logo_url)
                    FROM public.workspaces w WHERE w.id = v_g.conta_id),
    'organizador_nome', (SELECT pr.nome FROM public.profiles pr WHERE pr.id = v_e.organizador_id),
    'titulo', v_e.titulo,
    'itens', v_itens);
END $$;

-- One occurrence for the .ics download: its ConviteItem, or NULL when the
-- token has no active row on that occurrence's series, the flag is off or the
-- guest may not see it.
CREATE OR REPLACE FUNCTION public.agenda_convite_ocorrencia(p_token text, p_ocorrencia bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_g public.agenda_convidados;
BEGIN
  SELECT g.* INTO v_g
    FROM public.agenda_ocorrencias o
    JOIN public.agenda_convidados g ON g.evento_id = o.evento_id AND g.conta_id = o.conta_id
   WHERE o.id = p_ocorrencia AND g.token = p_token AND g.removido_em IS NULL;
  IF NOT FOUND OR NOT public.effective_plan_feature(v_g.conta_id, 'feature_agenda') THEN
    RETURN NULL;
  END IF;
  RETURN public.agenda_convite_item(v_g.id, p_ocorrencia);
END $$;

-- The guest confirms (sim) or declines (nao) one occurrence, until its end.
-- p_inicio_visto is the inicio the page showed: a different current inicio
-- (timestamptz comparison) is horario_mudou. Lock order of the edit RPCs:
-- series (FOR SHARE) then the occurrence (FOR UPDATE); the guest row is
-- re-read after the series lock (a concurrent split moves occurrences and
-- copies guests). The team (agenda_cliente_destinatarios) gets
-- event_guest_rsvp only when the effective answer changes.
CREATE OR REPLACE FUNCTION public.agenda_convite_responder(
  p_token text, p_ocorrencia bigint, p_resposta text, p_inicio_visto timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_o public.agenda_ocorrencias;
  v_e public.agenda_eventos;
  v_g public.agenda_convidados;
  v_antes text;
BEGIN
  IF p_resposta IS NULL OR p_resposta NOT IN ('sim', 'nao') THEN
    RAISE EXCEPTION 'agenda_convite: resposta inválida' USING ERRCODE = '22023';
  END IF;

  SELECT o.* INTO v_o FROM public.agenda_ocorrencias o WHERE o.id = p_ocorrencia;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda_convite:nao_encontrado' USING ERRCODE = 'P0001'; END IF;
  SELECT g.* INTO v_g FROM public.agenda_convidados g
   WHERE g.token = p_token AND g.removido_em IS NULL AND g.evento_id = v_o.evento_id AND g.conta_id = v_o.conta_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda_convite:nao_encontrado' USING ERRCODE = 'P0001'; END IF;
  IF NOT public.effective_plan_feature(v_g.conta_id, 'feature_agenda') THEN
    RAISE EXCEPTION 'agenda_convite:desligado' USING ERRCODE = 'P0001';
  END IF;

  SELECT e.* INTO v_e FROM public.agenda_eventos e WHERE e.id = v_o.evento_id AND e.conta_id = v_g.conta_id FOR SHARE;
  IF NOT FOUND OR v_e.privado THEN RAISE EXCEPTION 'agenda_convite:nao_encontrado' USING ERRCODE = 'P0001'; END IF;
  SELECT o.* INTO v_o FROM public.agenda_ocorrencias o
   WHERE o.id = p_ocorrencia AND o.evento_id = v_e.id AND NOT o.cancelada FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda_convite:nao_encontrado' USING ERRCODE = 'P0001'; END IF;
  SELECT g.* INTO v_g FROM public.agenda_convidados g
   WHERE g.token = p_token AND g.removido_em IS NULL AND g.evento_id = v_e.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda_convite:nao_encontrado' USING ERRCODE = 'P0001'; END IF;

  IF v_o.fim <= now() THEN RAISE EXCEPTION 'agenda_convite:ja_aconteceu' USING ERRCODE = 'P0001'; END IF;
  IF p_inicio_visto IS DISTINCT FROM v_o.inicio THEN RAISE EXCEPTION 'agenda_convite:horario_mudou' USING ERRCODE = 'P0001'; END IF;

  SELECT CASE WHEN rg.inicio_respondido = v_o.inicio THEN rg.resposta END
    INTO v_antes FROM public.agenda_respostas_convidado rg
   WHERE rg.ocorrencia_id = v_o.id AND rg.convidado_id = v_g.id;

  INSERT INTO public.agenda_respostas_convidado AS rg (ocorrencia_id, convidado_id, conta_id, resposta, respondido_em, inicio_respondido)
  VALUES (v_o.id, v_g.id, v_g.conta_id, p_resposta, now(), v_o.inicio)
  ON CONFLICT (ocorrencia_id, convidado_id) DO UPDATE
     SET resposta = EXCLUDED.resposta, respondido_em = EXCLUDED.respondido_em,
         inicio_respondido = EXCLUDED.inicio_respondido;

  IF v_antes IS DISTINCT FROM p_resposta THEN
    PERFORM public.agenda_notificar(
      v_g.conta_id, v_e.id, v_o.id, 'event_guest_rsvp',
      public.agenda_cliente_destinatarios(v_g.conta_id, v_e.organizador_id), NULL,
      jsonb_build_object('convidado_nome', v_g.nome, 'convidado_email', v_g.email, 'resposta', p_resposta,
                         'data_inicio_local', to_char((v_o.inicio AT TIME ZONE v_e.tz)::date, 'YYYY-MM-DD')));
  END IF;

  RETURN public.agenda_convite_item(v_g.id, v_o.id);
END $$;

-- Unsubscribe ({g: convidado_id} token of client-email-unsub): that
-- workspace sends no more Agenda e-mail to the address of this guest row
-- (removed rows included: the link of a cancellation e-mail still works).
CREATE OR REPLACE FUNCTION public.agenda_convite_descadastrar(p_convidado bigint)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.agenda_convidados_bloqueio (conta_id, email)
  SELECT g.conta_id, g.email FROM public.agenda_convidados g WHERE g.id = p_convidado
  ON CONFLICT (conta_id, email) DO NOTHING;
$$;

-- ============ (10) agenda_listar.convidados ============
-- ---- client RPC: read ----
-- One row per visible, non-cancelled occurrence. With p_ocorrencia_id (deep
-- link) the range is ignored and only that occurrence comes back; otherwise both
-- bounds are required and span at most 100 days. inicio >= p_de - 31 days (the
-- longest event) lets the (conta_id, inicio, fim) index bound the scan on both
-- sides; the deep link reuses the same query with the occurrence's own bounds.
-- Masking ("ocupado"): a private event the viewer neither organizes nor
-- attends shows titulo 'Ocupado' and NULL content, rule and reminders, and its
-- participants without answers. pode_editar is the rule of agenda_pode_editar
-- (section 4, used by the edit/delete RPCs), inlined here. regra is jsonb_build_object over all seven keys
-- (explicit nulls, never stripped: the CRM compares them).
-- [hub] Body copied verbatim from 20261005000001_agenda_eventos.sql. The
-- RETURNS TABLE gains four columns APPENDED at the end (old bundles and the
-- agenda-feed download keep working), so it is DROP + CREATE with the same
-- grants: compartilhado_cliente (effective: flag AND cliente_id),
-- cliente_resposta ('sim'/'nao'/'aguardando', NULL when not shared; the
-- effective answer of spec §3), remarcacao_pendente (the pending request of
-- the shared cliente, or NULL) and sequencia. All four NULL when masked.
-- Every new reference is qualified (o.sequencia): #variable_conflict
-- use_column would otherwise resolve to the output column.
-- [convidados] Body copied verbatim from 20261007000001_agenda_hub.sql. One
-- more column APPENDED at the end, so it is DROP + CREATE with the same
-- grants: convidados, the active guests [{id, email, nome, resposta}] ordered
-- by id, resposta the effective answer for this occurrence (sim/nao/null);
-- [] without guests, NULL when masked.
DROP FUNCTION public.agenda_listar(timestamptz, timestamptz, bigint);
CREATE FUNCTION public.agenda_listar(p_de timestamptz DEFAULT NULL, p_ate timestamptz DEFAULT NULL, p_ocorrencia_id bigint DEFAULT NULL)
RETURNS TABLE (
  ocorrencia_id bigint, evento_id bigint, data_original date,
  inicio timestamptz, fim timestamptz, dia_inteiro boolean,
  data_inicio_local date, data_fim_local date,
  titulo text, descricao text, local text, link_reuniao text,
  tipo text, cor text, cliente_id bigint, cliente_nome text,
  privado boolean, mascarado boolean, recorrente boolean,
  regra jsonb, lembretes int[], organizador_id uuid,
  participantes jsonb,
  minha_resposta text, pode_editar boolean, pode_responder boolean, tz text,
  compartilhado_cliente boolean, cliente_resposta text, remarcacao_pendente jsonb, sequencia int,  -- [hub]
  convidados jsonb  -- [convidados]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_conta uuid;
  v_user uuid;
  v_editar boolean;
  v_role text;
  v_de timestamptz := p_de;
  v_ate timestamptz := p_ate;
BEGIN
  v_conta := get_my_conta_id(); v_user := auth.uid();
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'agenda: sessão sem workspace ativo'; END IF;
  -- flag off: no rows, no raise (stale clients and prefetches stay quiet)
  IF NOT public.effective_plan_feature(v_conta, 'feature_agenda') THEN RETURN; END IF;
  IF NOT public.has_permission('calendario', 'ver') THEN
    RAISE EXCEPTION 'agenda: você não pode ver a agenda';
  END IF;

  IF p_ocorrencia_id IS NOT NULL THEN
    SELECT o.inicio, o.fim INTO v_de, v_ate FROM public.agenda_ocorrencias o
     WHERE o.id = p_ocorrencia_id AND o.conta_id = v_conta AND NOT o.cancelada;
    IF NOT FOUND THEN RETURN; END IF;
  ELSIF v_de IS NULL OR v_ate IS NULL OR v_ate <= v_de OR v_ate - v_de > interval '100 days' THEN
    RAISE EXCEPTION 'agenda: período inválido';
  END IF;

  -- pode_editar: the rule of agenda_pode_editar (section 4), evaluated inline
  -- from the caller's permission and role computed once, instead of a
  -- non-inlinable DEFINER call per row. Keep both in sync.
  v_editar := public.has_permission('calendario', 'editar');
  SELECT wm.role::text INTO v_role FROM public.workspace_members wm
   WHERE wm.workspace_id = v_conta AND wm.user_id = v_user;

  RETURN QUERY
  SELECT
    o.id, e.id, o.data_original,
    o.inicio, o.fim, e.dia_inteiro,
    (o.inicio AT TIME ZONE e.tz)::date,
    CASE WHEN e.dia_inteiro THEN (o.fim AT TIME ZONE e.tz)::date
         ELSE ((o.fim AT TIME ZONE e.tz) - interval '1 microsecond')::date + 1 END,
    CASE WHEN m.mascarado THEN 'Ocupado'
         WHEN 'titulo' = ANY (o.campos_sobrescritos) THEN o.titulo ELSE e.titulo END,
    CASE WHEN m.mascarado THEN NULL
         WHEN 'descricao' = ANY (o.campos_sobrescritos) THEN o.descricao ELSE e.descricao END,
    CASE WHEN m.mascarado THEN NULL
         WHEN 'local' = ANY (o.campos_sobrescritos) THEN o.local ELSE e.local END,
    CASE WHEN m.mascarado THEN NULL
         WHEN 'link_reuniao' = ANY (o.campos_sobrescritos) THEN o.link_reuniao ELSE e.link_reuniao END,
    CASE WHEN m.mascarado THEN NULL ELSE e.tipo END,
    CASE WHEN m.mascarado THEN NULL ELSE e.cor END,
    CASE WHEN m.mascarado THEN NULL ELSE e.cliente_id END,
    CASE WHEN m.mascarado THEN NULL ELSE c.nome END,
    e.privado, m.mascarado, e.freq IS NOT NULL,
    CASE WHEN m.mascarado OR e.freq IS NULL THEN NULL
         ELSE jsonb_build_object('freq', e.freq, 'intervalo', e.intervalo, 'dias_semana', e.dias_semana,
                                 'mensal_modo', e.mensal_modo, 'mensal_ordinal', e.mensal_ordinal,
                                 'ate', e.ate, 'contagem', e.contagem) END,
    CASE WHEN m.mascarado THEN NULL ELSE e.lembretes END,
    e.organizador_id,
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'user_id', ap.user_id,
               'resposta', CASE WHEN m.mascarado THEN NULL ELSE coalesce(ar.resposta, ap.resposta) END)
             ORDER BY ap.user_id)
        FROM public.agenda_participantes ap
        JOIN public.workspace_members wm ON wm.user_id = ap.user_id AND wm.workspace_id = v_conta
        LEFT JOIN public.agenda_respostas ar ON ar.ocorrencia_id = o.id AND ar.user_id = ap.user_id
       WHERE ap.evento_id = e.id), '[]'::jsonb),
    CASE WHEN eu.user_id IS NULL THEN NULL ELSE coalesce(mr.resposta, eu.resposta) END,
    coalesce(v_editar AND (e.organizador_id = v_user OR (v_role IN ('owner', 'admin') AND NOT e.privado)), false),
    eu.user_id IS NOT NULL AND e.organizador_id IS DISTINCT FROM v_user,
    e.tz,
    -- [hub] the four appended columns
    CASE WHEN m.mascarado THEN NULL ELSE sh.compartilhado END,
    CASE WHEN NOT sh.compartilhado THEN NULL
         WHEN rc.resposta IS NOT NULL AND rc.inicio_respondido = o.inicio AND rc.cliente_id = e.cliente_id THEN rc.resposta
         ELSE 'aguardando' END,
    CASE WHEN NOT sh.compartilhado THEN NULL
         ELSE (SELECT jsonb_build_object('id', rm.id, 'inicio_sugerido', rm.inicio_sugerido,
                                         'fim_sugerido', rm.fim_sugerido, 'mensagem', rm.mensagem,
                                         'criado_em', rm.criado_em)
                 FROM public.agenda_remarcacoes rm
                WHERE rm.ocorrencia_id = o.id AND rm.status = 'pendente' AND rm.cliente_id = e.cliente_id) END,
    CASE WHEN m.mascarado THEN NULL ELSE o.sequencia END,
    -- [convidados] the active guests with their effective answer here
    CASE WHEN m.mascarado THEN NULL
         ELSE coalesce((
           SELECT jsonb_agg(jsonb_build_object(
                    'id', g.id, 'email', g.email, 'nome', g.nome,
                    'resposta', CASE WHEN rg.inicio_respondido = o.inicio THEN rg.resposta END)
                  ORDER BY g.id)
             FROM public.agenda_convidados g
             LEFT JOIN public.agenda_respostas_convidado rg ON rg.ocorrencia_id = o.id AND rg.convidado_id = g.id
            WHERE g.evento_id = e.id AND g.removido_em IS NULL), '[]'::jsonb) END
  FROM public.agenda_ocorrencias o
  JOIN public.agenda_eventos e ON e.id = o.evento_id AND e.conta_id = v_conta
  LEFT JOIN public.agenda_participantes eu ON eu.evento_id = e.id AND eu.user_id = v_user
  LEFT JOIN public.agenda_respostas mr ON mr.ocorrencia_id = o.id AND mr.user_id = v_user
  LEFT JOIN public.clientes c ON c.id = e.cliente_id AND c.conta_id = v_conta
  LEFT JOIN public.agenda_respostas_cliente rc ON rc.ocorrencia_id = o.id  -- [hub]
  CROSS JOIN LATERAL (
    SELECT (e.privado AND e.organizador_id IS DISTINCT FROM v_user AND eu.user_id IS NULL) AS mascarado
  ) m
  CROSS JOIN LATERAL (  -- [hub] effective sharing, never for a masked row
    SELECT (NOT m.mascarado AND e.compartilhado_cliente AND e.cliente_id IS NOT NULL) AS compartilhado
  ) sh
  WHERE o.conta_id = v_conta
    AND NOT o.cancelada
    AND o.inicio < v_ate AND o.fim > v_de AND o.inicio >= v_de - interval '31 days'
    AND (p_ocorrencia_id IS NULL OR o.id = p_ocorrencia_id)
  ORDER BY o.inicio, o.id;
END $$;
REVOKE ALL ON FUNCTION public.agenda_listar(timestamptz, timestamptz, bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agenda_listar(timestamptz, timestamptz, bigint) TO authenticated, service_role;

-- ============ (11) GRANTS + ASSERTIONS ============
REVOKE ALL ON FUNCTION public.agenda_ocorrencias_bump_sequencia(bigint[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_envios_enfileirar(uuid, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_envios_convidados(bigint[], text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_convidados_perda(bigint, bigint[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_convidados_snapshot(bigint, text, bigint, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_cliente_enfileirar(uuid, bigint, bigint, text, jsonb, jsonb, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_definir_convidados(bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_cliente_claim_emails(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_convite_item(bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_convite_resolver(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_convite_ler(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_convite_ocorrencia(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_convite_responder(text, bigint, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_convite_descadastrar(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_ocorrencias_bump_sequencia(bigint[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_envios_enfileirar(uuid, bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_envios_convidados(bigint[], text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_convidados_perda(bigint, bigint[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_convidados_snapshot(bigint, text, bigint, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_cliente_enfileirar(uuid, bigint, bigint, text, jsonb, jsonb, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_definir_convidados(bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_cliente_claim_emails(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_convite_item(bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_convite_resolver(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_convite_ler(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_convite_ocorrencia(text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_convite_responder(text, bigint, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_convite_descadastrar(bigint) TO service_role;

DO $$
DECLARE
  v_t text;
  v_fn text;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['agenda_convidados', 'agenda_respostas_convidado', 'agenda_convidados_bloqueio', 'agenda_emails_cliente'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema = 'public' AND table_name = v_t AND grantee IN ('anon', 'authenticated')) THEN
      RAISE EXCEPTION '%: anon/authenticated hold a privilege', v_t;
    END IF;
  END LOOP;
  IF to_regprocedure('public.agenda_cliente_enfileirar(uuid, bigint, bigint, text, jsonb, jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'the 6-arg agenda_cliente_enfileirar survived';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.agenda_ocorrencias_bump_sequencia(bigint[])',
    'public.agenda_envios_enfileirar(uuid, bigint, jsonb)',
    'public.agenda_envios_convidados(bigint[], text, jsonb)',
    'public.agenda_convidados_perda(bigint, bigint[])',
    'public.agenda_convidados_snapshot(bigint, text, bigint, date)',
    'public.agenda_cliente_enfileirar(uuid, bigint, bigint, text, jsonb, jsonb, bigint)',
    'public.agenda_definir_convidados(bigint, jsonb)',
    'public.agenda_cliente_claim_emails(int)',
    'public.agenda_convite_item(bigint, bigint)',
    'public.agenda_convite_resolver(text)',
    'public.agenda_convite_ler(text)',
    'public.agenda_convite_ocorrencia(text, bigint)',
    'public.agenda_convite_responder(text, bigint, text, timestamptz)',
    'public.agenda_convite_descadastrar(bigint)'] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '%: anon/authenticated can execute', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '%: service_role cannot execute', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY['public.agenda_evento_criar(jsonb, uuid[])',
                              'public.agenda_evento_editar(bigint, text, jsonb, uuid[])',
                              'public.agenda_evento_excluir(bigint, text)',
                              'public.agenda_remarcacao_resolver(bigint, boolean, text)',
                              'public.agenda_listar(timestamptz, timestamptz, bigint)'] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN RAISE EXCEPTION '%: anon can execute', v_fn; END IF;
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '%: authenticated/service_role cannot execute', v_fn;
    END IF;
  END LOOP;
END
$$;
