-- supabase/migrations/20261007000001_agenda_hub.sql
-- Agenda (sub-projeto 3): events shared with the client in the Hub. The client
-- confirms or declines each occurrence and asks to reschedule (the team
-- accepts or declines), and gets an e-mail with .ics for every invite, change
-- and cancellation, through a queue of immutable snapshots.
-- Spec: docs/superpowers/specs/2026-10-07-agenda-hub-design.md
-- Plan: docs/superpowers/plans/2026-10-07-agenda-hub.md (Task 1 + amendments)
-- Rollback: step 4b of docs/superpowers/specs/assets/2026-10-05-agenda-rollback.sql
--
-- Sections: (1) columns + tables, (2) notification types, (3) payload
-- validation, (4) internal helpers (snapshot, queue, substitution), (5) the
-- write RPCs with their hooks, (6) agenda_listar, (7) agenda_feed_eventos,
-- (8) Hub RPCs, reschedule resolution, queue claim/mark, digest RPCs, tick +
-- cron, (9) grant assertions.
--
-- "Shared" is always read as compartilhado_cliente AND cliente_id IS NOT NULL:
-- deleting a cliente runs the existing ON DELETE SET NULL (cliente_id) of
-- agenda_eventos and leaves compartilhado_cliente true; the rows of the three
-- new tables for that cliente go with the composite FK cascades.

-- ============ (1) COLUMNS + TABLES ============

-- Series field, like cliente_id: changes only with scope todas/seguintes.
-- The CHECK never mentions cliente_id (see the header): "cliente required" is
-- agenda_validar_payload's job (it stores false without a cliente).
ALTER TABLE public.agenda_eventos
  ADD COLUMN compartilhado_cliente boolean NOT NULL DEFAULT false;
ALTER TABLE public.agenda_eventos
  ADD CONSTRAINT agenda_eventos_compartilhado_ck CHECK (NOT (compartilhado_cliente AND privado));

-- SEQUENCE of the occurrence's VEVENT. Bumped by agenda_cliente_enfileirar on
-- every change the client is told about; read by the e-mail, the Hub download
-- and the personal feed (a download with a lower SEQUENCE than an e-mailed one
-- would be ignored by the calendar app).
ALTER TABLE public.agenda_ocorrencias
  ADD COLUMN sequencia int NOT NULL DEFAULT 0;

-- The client's answer per occurrence (the Hub client is not a user, so it
-- cannot live in agenda_respostas). resposta NULL = the row only exists for
-- the digest reminder (lembrado_inicio). Effective answer = resposta when
-- inicio_respondido = the occurrence's inicio (timestamptz comparison) and
-- cliente_id = the series' cliente while it is shared; otherwise "aguardando".
CREATE TABLE public.agenda_respostas_cliente (
  ocorrencia_id bigint NOT NULL PRIMARY KEY,
  conta_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  cliente_id bigint NOT NULL,
  resposta text NULL CHECK (resposta IS NULL OR resposta IN ('sim', 'nao')),
  respondido_em timestamptz NULL,
  inicio_respondido timestamptz NULL,
  lembrado_inicio timestamptz NULL,
  CONSTRAINT agenda_respostas_cliente_resposta_ck CHECK (
    resposta IS NULL OR (respondido_em IS NOT NULL AND inicio_respondido IS NOT NULL)),
  CONSTRAINT agenda_respostas_cliente_ocorrencia_fk FOREIGN KEY (ocorrencia_id, conta_id)
    REFERENCES public.agenda_ocorrencias(id, conta_id) ON DELETE CASCADE,
  CONSTRAINT agenda_respostas_cliente_cliente_fk FOREIGN KEY (cliente_id, conta_id)
    REFERENCES public.clientes(id, conta_id) ON DELETE CASCADE
);
CREATE INDEX agenda_respostas_cliente_cliente_idx ON public.agenda_respostas_cliente (cliente_id, conta_id);

-- Reschedule requests. At most one pendente per occurrence (partial unique
-- index). Every transition is UPDATE ... WHERE id = $1 AND status = 'pendente'.
-- substituida = the team moved, cancelled, deleted or un-shared the occurrence
-- by another path; it is set BEFORE any DELETE of occurrences (the regenerate,
-- the split and the deletes would otherwise cascade the request away).
CREATE TABLE public.agenda_remarcacoes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conta_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  cliente_id bigint NOT NULL,
  ocorrencia_id bigint NOT NULL,
  inicio_sugerido timestamptz NOT NULL,
  fim_sugerido timestamptz NOT NULL,
  mensagem text NULL CHECK (mensagem IS NULL OR char_length(mensagem) <= 1000),
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'aceita', 'recusada', 'cancelada', 'substituida')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  resolvido_em timestamptz NULL,
  resolvido_por uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  resposta_equipe text NULL CHECK (resposta_equipe IS NULL OR char_length(resposta_equipe) <= 1000),
  CONSTRAINT agenda_remarcacoes_fim_ck CHECK (fim_sugerido > inicio_sugerido),
  CONSTRAINT agenda_remarcacoes_ocorrencia_fk FOREIGN KEY (ocorrencia_id, conta_id)
    REFERENCES public.agenda_ocorrencias(id, conta_id) ON DELETE CASCADE,
  CONSTRAINT agenda_remarcacoes_cliente_fk FOREIGN KEY (cliente_id, conta_id)
    REFERENCES public.clientes(id, conta_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX agenda_remarcacoes_pendente_uq ON public.agenda_remarcacoes (ocorrencia_id) WHERE status = 'pendente';
CREATE INDEX agenda_remarcacoes_ocorrencia_idx ON public.agenda_remarcacoes (ocorrencia_id);
CREATE INDEX agenda_remarcacoes_cliente_idx ON public.agenda_remarcacoes (cliente_id, conta_id);

-- E-mail queue to the client. Each item carries an immutable snapshot of up
-- to 50 occurrences (spec §5): the sender reads only the snapshot, never rows
-- the regenerate, the split or a delete may have removed, so there is no FK to
-- agenda_eventos / agenda_ocorrencias. A pendente item without lease whose
-- enviar_apos is still ahead is mergeable (agenda_cliente_enfileirar); an item
-- under lease never changes, so the idempotency key
-- agenda-cliente:<id>:<versao> always maps to one content.
CREATE TABLE public.agenda_emails_cliente (
  id bigserial PRIMARY KEY,
  conta_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  cliente_id bigint NOT NULL,
  evento_id bigint NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('convite', 'alteracao', 'cancelamento', 'remarcacao_aceita', 'remarcacao_recusada')),
  ocorrencias jsonb NOT NULL DEFAULT '[]',
  remarcacao jsonb NULL,
  versao int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'enviando', 'enviado', 'falhou', 'descartado')),
  enviar_apos timestamptz NOT NULL DEFAULT (now() + interval '60 seconds'),
  tentativas int NOT NULL DEFAULT 0,
  lease_ate timestamptz NULL,
  enviado_em timestamptz NULL,
  ultimo_erro text NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agenda_emails_cliente_cliente_fk FOREIGN KEY (cliente_id, conta_id)
    REFERENCES public.clientes(id, conta_id) ON DELETE CASCADE
);
CREATE INDEX agenda_emails_cliente_status_idx ON public.agenda_emails_cliente (status, enviar_apos);
CREATE INDEX agenda_emails_cliente_mescla_idx ON public.agenda_emails_cliente (cliente_id, evento_id) WHERE status = 'pendente';
CREATE INDEX agenda_emails_cliente_cliente_idx ON public.agenda_emails_cliente (cliente_id, conta_id);

-- service_role and the DEFINER RPCs only (pattern of agenda_lembretes)
ALTER TABLE public.agenda_respostas_cliente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_remarcacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_emails_cliente ENABLE ROW LEVEL SECURITY;
CREATE POLICY agenda_respostas_cliente_service_role_bypass ON public.agenda_respostas_cliente
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY agenda_remarcacoes_service_role_bypass ON public.agenda_remarcacoes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY agenda_emails_cliente_service_role_bypass ON public.agenda_emails_cliente
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.agenda_respostas_cliente, public.agenda_remarcacoes, public.agenda_emails_cliente
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.agenda_respostas_cliente, public.agenda_remarcacoes, public.agenda_emails_cliente
  TO service_role;
REVOKE ALL ON SEQUENCE public.agenda_remarcacoes_id_seq, public.agenda_emails_cliente_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.agenda_remarcacoes_id_seq, public.agenda_emails_cliente_id_seq TO service_role;

-- ============ (2) NOTIFICATION TYPES ============
-- Lists copied from 20261005000001_agenda_eventos.sql (the most recent
-- definitions), only APPENDING event_client_rsvp and
-- event_reschedule_requested. This file is now the most recent definition:
-- the next migration copies FROM HERE. Both new types are e-mail eligible
-- (team digest).
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
    'event_client_rsvp', 'event_reschedule_requested'
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
  'event_client_rsvp','event_reschedule_requested',
  '__all__'
));

ALTER TABLE public.notification_email_prefs DROP CONSTRAINT notification_email_prefs_type_check;
ALTER TABLE public.notification_email_prefs ADD CONSTRAINT notification_email_prefs_type_check CHECK (type IN (
  'post_approved','post_publish_failed','post_correction','post_message',
  'client_message','deadline_approaching','task_assigned','post_assigned',
  'mention',
  'event_invited','event_updated','event_cancelled','event_reminder',
  'event_client_rsvp','event_reschedule_requested',
  '__all__'
));

-- Body copied verbatim from 20261005000001_agenda_eventos.sql; the only change
-- is the two client types appended to the array (both go to the team digest).
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
       'event_client_rsvp','event_reschedule_requested'
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

-- ============ (3) PAYLOAD VALIDATION ============
-- Body copied verbatim from 20261005000001_agenda_eventos.sql; additions marked "-- [hub]".
-- ---- internal: payload -> unsaved agenda_eventos row ----
-- Merge rule: a key absent from p_evento keeps p_base's value (with p_base NULL
-- a missing required key raises); a key present with JSON null sets NULL; tz is
-- read only on create (p_base NULL) and ignored on edit. inicio_local/fim_local
-- are local wall clocks in the series tz and must come together; they become
-- dtstart (the wall clock as sent: the edit RPC derives the series dtstart from
-- it) and duracao_min (elapsed minutes, as occurrences are generated) or
-- duracao_dias (exclusive end date - start date). The rule is always explicit:
-- keys that do not apply to its freq are cleared. Every raise is user-facing
-- pt-BR copy prefixed "agenda: ".
CREATE OR REPLACE FUNCTION public.agenda_validar_payload(p_conta uuid, p_evento jsonb, p_base public.agenda_eventos DEFAULT NULL)
RETURNS public.agenda_eventos LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v public.agenda_eventos;
  p jsonb := p_evento;
  r jsonb;
  v_ini timestamp;
  v_fim timestamp;
  v_txt text;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'agenda: dados do evento incompletos';
  END IF;

  IF p_base IS NULL THEN
    IF NOT (p ? 'titulo' AND p ? 'inicio_local' AND p ? 'fim_local') THEN
      RAISE EXCEPTION 'agenda: dados do evento incompletos';
    END IF;
    v.tipo := 'reuniao';
    v.privado := false;
    v.compartilhado_cliente := false;  -- [hub]
    v.dia_inteiro := false;
    v.tz := 'America/Sao_Paulo';
    v.intervalo := 1;
    v.lembretes := '{}';
    v.materializacao_completa := false;
  ELSE
    v := p_base;
  END IF;
  v.conta_id := p_conta;

  -- ---- content ----
  IF p ? 'titulo' THEN
    IF jsonb_typeof(p->'titulo') NOT IN ('string', 'null') THEN RAISE EXCEPTION 'agenda: dados do evento inválidos'; END IF;
    v.titulo := btrim(p->>'titulo');
    IF v.titulo IS NULL OR v.titulo = '' THEN RAISE EXCEPTION 'agenda: informe um título'; END IF;
    IF char_length(v.titulo) > 200 THEN RAISE EXCEPTION 'agenda: o título pode ter no máximo 200 caracteres'; END IF;
  END IF;
  IF p ? 'descricao' THEN
    IF jsonb_typeof(p->'descricao') NOT IN ('string', 'null') THEN RAISE EXCEPTION 'agenda: dados do evento inválidos'; END IF;
    v.descricao := NULLIF(btrim(p->>'descricao'), '');
    IF char_length(v.descricao) > 5000 THEN RAISE EXCEPTION 'agenda: a descrição pode ter no máximo 5000 caracteres'; END IF;
  END IF;
  IF p ? 'local' THEN
    IF jsonb_typeof(p->'local') NOT IN ('string', 'null') THEN RAISE EXCEPTION 'agenda: dados do evento inválidos'; END IF;
    v.local := NULLIF(btrim(p->>'local'), '');
    IF char_length(v.local) > 300 THEN RAISE EXCEPTION 'agenda: o local pode ter no máximo 300 caracteres'; END IF;
  END IF;
  IF p ? 'link_reuniao' THEN
    IF jsonb_typeof(p->'link_reuniao') NOT IN ('string', 'null') THEN RAISE EXCEPTION 'agenda: link da reunião inválido'; END IF;
    v.link_reuniao := NULLIF(btrim(p->>'link_reuniao'), '');
    IF v.link_reuniao IS NOT NULL AND (v.link_reuniao !~* '^https?://' OR char_length(v.link_reuniao) > 500) THEN
      RAISE EXCEPTION 'agenda: link da reunião inválido';
    END IF;
  END IF;

  -- ---- classification ----
  IF p ? 'tipo' THEN
    v.tipo := p->>'tipo';
    IF jsonb_typeof(p->'tipo') <> 'string'
       OR v.tipo NOT IN ('reuniao','gravacao','captacao','apresentacao','interno','outro') THEN
      RAISE EXCEPTION 'agenda: dados do evento inválidos';
    END IF;
  END IF;
  IF p ? 'cor' THEN
    v.cor := p->>'cor';
    IF jsonb_typeof(p->'cor') NOT IN ('string', 'null')
       OR (v.cor IS NOT NULL AND v.cor NOT IN ('azul','rosa','laranja','roxo','verde','teal','cinza','amarelo')) THEN
      RAISE EXCEPTION 'agenda: dados do evento inválidos';
    END IF;
  END IF;
  IF p ? 'cliente_id' THEN
    IF jsonb_typeof(p->'cliente_id') = 'null' THEN
      v.cliente_id := NULL;
    ELSIF jsonb_typeof(p->'cliente_id') <> 'number' OR (p->>'cliente_id') !~ '^[0-9]{1,18}$' THEN
      RAISE EXCEPTION 'agenda: cliente não encontrado';
    ELSE
      v.cliente_id := (p->>'cliente_id')::bigint;
      IF NOT EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = v.cliente_id AND c.conta_id = p_conta) THEN
        RAISE EXCEPTION 'agenda: cliente não encontrado';
      END IF;
    END IF;
  END IF;
  IF p ? 'privado' THEN
    IF jsonb_typeof(p->'privado') <> 'boolean' THEN RAISE EXCEPTION 'agenda: dados do evento inválidos'; END IF;
    v.privado := (p->>'privado')::boolean;
  END IF;
  -- [hub] "Compartilhar com o cliente": a series field (the edit RPC keeps it
  -- out of esta). Stored false without a cliente; never together with privado
  -- (the table CHECK backs the second rule).
  IF p ? 'compartilhado_cliente' THEN
    IF jsonb_typeof(p->'compartilhado_cliente') <> 'boolean' THEN RAISE EXCEPTION 'agenda: dados do evento inválidos'; END IF;
    v.compartilhado_cliente := (p->>'compartilhado_cliente')::boolean;
  END IF;
  IF v.cliente_id IS NULL THEN
    v.compartilhado_cliente := false;
  END IF;
  IF v.compartilhado_cliente AND v.privado THEN
    RAISE EXCEPTION 'agenda: evento privado não pode ser compartilhado com o cliente.';
  END IF;
  IF p ? 'dia_inteiro' THEN
    IF jsonb_typeof(p->'dia_inteiro') <> 'boolean' THEN RAISE EXCEPTION 'agenda: dados do evento inválidos'; END IF;
    v.dia_inteiro := (p->>'dia_inteiro')::boolean;
  END IF;

  -- ---- tz (create only) ----
  IF p_base IS NULL AND p ? 'tz' THEN
    IF jsonb_typeof(p->'tz') <> 'string' THEN RAISE EXCEPTION 'agenda: fuso horário inválido'; END IF;
    v.tz := p->>'tz';
    BEGIN
      PERFORM '2000-01-01'::timestamp AT TIME ZONE v.tz;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'agenda: fuso horário inválido';
    END;
  END IF;

  -- ---- start / duration ----
  IF (p ? 'inicio_local') <> (p ? 'fim_local') THEN
    RAISE EXCEPTION 'agenda: dados do evento incompletos';
  END IF;
  IF p ? 'inicio_local' THEN
    IF jsonb_typeof(p->'inicio_local') <> 'string' OR jsonb_typeof(p->'fim_local') <> 'string' THEN
      RAISE EXCEPTION 'agenda: dados do evento inválidos';
    END IF;
    BEGIN
      v_ini := (p->>'inicio_local')::timestamp;
      v_fim := (p->>'fim_local')::timestamp;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'agenda: dados do evento inválidos';
    END;
    IF v_ini IS NULL OR v_fim IS NULL OR NOT isfinite(v_ini) OR NOT isfinite(v_fim) THEN
      RAISE EXCEPTION 'agenda: dados do evento inválidos';
    END IF;
    IF v.dia_inteiro THEN
      v.dtstart := v_ini::date::timestamp;
      v.duracao_min := NULL;
      v.duracao_dias := v_fim::date - v_ini::date;
      IF v.duracao_dias <= 0 THEN RAISE EXCEPTION 'agenda: o fim precisa ser depois do início'; END IF;
      IF v.duracao_dias > 31 THEN RAISE EXCEPTION 'agenda: o evento é longo demais'; END IF;
    ELSE
      v_ini := date_trunc('minute', v_ini);
      v_fim := date_trunc('minute', v_fim);
      IF v_fim <= v_ini THEN RAISE EXCEPTION 'agenda: o fim precisa ser depois do início'; END IF;
      v.dtstart := v_ini;
      v.duracao_dias := NULL;
      -- elapsed minutes between the two wall clocks in the series tz (a DST
      -- jump inside the event counts), never below one minute
      v.duracao_min := greatest(1, (extract(epoch FROM ((v_fim AT TIME ZONE v.tz) - (v_ini AT TIME ZONE v.tz))) / 60)::int);
      IF v.duracao_min > 20160 THEN RAISE EXCEPTION 'agenda: o evento é longo demais'; END IF;
    END IF;
  ELSIF p_base IS NOT NULL AND v.dia_inteiro IS DISTINCT FROM p_base.dia_inteiro THEN
    -- switching all-day on or off needs the new start and end
    RAISE EXCEPTION 'agenda: dados do evento incompletos';
  END IF;

  -- ---- reminders ----
  IF p ? 'lembretes' THEN
    IF jsonb_typeof(p->'lembretes') = 'null' THEN
      v.lembretes := '{}';
    ELSIF jsonb_typeof(p->'lembretes') <> 'array'
       OR jsonb_array_length(p->'lembretes') > 5
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p->'lembretes') x(j)
                   WHERE jsonb_typeof(x.j) <> 'number' OR (x.j #>> '{}') !~ '^-?[0-9]{1,5}$'
                      OR (x.j #>> '{}')::int NOT BETWEEN -1440 AND 40320)
       OR (SELECT count(DISTINCT x.j) <> count(*) FROM jsonb_array_elements(p->'lembretes') x(j)) THEN
      RAISE EXCEPTION 'agenda: lembrete inválido';
    ELSE
      v.lembretes := ARRAY(SELECT (x.j #>> '{}')::int FROM jsonb_array_elements(p->'lembretes') WITH ORDINALITY x(j, n) ORDER BY x.n);
    END IF;
  END IF;

  -- ---- rule ----
  IF p ? 'regra' THEN
    r := p->'regra';
    IF jsonb_typeof(r) = 'null' THEN
      v.freq := NULL; v.intervalo := 1; v.dias_semana := NULL; v.mensal_modo := NULL;
      v.mensal_ordinal := NULL; v.ate := NULL; v.contagem := NULL;
    ELSIF jsonb_typeof(r) <> 'object' THEN
      RAISE EXCEPTION 'agenda: repetição inválida';
    ELSE
      v.freq := r->>'freq';
      IF jsonb_typeof(r->'freq') IS DISTINCT FROM 'string' OR v.freq NOT IN ('daily','weekly','monthly','yearly') THEN
        RAISE EXCEPTION 'agenda: repetição inválida';
      END IF;
      IF r ? 'intervalo' AND jsonb_typeof(r->'intervalo') <> 'null' THEN
        IF jsonb_typeof(r->'intervalo') <> 'number' OR (r->>'intervalo') !~ '^[0-9]{1,2}$' OR (r->>'intervalo')::int < 1 THEN
          RAISE EXCEPTION 'agenda: repetição inválida';
        END IF;
        v.intervalo := (r->>'intervalo')::int;
      ELSE
        v.intervalo := 1;
      END IF;

      v.dias_semana := NULL;
      IF v.freq = 'weekly' THEN
        IF jsonb_typeof(r->'dias_semana') IS DISTINCT FROM 'array'
           OR jsonb_array_length(r->'dias_semana') NOT BETWEEN 1 AND 7
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(r->'dias_semana') x(j)
                       WHERE jsonb_typeof(x.j) <> 'number' OR (x.j #>> '{}') !~ '^[0-6]$')
           OR (SELECT count(DISTINCT x.j) <> count(*) FROM jsonb_array_elements(r->'dias_semana') x(j)) THEN
          RAISE EXCEPTION 'agenda: dias da semana inválidos';
        END IF;
        v.dias_semana := ARRAY(SELECT (x.j #>> '{}')::int FROM jsonb_array_elements(r->'dias_semana') x(j) ORDER BY 1);
      END IF;

      v.mensal_modo := NULL; v.mensal_ordinal := NULL;
      IF v.freq = 'monthly' THEN
        v.mensal_modo := r->>'mensal_modo';
        IF v.mensal_modo IS NULL OR v.mensal_modo NOT IN ('dia_mes','dia_semana') THEN
          RAISE EXCEPTION 'agenda: repetição inválida';
        END IF;
        IF v.mensal_modo = 'dia_semana' THEN
          IF jsonb_typeof(r->'mensal_ordinal') IS DISTINCT FROM 'number' OR (r->>'mensal_ordinal') NOT IN ('1','2','3','4','-1') THEN
            RAISE EXCEPTION 'agenda: repetição inválida';
          END IF;
          v.mensal_ordinal := (r->>'mensal_ordinal')::int;
        END IF;
      END IF;

      v.ate := NULL; v.contagem := NULL;
      IF jsonb_typeof(r->'ate') = 'string' THEN
        BEGIN
          v.ate := (r->>'ate')::date;
        EXCEPTION WHEN others THEN
          RAISE EXCEPTION 'agenda: repetição inválida';
        END;
      ELSIF r ? 'ate' AND jsonb_typeof(r->'ate') <> 'null' THEN
        RAISE EXCEPTION 'agenda: repetição inválida';
      END IF;
      IF jsonb_typeof(r->'contagem') = 'number' THEN
        IF (r->>'contagem') !~ '^[0-9]{1,3}$' OR (r->>'contagem')::int NOT BETWEEN 1 AND 730 THEN
          RAISE EXCEPTION 'agenda: repetição inválida';
        END IF;
        v.contagem := (r->>'contagem')::int;
      ELSIF r ? 'contagem' AND jsonb_typeof(r->'contagem') <> 'null' THEN
        RAISE EXCEPTION 'agenda: repetição inválida';
      END IF;
      IF v.ate IS NOT NULL AND v.contagem IS NOT NULL THEN
        RAISE EXCEPTION 'agenda: repetição inválida';
      END IF;
    END IF;
  END IF;

  IF v.titulo IS NULL OR v.dtstart IS NULL THEN
    RAISE EXCEPTION 'agenda: dados do evento incompletos';
  END IF;
  -- on edit (p_base not NULL) dtstart here is the edited occurrence's own start,
  -- which may sit past ate (an esta move of the last occurrence); the edit RPC
  -- checks the derived series dtstart (normalization raises when the rule
  -- generates nothing; the 5-year ceiling is re-checked there too)
  IF p_base IS NULL AND v.freq IS NOT NULL AND v.ate IS NOT NULL THEN
    IF v.ate < v.dtstart::date THEN
      RAISE EXCEPTION 'agenda: a repetição não gera nenhuma data';
    END IF;
    IF v.ate > (v.dtstart::date + interval '5 years')::date THEN
      RAISE EXCEPTION 'agenda: repetição inválida';
    END IF;
  END IF;

  IF v.dtstart::date < least(coalesce(p_base.dtstart::date, 'infinity'::date), public.agenda_hoje(v.tz) - 366) THEN
    RAISE EXCEPTION 'agenda: a data de início é antiga demais';
  END IF;

  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.agenda_validar_payload(uuid, jsonb, public.agenda_eventos) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_validar_payload(uuid, jsonb, public.agenda_eventos) TO service_role;

-- ============ (4) INTERNAL HELPERS ============

-- Snapshot entries (spec §5) of a series' future occurrences, as the client
-- sees them: fim > now(), inicio < now() + 90 days, not cancelled, ORDER BY
-- inicio LIMIT 50, optionally only data_original >= p_desde (a seguintes
-- split). With p_ocorrencia: only that occurrence (no 90-day window; still
-- live and not ended), p_evento then optional (an occurrence can change series
-- in a split). Effective content applies campos_sobrescritos and the local
-- dates use the expressions of agenda_listar / agenda_feed_eventos (exclusive
-- end date); keep them in sync. estado is p_estado ('ativa' or 'cancelada').
CREATE OR REPLACE FUNCTION public.agenda_cliente_ocorrencias_snapshot(
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
                     AND o.inicio < now() + interval '90 days'
                     AND (p_desde IS NULL OR o.data_original >= p_desde) END
     ORDER BY o.inicio, o.id
     LIMIT 50
  ) x;
$$;

-- Entries of p_depois that are new or changed versus p_antes (same
-- ocorrencia_id), on the six fields the client sees: inicio, fim, titulo,
-- descricao, local, link_reuniao. An id of p_antes missing from p_depois is
-- re-read on its own (it may have left the 90-day window or the 50 cap, or
-- moved series): gone or cancelled -> its p_antes entry as 'cancelada';
-- still live and different -> its current entry; unchanged -> nothing.
CREATE OR REPLACE FUNCTION public.agenda_cliente_diff(p_antes jsonb, p_depois jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_out jsonb := '[]'::jsonb;
  a jsonb;
  d jsonb;
  v_atual jsonb;
BEGIN
  FOR d IN SELECT x FROM jsonb_array_elements(coalesce(p_depois, '[]'::jsonb)) x LOOP
    SELECT y INTO a FROM jsonb_array_elements(coalesce(p_antes, '[]'::jsonb)) y
     WHERE y->>'ocorrencia_id' = d->>'ocorrencia_id';
    IF a IS NULL OR NOT public.agenda_cliente_entrada_igual(a, d) THEN
      v_out := v_out || jsonb_build_array(d);
    END IF;
    a := NULL;
  END LOOP;
  FOR a IN SELECT y FROM jsonb_array_elements(coalesce(p_antes, '[]'::jsonb)) y
            WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_depois, '[]'::jsonb)) x
                               WHERE x->>'ocorrencia_id' = y->>'ocorrencia_id') LOOP
    v_atual := public.agenda_cliente_ocorrencias_snapshot(NULL, 'ativa', (a->>'ocorrencia_id')::bigint) -> 0;
    IF v_atual IS NULL THEN
      v_out := v_out || jsonb_build_array(a || '{"estado":"cancelada"}'::jsonb);
    ELSIF NOT public.agenda_cliente_entrada_igual(a, v_atual) THEN
      v_out := v_out || jsonb_build_array(v_atual);
    END IF;
  END LOOP;
  RETURN v_out;
END $$;

-- Two snapshot entries show the client the same thing (the relevant-change
-- predicate of the spec; inicio/fim compared as timestamptz).
CREATE OR REPLACE FUNCTION public.agenda_cliente_entrada_igual(a jsonb, b jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT (a->>'inicio')::timestamptz IS NOT DISTINCT FROM (b->>'inicio')::timestamptz
     AND (a->>'fim')::timestamptz IS NOT DISTINCT FROM (b->>'fim')::timestamptz
     AND (a->'titulo') IS NOT DISTINCT FROM (b->'titulo')
     AND (a->'descricao') IS NOT DISTINCT FROM (b->'descricao')
     AND (a->'local') IS NOT DISTINCT FROM (b->'local')
     AND (a->'link_reuniao') IS NOT DISTINCT FROM (b->'link_reuniao');
$$;

-- Internal: puts p_ocorrencias (snapshot entries) in the client's e-mail queue.
--  * Every entry's occurrence gets sequencia + 1 (rows that still exist; a
--    deleted one carries its snapshot value + 1) and the entry is rewritten
--    with it.
--  * Transaction GUC agenda.remarcacao (set by agenda_remarcacao_resolver while
--    it calls agenda_evento_editar): an 'alteracao' becomes 'remarcacao_aceita'
--    with the remarcacao payload built from that request row.
--  * One live entry per occurrence per cliente (amendment 7): the same
--    ocorrencia_ids leave every OTHER mergeable item of this cliente (pendente,
--    no lease, enviar_apos ahead, not remarcacao_*); an item left empty is
--    descartado. An id taken from a pending 'convite' was never announced, so
--    a 'cancelada' entry for it is dropped instead of queued.
--  * Non-remarcacao: merged into the mergeable item of (cliente, evento) when
--    there is one (latest state per ocorrencia_id wins; a 'cancelada' entry
--    for an item still of tipo 'convite' is dropped together with its earlier
--    entry: the client never heard of it), versao + 1, enviar_apos unchanged;
--    an item left empty is descartado. Merged tipo: convite stays convite; a
--    cancelamento that receives live entries becomes alteracao; otherwise the
--    item's tipo stays (the e-mail type is derived from the snapshot at send).
--  * Otherwise a new item, enviar_apos = now() + 60 s (none when empty).
--    remarcacao_* items never merge and are never merged into.
CREATE OR REPLACE FUNCTION public.agenda_cliente_enfileirar(
  p_conta uuid, p_cliente bigint, p_evento bigint, p_tipo text, p_ocorrencias jsonb, p_remarcacao jsonb DEFAULT NULL)
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
BEGIN
  IF p_tipo IS NULL OR p_tipo NOT IN ('convite', 'alteracao', 'cancelamento', 'remarcacao_aceita', 'remarcacao_recusada') THEN
    RAISE EXCEPTION 'agenda_cliente_enfileirar: tipo inválido %', p_tipo;
  END IF;
  IF p_conta IS NULL OR p_cliente IS NULL OR p_evento IS NULL OR p_ocorrencias IS NULL
     OR jsonb_typeof(p_ocorrencias) <> 'array' OR jsonb_array_length(p_ocorrencias) = 0 THEN
    RETURN;
  END IF;

  v_guc := NULLIF(current_setting('agenda.remarcacao', true), '');
  IF v_guc IS NOT NULL AND v_tipo = 'alteracao' THEN
    v_tipo := 'remarcacao_aceita';
    SELECT jsonb_build_object('remarcacao_id', rm.id, 'inicio_sugerido', rm.inicio_sugerido,
                              'fim_sugerido', rm.fim_sugerido, 'mensagem', rm.mensagem,
                              'resposta_equipe', rm.resposta_equipe)
      INTO v_rem FROM public.agenda_remarcacoes rm WHERE rm.id = v_guc::bigint;
  END IF;

  -- bump sequencia and rewrite the entries with it
  v_ids := ARRAY(SELECT DISTINCT (x->>'ocorrencia_id')::bigint FROM jsonb_array_elements(p_ocorrencias) x);
  WITH b AS (
    UPDATE public.agenda_ocorrencias o SET sequencia = o.sequencia + 1
     WHERE o.id = ANY (v_ids)
    RETURNING o.id, o.sequencia
  )
  SELECT coalesce(jsonb_agg(x || jsonb_build_object('sequencia', coalesce(b.sequencia, coalesce((x->>'sequencia')::int, 0) + 1))), '[]'::jsonb)
    INTO v_novas
    FROM jsonb_array_elements(p_ocorrencias) x
    LEFT JOIN b ON b.id = (x->>'ocorrencia_id')::bigint;

  -- one live entry per occurrence per cliente
  FOR r IN
    SELECT q.* FROM public.agenda_emails_cliente q
     WHERE q.cliente_id = p_cliente AND q.status = 'pendente' AND q.lease_ate IS NULL AND q.enviar_apos > now()
       AND q.tipo NOT IN ('remarcacao_aceita', 'remarcacao_recusada')
       AND (v_tipo IN ('remarcacao_aceita', 'remarcacao_recusada') OR q.evento_id <> p_evento)
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
     WHERE q.cliente_id = p_cliente AND q.evento_id = p_evento
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

  INSERT INTO public.agenda_emails_cliente (conta_id, cliente_id, evento_id, tipo, ocorrencias, remarcacao, enviar_apos)
  VALUES (p_conta, p_cliente, p_evento, v_tipo, v_lista,
          CASE WHEN v_tipo IN ('remarcacao_aceita', 'remarcacao_recusada') THEN v_rem END,
          now() + interval '60 seconds');
END $$;

-- Internal: pending reschedule requests of a series become 'substituida'
-- (optionally only one occurrence, or data_original >= p_desde). Called by the
-- write RPCs BEFORE they move or delete occurrences.
CREATE OR REPLACE FUNCTION public.agenda_cliente_substituir_pedidos(
  p_evento bigint, p_ocorrencia bigint DEFAULT NULL, p_desde date DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.agenda_remarcacoes rm
     SET status = 'substituida', resolvido_em = now(), resolvido_por = auth.uid()
    FROM public.agenda_ocorrencias o
   WHERE rm.ocorrencia_id = o.id
     AND rm.status = 'pendente'
     AND o.evento_id = p_evento
     AND (p_ocorrencia IS NULL OR o.id = p_ocorrencia)
     AND (p_desde IS NULL OR o.data_original >= p_desde);
$$;

-- Internal: who hears about a client action (spec §8): the organizer while
-- still a member, else the workspace's owners and admins. agenda_notificar
-- filters to current members again.
CREATE OR REPLACE FUNCTION public.agenda_cliente_destinatarios(p_conta uuid, p_organizador uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.workspace_members wm
                  WHERE wm.workspace_id = p_conta AND wm.user_id = p_organizador)
      THEN ARRAY[p_organizador]
    ELSE ARRAY(SELECT wm.user_id FROM public.workspace_members wm
                WHERE wm.workspace_id = p_conta AND wm.role::text IN ('owner', 'admin')
                ORDER BY wm.user_id)
  END;
$$;

REVOKE ALL ON FUNCTION public.agenda_cliente_ocorrencias_snapshot(bigint, text, bigint, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_cliente_ocorrencias_snapshot(bigint, text, bigint, date) TO service_role;
REVOKE ALL ON FUNCTION public.agenda_cliente_diff(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_cliente_diff(jsonb, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.agenda_cliente_entrada_igual(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_cliente_entrada_igual(jsonb, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.agenda_cliente_enfileirar(uuid, bigint, bigint, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_cliente_enfileirar(uuid, bigint, bigint, text, jsonb, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.agenda_cliente_substituir_pedidos(bigint, bigint, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_cliente_substituir_pedidos(bigint, bigint, date) TO service_role;
REVOKE ALL ON FUNCTION public.agenda_cliente_destinatarios(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_cliente_destinatarios(uuid, uuid) TO service_role;

-- ============ (5) WRITE RPCs WITH THE HUB HOOKS ============
-- Each body is copied verbatim from 20261005000001_agenda_eventos.sql; every
-- addition is marked "-- [hub]". The grants survive CREATE OR REPLACE and are
-- re-stated anyway.

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

  -- [hub] shared with the client: 'convite' with the next occurrences
  IF v_e.compartilhado_cliente AND v_e.cliente_id IS NOT NULL THEN
    PERFORM public.agenda_cliente_enfileirar(v_conta, v_e.cliente_id, v_id, 'convite',
      public.agenda_cliente_ocorrencias_snapshot(v_id, 'ativa'));
  END IF;

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

      -- 3. old rows from the cut: those on the new rule move over (exceptions,
      --    tombstones and per-occurrence RSVPs preserved), the rest go
      v_h := (v_hoje + interval '24 months')::date;
      v_h := greatest(coalesce(v_e.horizonte_ate, v_h), v_h);
      v_datas := coalesce(ARRAY(SELECT d FROM public.agenda_datas_regra(v_novo, v_novo.dtstart::date, v_h) d), '{}');
      UPDATE public.agenda_ocorrencias o
         SET evento_id = v_alvo
       WHERE o.evento_id = v_e.id AND o.data_original >= v_c AND o.data_original = ANY (v_datas);
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
  SELECT CASE WHEN ev.compartilhado_cliente THEN ev.cliente_id END INTO v_cli_depois
    FROM public.agenda_eventos ev WHERE ev.id = v_alvo;
  IF v_cli_antes IS NOT NULL AND v_cli_depois IS NOT DISTINCT FROM v_cli_antes THEN
    PERFORM public.agenda_cliente_enfileirar(v_conta, v_cli_antes, v_alvo, 'alteracao',
      public.agenda_cliente_diff(v_antes,
        public.agenda_cliente_ocorrencias_snapshot(v_alvo, 'ativa', CASE WHEN v_escopo = 'esta' THEN v_o.id END)));
  ELSE
    IF v_cli_antes IS NOT NULL THEN
      PERFORM public.agenda_cliente_enfileirar(v_conta, v_cli_antes, v_alvo, 'cancelamento',
        (SELECT coalesce(jsonb_agg(x || '{"estado":"cancelada"}'::jsonb), '[]'::jsonb) FROM jsonb_array_elements(v_antes) x));
    END IF;
    IF v_cli_depois IS NOT NULL THEN
      PERFORM public.agenda_cliente_enfileirar(v_conta, v_cli_depois, v_alvo, 'convite',
        public.agenda_cliente_ocorrencias_snapshot(v_alvo, 'ativa'));
    END IF;
  END IF;

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
  IF v_e.compartilhado_cliente AND v_e.cliente_id IS NOT NULL THEN
    PERFORM public.agenda_cliente_enfileirar(v_conta, v_e.cliente_id, v_e.id, 'cancelamento',
      public.agenda_cliente_ocorrencias_snapshot(v_e.id, 'cancelada',
        CASE WHEN v_escopo = 'esta' THEN v_o.id END,
        CASE WHEN v_escopo = 'seguintes' THEN v_o.data_original END));
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

-- ============ (6) agenda_listar ============
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
  compartilhado_cliente boolean, cliente_resposta text, remarcacao_pendente jsonb, sequencia int  -- [hub]
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
    CASE WHEN m.mascarado THEN NULL ELSE o.sequencia END
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

-- ============ (7) agenda_feed_eventos ============
-- [hub] Body copied verbatim from 20261006000001_agenda_feed.sql; the only
-- change is the occurrence's "sequencia" in each item (the .ics download must
-- not carry a lower SEQUENCE than an e-mail the client already got). The
-- grants survive CREATE OR REPLACE and are re-stated.
-- The token is the credential. Returns:
--   NULL: unknown token, or the user is no longer a member / lost calendario ver
--   {"estado":"desligado","workspace_nome":..,"eventos":[]}: flag off (the
--     function still serves a valid, empty calendar)
--   {"estado":"ok","workspace_nome":..,"eventos":[...]}: the non-cancelled
--     occurrences of events the user organizes or attends (the organizer is
--     always a participant with sim), minus effective answer nao, with inicio in
--     [now() - 30 days, now() + 12 months), ordered by inicio, at most 2000.
-- No masking: everything here has the user as organizer or participant, and
-- agenda_listar's mascarado requires NOT participant. Overridden fields and the
-- local dates (exclusive end) use agenda_listar's expressions; keep them in sync.
CREATE OR REPLACE FUNCTION public.agenda_feed_eventos(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid; v_conta uuid; v_nome text; v_eventos jsonb;
BEGIN
  SELECT t.user_id, t.conta_id INTO v_user, v_conta
    FROM public.agenda_feed_tokens t WHERE t.token = p_token;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT public.has_permission_for(v_user, v_conta, 'calendario', 'ver') THEN RETURN NULL; END IF;
  SELECT w.name INTO v_nome FROM public.workspaces w WHERE w.id = v_conta;
  IF NOT public.effective_plan_feature(v_conta, 'feature_agenda') THEN
    RETURN jsonb_build_object('estado', 'desligado', 'workspace_nome', v_nome, 'eventos', '[]'::jsonb);
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.inicio, x.ocorrencia_id), '[]'::jsonb) INTO v_eventos
  FROM (
    SELECT o.id AS ocorrencia_id, e.id AS evento_id, o.data_original,
           o.inicio, o.fim, e.dia_inteiro,
           (o.inicio AT TIME ZONE e.tz)::date AS data_inicio_local,
           CASE WHEN e.dia_inteiro THEN (o.fim AT TIME ZONE e.tz)::date
                ELSE ((o.fim AT TIME ZONE e.tz) - interval '1 microsecond')::date + 1 END AS data_fim_local,
           CASE WHEN 'titulo' = ANY (o.campos_sobrescritos) THEN o.titulo ELSE e.titulo END AS titulo,
           CASE WHEN 'descricao' = ANY (o.campos_sobrescritos) THEN o.descricao ELSE e.descricao END AS descricao,
           CASE WHEN 'local' = ANY (o.campos_sobrescritos) THEN o.local ELSE e.local END AS local,
           CASE WHEN 'link_reuniao' = ANY (o.campos_sobrescritos) THEN o.link_reuniao ELSE e.link_reuniao END AS link_reuniao,
           e.tz,
           o.sequencia  -- [hub]
      FROM public.agenda_ocorrencias o
      JOIN public.agenda_eventos e ON e.id = o.evento_id AND e.conta_id = v_conta
      JOIN public.agenda_participantes ap ON ap.evento_id = e.id AND ap.user_id = v_user
      LEFT JOIN public.agenda_respostas ar ON ar.ocorrencia_id = o.id AND ar.user_id = v_user
     WHERE o.conta_id = v_conta
       AND NOT o.cancelada
       AND coalesce(ar.resposta, ap.resposta) IS DISTINCT FROM 'nao'
       AND o.inicio >= now() - interval '30 days'
       AND o.inicio <  now() + interval '12 months'
     ORDER BY o.inicio, o.id
     LIMIT 2000
  ) x;
  RETURN jsonb_build_object('estado', 'ok', 'workspace_nome', v_nome, 'eventos', v_eventos);
END $$;
REVOKE ALL ON FUNCTION public.agenda_feed_eventos(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_feed_eventos(text) TO service_role;

-- ============ (8) HUB RPCs ============
-- Called by the hub-agenda edge function with the service role, after
-- resolveHubToken resolved (conta_id, cliente_id) and checked
-- feature_hub_portal. Errors: RAISE 'agenda_hub:<codigo>' (P0001), codes
-- desligado, nao_encontrado, horario_mudou, ja_aconteceu, sugestao_passada,
-- hora_obrigatoria, pedido_pendente, ja_resolvido; the function maps them to
-- HTTP. Anything else (a malformed argument the function validates first) is a
-- plain error, which it answers with 500.

-- Internal: the Hub gate for one call. feature_agenda off -> desligado; a
-- cliente that is missing from p_conta or not 'ativo' (the spec's "arquivado")
-- -> nao_encontrado. Returns the cliente's name (notification metadata).
CREATE OR REPLACE FUNCTION public.agenda_hub_cliente(p_conta uuid, p_cliente bigint)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nome text;
  v_status text;
BEGIN
  IF p_conta IS NULL OR NOT public.effective_plan_feature(p_conta, 'feature_agenda') THEN
    RAISE EXCEPTION 'agenda_hub:desligado' USING ERRCODE = 'P0001';
  END IF;
  SELECT c.nome, c.status INTO v_nome, v_status FROM public.clientes c WHERE c.id = p_cliente AND c.conta_id = p_conta;
  IF NOT FOUND OR v_status IS DISTINCT FROM 'ativo' THEN
    RAISE EXCEPTION 'agenda_hub:nao_encontrado' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_nome;
END $$;

-- Internal: the Hub Item of one occurrence for p_cliente, or NULL when the
-- client may not see it (other workspace, not shared with this cliente,
-- private, cancelled). Item = the snapshot entry fields without estado, plus
-- the effective answer and the pending request. Overridden fields and local
-- dates use agenda_listar's expressions; keep them in sync.
CREATE OR REPLACE FUNCTION public.agenda_hub_item(p_conta uuid, p_cliente bigint, p_ocorrencia bigint)
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
           'resposta', CASE WHEN rc.resposta IS NOT NULL AND rc.inicio_respondido = o.inicio AND rc.cliente_id = e.cliente_id
                            THEN rc.resposta END,
           'remarcacao', (SELECT jsonb_build_object('id', rm.id, 'inicio_sugerido', rm.inicio_sugerido,
                                                    'fim_sugerido', rm.fim_sugerido, 'mensagem', rm.mensagem,
                                                    'criado_em', rm.criado_em)
                            FROM public.agenda_remarcacoes rm
                           WHERE rm.ocorrencia_id = o.id AND rm.status = 'pendente' AND rm.cliente_id = p_cliente))
    FROM public.agenda_ocorrencias o
    JOIN public.agenda_eventos e ON e.id = o.evento_id AND e.conta_id = p_conta
    LEFT JOIN public.agenda_respostas_cliente rc ON rc.ocorrencia_id = o.id
   WHERE o.id = p_ocorrencia AND o.conta_id = p_conta AND NOT o.cancelada
     AND e.compartilhado_cliente AND e.cliente_id = p_cliente AND NOT e.privado;
$$;

-- The client's shared occurrences, oldest first, from fim >= now() - 30 days,
-- in pages of p_limite (clamped to 1..100) with a keyset cursor
-- (inicio, id) > (p_apos_inicio, p_apos_id). Flag off: estado 'desligado'
-- with no items (not an error). A cliente that is not 'ativo' is refused
-- (nao_encontrado); one that no longer exists simply has nothing shared.
CREATE OR REPLACE FUNCTION public.agenda_hub_listar(
  p_conta uuid, p_cliente bigint, p_apos_inicio timestamptz DEFAULT NULL, p_apos_id bigint DEFAULT NULL, p_limite int DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text;
  v_lim int := least(greatest(coalesce(p_limite, 100), 1), 100);
  v_ids bigint[];
  v_ini timestamptz[];
  v_itens jsonb;
  v_proximo jsonb := NULL;
BEGIN
  IF p_conta IS NULL OR NOT public.effective_plan_feature(p_conta, 'feature_agenda') THEN
    RETURN jsonb_build_object('estado', 'desligado', 'itens', '[]'::jsonb, 'proximo', NULL);
  END IF;
  SELECT c.status INTO v_status FROM public.clientes c WHERE c.id = p_cliente AND c.conta_id = p_conta;
  IF FOUND AND v_status IS DISTINCT FROM 'ativo' THEN
    RAISE EXCEPTION 'agenda_hub:nao_encontrado' USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(x.id ORDER BY x.inicio, x.id), array_agg(x.inicio ORDER BY x.inicio, x.id) INTO v_ids, v_ini
    FROM (
      SELECT o.id, o.inicio
        FROM public.agenda_eventos e
        JOIN public.agenda_ocorrencias o ON o.evento_id = e.id AND o.conta_id = e.conta_id
       WHERE e.conta_id = p_conta AND e.cliente_id = p_cliente AND e.compartilhado_cliente AND NOT e.privado
         AND NOT o.cancelada
         AND o.fim >= now() - interval '30 days'
         AND (p_apos_inicio IS NULL OR p_apos_id IS NULL OR (o.inicio, o.id) > (p_apos_inicio, p_apos_id))
       ORDER BY o.inicio, o.id
       LIMIT v_lim + 1
    ) x;
  v_ids := coalesce(v_ids, '{}');
  IF cardinality(v_ids) > v_lim THEN
    v_proximo := jsonb_build_object('inicio', v_ini[v_lim], 'id', v_ids[v_lim]);
    v_ids := v_ids[1:v_lim];
  END IF;
  SELECT coalesce(jsonb_agg(public.agenda_hub_item(p_conta, p_cliente, t.id) ORDER BY t.n), '[]'::jsonb) INTO v_itens
    FROM unnest(v_ids) WITH ORDINALITY AS t(id, n);
  RETURN jsonb_build_object('estado', 'ok', 'itens', v_itens, 'proximo', v_proximo);
END $$;

-- One occurrence (deep link): the Item, or NULL when the client may not see it.
CREATE OR REPLACE FUNCTION public.agenda_hub_ocorrencia(p_conta uuid, p_cliente bigint, p_ocorrencia bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.agenda_hub_cliente(p_conta, p_cliente);
  RETURN public.agenda_hub_item(p_conta, p_cliente, p_ocorrencia);
END $$;

-- The client confirms (sim) or declines (nao) one occurrence, until its end.
-- p_inicio_visto is the inicio the Hub showed: a different current inicio
-- (timestamptz comparison) is horario_mudou. Lock order of the edit RPCs:
-- series (FOR SHARE, like agenda_responder) then the occurrence (FOR UPDATE,
-- serializing two answers to the same occurrence). The team is notified
-- (event_client_rsvp) only when the effective answer changes.
CREATE OR REPLACE FUNCTION public.agenda_hub_responder(
  p_conta uuid, p_cliente bigint, p_ocorrencia bigint, p_resposta text, p_inicio_visto timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nome text;
  v_o public.agenda_ocorrencias;
  v_e public.agenda_eventos;
  v_antes text;
BEGIN
  v_nome := public.agenda_hub_cliente(p_conta, p_cliente);
  IF p_resposta IS NULL OR p_resposta NOT IN ('sim', 'nao') THEN
    RAISE EXCEPTION 'agenda_hub: resposta inválida' USING ERRCODE = '22023';
  END IF;

  SELECT o.* INTO v_o FROM public.agenda_ocorrencias o WHERE o.id = p_ocorrencia AND o.conta_id = p_conta;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda_hub:nao_encontrado' USING ERRCODE = 'P0001'; END IF;
  SELECT e.* INTO v_e FROM public.agenda_eventos e WHERE e.id = v_o.evento_id AND e.conta_id = p_conta FOR SHARE;
  IF NOT FOUND OR NOT v_e.compartilhado_cliente OR v_e.cliente_id IS DISTINCT FROM p_cliente OR v_e.privado THEN
    RAISE EXCEPTION 'agenda_hub:nao_encontrado' USING ERRCODE = 'P0001';
  END IF;
  SELECT o.* INTO v_o FROM public.agenda_ocorrencias o
   WHERE o.id = p_ocorrencia AND o.evento_id = v_e.id AND NOT o.cancelada FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda_hub:nao_encontrado' USING ERRCODE = 'P0001'; END IF;

  IF v_o.fim <= now() THEN RAISE EXCEPTION 'agenda_hub:ja_aconteceu' USING ERRCODE = 'P0001'; END IF;
  IF p_inicio_visto IS DISTINCT FROM v_o.inicio THEN RAISE EXCEPTION 'agenda_hub:horario_mudou' USING ERRCODE = 'P0001'; END IF;

  SELECT CASE WHEN rc.resposta IS NOT NULL AND rc.inicio_respondido = v_o.inicio AND rc.cliente_id = p_cliente
              THEN rc.resposta END
    INTO v_antes FROM public.agenda_respostas_cliente rc WHERE rc.ocorrencia_id = v_o.id;

  INSERT INTO public.agenda_respostas_cliente AS rc (ocorrencia_id, conta_id, cliente_id, resposta, respondido_em, inicio_respondido)
  VALUES (v_o.id, p_conta, p_cliente, p_resposta, now(), v_o.inicio)
  ON CONFLICT (ocorrencia_id) DO UPDATE
     SET cliente_id = EXCLUDED.cliente_id, resposta = EXCLUDED.resposta,
         respondido_em = EXCLUDED.respondido_em, inicio_respondido = EXCLUDED.inicio_respondido,
         lembrado_inicio = CASE WHEN rc.cliente_id = EXCLUDED.cliente_id THEN rc.lembrado_inicio END;

  IF v_antes IS DISTINCT FROM p_resposta THEN
    PERFORM public.agenda_notificar(
      p_conta, v_e.id, v_o.id, 'event_client_rsvp',
      public.agenda_cliente_destinatarios(p_conta, v_e.organizador_id), NULL,
      jsonb_build_object('cliente_nome', v_nome, 'resposta', p_resposta,
                         'data_inicio_local', to_char((v_o.inicio AT TIME ZONE v_e.tz)::date, 'YYYY-MM-DD')));
  END IF;

  RETURN public.agenda_hub_item(p_conta, p_cliente, v_o.id);
END $$;

-- The client asks to move one occurrence (spec §4). The Hub sends local wall
-- clock (p_data, p_hora); this converts it in the series tz and keeps the
-- occurrence's duration. All-day: p_hora is ignored, inicio = local midnight of
-- p_data, fim exclusive by the same number of days. Timed without p_hora:
-- hora_obrigatoria. The occurrence must not have started, the suggestion must
-- be in the future, and there is at most one pending request per occurrence
-- (checked after locking the occurrence; the partial unique index backs it).
-- p_mensagem blank -> NULL.
CREATE OR REPLACE FUNCTION public.agenda_hub_remarcar(
  p_conta uuid, p_cliente bigint, p_ocorrencia bigint, p_data date, p_hora time, p_mensagem text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nome text;
  v_o public.agenda_ocorrencias;
  v_e public.agenda_eventos;
  v_ini timestamptz;
  v_fim timestamptz;
  v_msg text := NULLIF(btrim(p_mensagem), '');
BEGIN
  v_nome := public.agenda_hub_cliente(p_conta, p_cliente);
  IF p_data IS NULL OR NOT isfinite(p_data) THEN
    RAISE EXCEPTION 'agenda_hub: data inválida' USING ERRCODE = '22023';
  END IF;

  SELECT o.* INTO v_o FROM public.agenda_ocorrencias o WHERE o.id = p_ocorrencia AND o.conta_id = p_conta;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda_hub:nao_encontrado' USING ERRCODE = 'P0001'; END IF;
  SELECT e.* INTO v_e FROM public.agenda_eventos e WHERE e.id = v_o.evento_id AND e.conta_id = p_conta FOR SHARE;
  IF NOT FOUND OR NOT v_e.compartilhado_cliente OR v_e.cliente_id IS DISTINCT FROM p_cliente OR v_e.privado THEN
    RAISE EXCEPTION 'agenda_hub:nao_encontrado' USING ERRCODE = 'P0001';
  END IF;
  SELECT o.* INTO v_o FROM public.agenda_ocorrencias o
   WHERE o.id = p_ocorrencia AND o.evento_id = v_e.id AND NOT o.cancelada FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda_hub:nao_encontrado' USING ERRCODE = 'P0001'; END IF;

  IF v_o.inicio <= now() THEN RAISE EXCEPTION 'agenda_hub:ja_aconteceu' USING ERRCODE = 'P0001'; END IF;

  IF v_e.dia_inteiro THEN
    v_ini := (p_data::timestamp) AT TIME ZONE v_e.tz;
    v_fim := ((p_data + ((v_o.fim AT TIME ZONE v_e.tz)::date - (v_o.inicio AT TIME ZONE v_e.tz)::date))::timestamp) AT TIME ZONE v_e.tz;
  ELSE
    IF p_hora IS NULL THEN RAISE EXCEPTION 'agenda_hub:hora_obrigatoria' USING ERRCODE = 'P0001'; END IF;
    v_ini := (p_data + date_trunc('minute', p_hora)::time) AT TIME ZONE v_e.tz;
    v_fim := v_ini + (v_o.fim - v_o.inicio);
  END IF;
  IF v_ini <= now() THEN RAISE EXCEPTION 'agenda_hub:sugestao_passada' USING ERRCODE = 'P0001'; END IF;

  IF EXISTS (SELECT 1 FROM public.agenda_remarcacoes rm WHERE rm.ocorrencia_id = v_o.id AND rm.status = 'pendente') THEN
    RAISE EXCEPTION 'agenda_hub:pedido_pendente' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    INSERT INTO public.agenda_remarcacoes (conta_id, cliente_id, ocorrencia_id, inicio_sugerido, fim_sugerido, mensagem)
    VALUES (p_conta, p_cliente, v_o.id, v_ini, v_fim, v_msg);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'agenda_hub:pedido_pendente' USING ERRCODE = 'P0001';
  END;

  PERFORM public.agenda_notificar(
    p_conta, v_e.id, v_o.id, 'event_reschedule_requested',
    public.agenda_cliente_destinatarios(p_conta, v_e.organizador_id), NULL,
    jsonb_build_object('cliente_nome', v_nome, 'inicio_sugerido', v_ini, 'fim_sugerido', v_fim,
                       'data_inicio_local', to_char((v_o.inicio AT TIME ZONE v_e.tz)::date, 'YYYY-MM-DD')));

  RETURN public.agenda_hub_item(p_conta, p_cliente, v_o.id);
END $$;

-- The client withdraws its own pending request. Lock order series ->
-- occurrence -> request; zero rows in the conditional UPDATE = ja_resolvido.
CREATE OR REPLACE FUNCTION public.agenda_hub_cancelar_remarcacao(p_conta uuid, p_cliente bigint, p_remarcacao bigint)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_oc bigint;
  v_ev bigint;
BEGIN
  PERFORM public.agenda_hub_cliente(p_conta, p_cliente);
  SELECT rm.ocorrencia_id, o.evento_id INTO v_oc, v_ev
    FROM public.agenda_remarcacoes rm
    JOIN public.agenda_ocorrencias o ON o.id = rm.ocorrencia_id
   WHERE rm.id = p_remarcacao AND rm.conta_id = p_conta AND rm.cliente_id = p_cliente;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda_hub:nao_encontrado' USING ERRCODE = 'P0001'; END IF;
  PERFORM 1 FROM public.agenda_eventos e WHERE e.id = v_ev FOR SHARE;
  PERFORM 1 FROM public.agenda_ocorrencias o WHERE o.id = v_oc FOR UPDATE;
  PERFORM 1 FROM public.agenda_remarcacoes rm WHERE rm.id = p_remarcacao FOR UPDATE;

  UPDATE public.agenda_remarcacoes rm
     SET status = 'cancelada', resolvido_em = now()
   WHERE rm.id = p_remarcacao AND rm.status = 'pendente';
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda_hub:ja_resolvido' USING ERRCODE = 'P0001'; END IF;
END $$;

-- ============ team RPC: resolve a reschedule request ============
-- Accept (spec §4, amendment 4): (a) agenda_pode_editar pre-check; (b) lock
-- series -> occurrence -> request; (c) the conditional transition to 'aceita'
-- (zero rows: already resolved) BEFORE editing, so the substitution inside
-- agenda_evento_editar no longer sees it as pending; (d) GUC agenda.remarcacao
-- = the request id, so agenda_cliente_enfileirar turns the edit's 'alteracao'
-- into 'remarcacao_aceita'; (e) agenda_evento_editar(esta) with the suggested
-- wall clock in the series tz (payload convention of store/agenda.ts: local
-- 'YYYY-MM-DDTHH:MI:SS', all-day midnight + exclusive end date), so the same
-- semantics and team notifications as a manual edit apply; (f) the client's
-- answer becomes sim for the new inicio (the client proposed it). A suggestion
-- already in the past is refused and the request stays pending. Decline: the
-- conditional transition to 'recusada' with the optional team message, and a
-- 'remarcacao_recusada' e-mail with the time that still holds.
-- Errors carry the "agenda: " prefix the CRM's formatAgendaError shows.
CREATE OR REPLACE FUNCTION public.agenda_remarcacao_resolver(p_remarcacao bigint, p_aceitar boolean, p_mensagem text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conta uuid;
  v_user uuid;
  v_rm public.agenda_remarcacoes;
  v_o public.agenda_ocorrencias;
  v_e public.agenda_eventos;
  v_msg text := NULLIF(btrim(p_mensagem), '');
  v_oc bigint;
  v_inicio timestamptz;
BEGIN
  v_conta := get_my_conta_id(); v_user := auth.uid();
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'agenda: sessão sem workspace ativo'; END IF;
  IF NOT public.effective_plan_feature(v_conta, 'feature_agenda') THEN
    RAISE EXCEPTION 'feature_disabled:feature_agenda' USING ERRCODE = 'P0001';
  END IF;
  IF p_aceitar IS NULL THEN RAISE EXCEPTION 'agenda: dados do evento inválidos'; END IF;
  IF char_length(v_msg) > 1000 THEN
    RAISE EXCEPTION 'agenda: a mensagem pode ter no máximo 1000 caracteres.';
  END IF;

  SELECT rm.* INTO v_rm FROM public.agenda_remarcacoes rm WHERE rm.id = p_remarcacao AND rm.conta_id = v_conta;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;
  SELECT o.* INTO v_o FROM public.agenda_ocorrencias o WHERE o.id = v_rm.ocorrencia_id AND o.conta_id = v_conta;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;
  -- (b) series -> occurrence -> request
  SELECT e.* INTO v_e FROM public.agenda_eventos e WHERE e.id = v_o.evento_id AND e.conta_id = v_conta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;
  -- (a) who may edit the event may resolve its requests
  IF NOT public.agenda_pode_editar(v_e, v_user, v_conta) THEN
    RAISE EXCEPTION 'agenda: você não pode editar este evento';
  END IF;
  SELECT o.* INTO v_o FROM public.agenda_ocorrencias o WHERE o.id = v_rm.ocorrencia_id AND o.evento_id = v_e.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;
  SELECT rm.* INTO v_rm FROM public.agenda_remarcacoes rm WHERE rm.id = p_remarcacao FOR UPDATE;

  IF NOT p_aceitar THEN
    UPDATE public.agenda_remarcacoes rm
       SET status = 'recusada', resolvido_em = now(), resolvido_por = v_user, resposta_equipe = v_msg
     WHERE rm.id = p_remarcacao AND rm.status = 'pendente'
    RETURNING rm.* INTO v_rm;
    IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este pedido já foi resolvido.'; END IF;
    PERFORM public.agenda_cliente_enfileirar(
      v_conta, v_rm.cliente_id, v_e.id, 'remarcacao_recusada',
      public.agenda_cliente_ocorrencias_snapshot(NULL, 'ativa', v_o.id),
      jsonb_build_object('remarcacao_id', v_rm.id, 'inicio_sugerido', v_rm.inicio_sugerido,
                         'fim_sugerido', v_rm.fim_sugerido, 'mensagem', v_rm.mensagem,
                         'resposta_equipe', v_rm.resposta_equipe));
    RETURN;
  END IF;

  IF v_rm.status = 'pendente' AND v_rm.inicio_sugerido <= now() THEN
    RAISE EXCEPTION 'agenda: esse horário já passou. Combine outro com o cliente.';
  END IF;
  -- (c)
  UPDATE public.agenda_remarcacoes rm
     SET status = 'aceita', resolvido_em = now(), resolvido_por = v_user, resposta_equipe = v_msg
   WHERE rm.id = p_remarcacao AND rm.status = 'pendente'
  RETURNING rm.* INTO v_rm;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este pedido já foi resolvido.'; END IF;

  -- (d) + (e)
  PERFORM set_config('agenda.remarcacao', v_rm.id::text, true);
  v_oc := public.agenda_evento_editar(v_o.id, 'esta', jsonb_build_object(
    'inicio_local', to_char(v_rm.inicio_sugerido AT TIME ZONE v_e.tz, 'YYYY-MM-DD"T"HH24:MI:SS'),
    'fim_local', to_char(v_rm.fim_sugerido AT TIME ZONE v_e.tz, 'YYYY-MM-DD"T"HH24:MI:SS')));
  v_oc := coalesce(v_oc, v_o.id);
  SELECT o.inicio INTO v_inicio FROM public.agenda_ocorrencias o WHERE o.id = v_oc;

  -- a suggestion equal to the current time changes nothing in the edit, so it
  -- enqueued nothing: the client still gets the "remarcação aceita" e-mail
  IF NOT EXISTS (SELECT 1 FROM public.agenda_emails_cliente q
                  WHERE q.cliente_id = v_rm.cliente_id AND q.tipo = 'remarcacao_aceita'
                    AND (q.remarcacao->>'remarcacao_id')::bigint = v_rm.id) THEN
    PERFORM public.agenda_cliente_enfileirar(v_conta, v_rm.cliente_id, v_e.id, 'alteracao',
      public.agenda_cliente_ocorrencias_snapshot(NULL, 'ativa', v_oc));
  END IF;
  PERFORM set_config('agenda.remarcacao', '', true);

  -- (f)
  IF v_inicio IS NOT NULL THEN
    INSERT INTO public.agenda_respostas_cliente AS rc (ocorrencia_id, conta_id, cliente_id, resposta, respondido_em, inicio_respondido)
    VALUES (v_oc, v_conta, v_rm.cliente_id, 'sim', now(), v_inicio)
    ON CONFLICT (ocorrencia_id) DO UPDATE
       SET cliente_id = EXCLUDED.cliente_id, resposta = 'sim', respondido_em = EXCLUDED.respondido_em,
           inicio_respondido = EXCLUDED.inicio_respondido,
           lembrado_inicio = CASE WHEN rc.cliente_id = EXCLUDED.cliente_id THEN rc.lembrado_inicio END;
  END IF;
END $$;

-- ============ queue: claim / mark (agenda-cliente-email) ============
-- Internal (service_role). First settles what must no longer be claimed:
-- expired leases at the 3-attempt cap -> 'falhou'; due items whose gate is
-- closed -> 'descartado' (no retry): feature_agenda off, cliente not 'ativo',
-- empty e-mail, send_event_email off, unsubscribed, or (except a cancellation,
-- i.e. tipo cancelamento or a snapshot with no 'ativa' entry) the event no
-- longer shared with this cliente. Then claims due 'pendente' items and expired
-- leases (FOR UPDATE SKIP LOCKED): status 'enviando', a 2-minute lease, one
-- more attempt. Returns what the e-mail needs, the brand header included.
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
           'workspace_nome', w.name, 'brand_color', w.brand_color, 'logo_url', w.logo_url)
         ORDER BY u.enviar_apos, u.id), '[]'::jsonb)
    INTO v
    FROM upd u
    JOIN public.clientes c ON c.id = u.cliente_id AND c.conta_id = u.conta_id
    JOIN public.workspaces w ON w.id = u.conta_id;
  RETURN v;
END $$;

-- Internal (service_role). Settles one claimed item: ok -> 'enviado';
-- failure -> back to 'pendente' without lease (re-claimed by the next tick),
-- or 'falhou' at 3 attempts. Only an 'enviando' item with the same versao
-- changes, so a repeated or stale mark is a no-op.
CREATE OR REPLACE FUNCTION public.agenda_cliente_marcar_email(p_id bigint, p_versao int, p_ok boolean, p_erro text DEFAULT NULL)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.agenda_emails_cliente q
     SET status = CASE WHEN p_ok THEN 'enviado' WHEN q.tentativas >= 3 THEN 'falhou' ELSE 'pendente' END,
         lease_ate = NULL,
         enviado_em = CASE WHEN p_ok THEN now() ELSE q.enviado_em END,
         ultimo_erro = CASE WHEN p_ok THEN NULL ELSE left(p_erro, 1000) END
   WHERE q.id = p_id AND q.versao = p_versao AND q.status = 'enviando';
$$;

-- Internal (pg_cron, every minute). Removes settled items older than 30 days,
-- then calls agenda-cliente-email through pg_net only when an item is due
-- (pattern of agenda_tick_lembretes: x-cron-secret from the vault, http_post
-- guarded so a failure never aborts the job; items just wait for the next run).
CREATE OR REPLACE FUNCTION public.agenda_cliente_tick()
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_url text;
  v_secret text;
BEGIN
  DELETE FROM public.agenda_emails_cliente q
   WHERE q.status IN ('enviado', 'descartado', 'falhou') AND q.enviar_apos < now() - interval '30 days';

  IF EXISTS (SELECT 1 FROM public.agenda_emails_cliente q
              WHERE (q.status = 'pendente' AND q.enviar_apos <= now())
                 OR (q.status = 'enviando' AND q.lease_ate < now())) THEN
    BEGIN
      SELECT (SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.name = 'project_url'),
             (SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.name = 'cron_secret')
        INTO v_url, v_secret;
      IF v_url IS NOT NULL AND v_secret IS NOT NULL THEN
        PERFORM net.http_post(
          url := v_url || '/functions/v1/agenda-cliente-email',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
          body := '{}'::jsonb);
      ELSE
        RAISE WARNING 'agenda_cliente_tick: vault secrets missing, e-mail skipped';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'agenda_cliente_tick: http_post failed: %', SQLERRM;
    END;
  END IF;
END $$;

-- ============ digest "Pendências do Hub" (client-event-email-cron) ============
-- Internal (service_role). Shared, non-cancelled occurrences of p_cliente
-- without an effective answer that start in (p_now + 1 h, p_now + 48 h] and
-- were not reminded for this inicio (lembrado_inicio IS DISTINCT FROM inicio):
-- each start time is reminded once, moving the event allows a new reminder.
-- At most 20. feature_agenda off: [].
CREATE OR REPLACE FUNCTION public.agenda_cliente_lembretes_pendentes(p_conta uuid, p_cliente bigint, p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v jsonb;
BEGIN
  IF p_conta IS NULL OR NOT public.effective_plan_feature(p_conta, 'feature_agenda') THEN
    RETURN '[]'::jsonb;
  END IF;
  SELECT coalesce(jsonb_agg(x.j ORDER BY x.inicio, x.id), '[]'::jsonb) INTO v
    FROM (
      SELECT o.id, o.inicio, jsonb_build_object(
               'ocorrencia_id', o.id,
               'inicio', o.inicio,
               'fim', o.fim,
               'dia_inteiro', e.dia_inteiro,
               'data_inicio_local', (o.inicio AT TIME ZONE e.tz)::date,
               'tz', e.tz,
               'titulo', CASE WHEN 'titulo' = ANY (o.campos_sobrescritos) THEN o.titulo ELSE e.titulo END) AS j
        FROM public.agenda_eventos e
        JOIN public.agenda_ocorrencias o ON o.evento_id = e.id AND o.conta_id = e.conta_id
        LEFT JOIN public.agenda_respostas_cliente rc ON rc.ocorrencia_id = o.id AND rc.cliente_id = p_cliente
       WHERE e.conta_id = p_conta AND e.cliente_id = p_cliente AND e.compartilhado_cliente AND NOT e.privado
         AND NOT o.cancelada
         AND o.inicio > p_now + interval '1 hour'
         AND o.inicio <= p_now + interval '48 hours'
         AND NOT coalesce(rc.resposta IS NOT NULL AND rc.inicio_respondido = o.inicio, false)
         AND rc.lembrado_inicio IS DISTINCT FROM o.inicio
       ORDER BY o.inicio, o.id
       LIMIT 20
    ) x;
  RETURN v;
END $$;

-- Internal (service_role). After the digest went out: lembrado_inicio = inicio
-- for each [{ocorrencia_id, inicio}] that still belongs to p_cliente in
-- p_conta (creates the row with resposta NULL when there is none; a stale row
-- of another cliente is taken over without its answer).
CREATE OR REPLACE FUNCTION public.agenda_cliente_lembretes_marcar(p_conta uuid, p_cliente bigint, p_itens jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' THEN RETURN; END IF;
  INSERT INTO public.agenda_respostas_cliente AS rc (ocorrencia_id, conta_id, cliente_id, lembrado_inicio)
  SELECT DISTINCT ON (o.id) o.id, p_conta, p_cliente, (x->>'inicio')::timestamptz
    FROM jsonb_array_elements(p_itens) x
    JOIN public.agenda_ocorrencias o ON o.id = (x->>'ocorrencia_id')::bigint AND o.conta_id = p_conta
    JOIN public.agenda_eventos e ON e.id = o.evento_id AND e.conta_id = p_conta AND e.cliente_id = p_cliente
   WHERE jsonb_typeof(x) = 'object' AND (x->>'ocorrencia_id') ~ '^[0-9]{1,18}$' AND x ? 'inicio'
   ORDER BY o.id
  ON CONFLICT (ocorrencia_id) DO UPDATE
     SET lembrado_inicio = EXCLUDED.lembrado_inicio,
         resposta = CASE WHEN rc.cliente_id = EXCLUDED.cliente_id THEN rc.resposta END,
         respondido_em = CASE WHEN rc.cliente_id = EXCLUDED.cliente_id THEN rc.respondido_em END,
         inicio_respondido = CASE WHEN rc.cliente_id = EXCLUDED.cliente_id THEN rc.inicio_respondido END,
         cliente_id = EXCLUDED.cliente_id;
END $$;

-- ---- grants ----
REVOKE ALL ON FUNCTION public.agenda_hub_cliente(uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_hub_item(uuid, bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_hub_listar(uuid, bigint, timestamptz, bigint, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_hub_ocorrencia(uuid, bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_hub_responder(uuid, bigint, bigint, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_hub_remarcar(uuid, bigint, bigint, date, time, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_hub_cancelar_remarcacao(uuid, bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_cliente_claim_emails(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_cliente_marcar_email(bigint, int, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_cliente_tick() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_cliente_lembretes_pendentes(uuid, bigint, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_cliente_lembretes_marcar(uuid, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_hub_cliente(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_hub_item(uuid, bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_hub_listar(uuid, bigint, timestamptz, bigint, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_hub_ocorrencia(uuid, bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_hub_responder(uuid, bigint, bigint, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_hub_remarcar(uuid, bigint, bigint, date, time, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_hub_cancelar_remarcacao(uuid, bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_cliente_claim_emails(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_cliente_marcar_email(bigint, int, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_cliente_tick() TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_cliente_lembretes_pendentes(uuid, bigint, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_cliente_lembretes_marcar(uuid, bigint, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.agenda_remarcacao_resolver(bigint, boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agenda_remarcacao_resolver(bigint, boolean, text) TO authenticated, service_role;

-- ---- cron ----
-- Every minute (SQL-only; the pg_net call happens only when an item is due).
-- Until the agenda-cliente-email function is deployed the calls fail and the
-- items simply stay pendente, nothing is lost.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agenda-cliente-email') THEN PERFORM cron.unschedule('agenda-cliente-email'); END IF;
END $$;
SELECT cron.schedule('agenda-cliente-email', '* * * * *', $$SELECT public.agenda_cliente_tick()$$);

-- ============ (9) GRANT ASSERTIONS ============
DO $$
DECLARE
  v_t text;
  v_fn text;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['agenda_respostas_cliente', 'agenda_remarcacoes', 'agenda_emails_cliente'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema = 'public' AND table_name = v_t AND grantee IN ('anon', 'authenticated')) THEN
      RAISE EXCEPTION '%: anon/authenticated hold a privilege', v_t;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.agenda_hub_listar(uuid, bigint, timestamptz, bigint, int)',
    'public.agenda_hub_ocorrencia(uuid, bigint, bigint)',
    'public.agenda_hub_responder(uuid, bigint, bigint, text, timestamptz)',
    'public.agenda_hub_remarcar(uuid, bigint, bigint, date, time, text)',
    'public.agenda_hub_cancelar_remarcacao(uuid, bigint, bigint)',
    'public.agenda_hub_cliente(uuid, bigint)',
    'public.agenda_hub_item(uuid, bigint, bigint)',
    'public.agenda_cliente_enfileirar(uuid, bigint, bigint, text, jsonb, jsonb)',
    'public.agenda_cliente_ocorrencias_snapshot(bigint, text, bigint, date)',
    'public.agenda_cliente_substituir_pedidos(bigint, bigint, date)',
    'public.agenda_cliente_diff(jsonb, jsonb)',
    'public.agenda_cliente_destinatarios(uuid, uuid)',
    'public.agenda_cliente_claim_emails(int)',
    'public.agenda_cliente_marcar_email(bigint, int, boolean, text)',
    'public.agenda_cliente_tick()',
    'public.agenda_cliente_lembretes_pendentes(uuid, bigint, timestamptz)',
    'public.agenda_cliente_lembretes_marcar(uuid, bigint, jsonb)'] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '%: anon/authenticated can execute', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '%: service_role cannot execute', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY['public.agenda_remarcacao_resolver(bigint, boolean, text)',
                              'public.agenda_listar(timestamptz, timestamptz, bigint)'] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN RAISE EXCEPTION '%: anon can execute', v_fn; END IF;
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '%: authenticated/service_role cannot execute', v_fn;
    END IF;
  END LOOP;
END
$$;
