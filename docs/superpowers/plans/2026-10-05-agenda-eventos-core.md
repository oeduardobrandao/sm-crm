# Agenda (sub-projeto 1: núcleo de eventos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the CRM `/calendario` page into a Google-Calendar-like team agenda: events with full recurrence (this / following / all), private-as-busy, team invites with RSVP, reminders in-app and by e-mail, month/week/day/list views.

**Architecture:** Series rows (`agenda_eventos`) hold the rule; Postgres materializes occurrence rows (`agenda_ocorrencias`) up to a 24-month horizon. All date math, masking and writes live in SECURITY DEFINER RPCs (tables are SELECT-only for `authenticated`). Notifications reuse the existing `notifications` table and digest; reminders get a ledger, a SQL-only per-minute pg_cron tick and a small e-mail edge function. The CRM renders FullCalendar 6.1 over `agenda_listar`.

**Tech Stack:** Postgres (plpgsql, pg_cron, pg_net, RLS), Supabase CLI local stack + psql suites, Deno edge functions, React 19 + TypeScript, TanStack Query, FullCalendar 6.1.21, react-hook-form + zod, shadcn/ui, lucide-react, sonner, Vitest + Testing Library.

**Spec (read it fully before any task):** `docs/superpowers/specs/2026-10-05-agenda-eventos-core-design.md`. Every task cites the spec section it implements; where this plan and the spec disagree, the spec wins and you report the conflict.
**Mockups:** https://claude.ai/artifact/X43LyHBG7mLXL7bnqENzg6 (visual reference for Tasks 9 to 11).

## Global Constraints

- Migrations: `supabase/migrations/20261005000001_agenda_eventos.sql` (A) and `20261005000002_agenda_lembretes.sql` (B). Before the PR, `git fetch origin main && ls supabase/migrations | tail -3`; renumber above main's tail if needed.
- Every function `SET search_path = public`. Internal SECURITY DEFINER: `REVOKE ALL ON FUNCTION f(...) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION f(...) TO service_role;`. Client-facing SECURITY DEFINER RPCs: `REVOKE ALL ON FUNCTION f(...) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION f(...) TO authenticated, service_role;`. Pure date functions keep default EXECUTE.
- RPC preamble: `v_conta := get_my_conta_id(); v_user := auth.uid(); IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'agenda: sessão sem workspace ativo'; END IF;`. Every user-facing RAISE message starts with `agenda: ` followed by pt-BR copy (the front strips the prefix and shows the rest).
- All user-facing copy pt-BR, sentence case, **no em-dashes** (period or colon instead). Copy in this plan is final.
- Toasts: `toast()` from `sonner`. Icons: `lucide-react`. Primitives: `apps/crm/src/components/ui/`. Alias `@/` = `apps/crm/src/`.
- Store = plain async functions in `apps/crm/src/store/*.ts`, wrapped by `useQuery`/`useMutation` in components.
- Never `useBlocker`. Dialogs with unsaved state use `confirmClose` + `onConfirmClose` on `DialogContent`.
- `href` from user data goes through `sanitizeUrl()` (`apps/crm/src/utils/security.ts`). Edge-function HTML escapes every interpolated value with `escapeHtml` (`supabase/functions/_shared/report-template/escape.ts`).
- FullCalendar packages pinned `~6.1.21`: `@fullcalendar/core`, `@fullcalendar/react`, `@fullcalendar/daygrid`, `@fullcalendar/timegrid`, `@fullcalendar/list`, `@fullcalendar/interaction`. No `@fullcalendar/rrule`, no premium plugins, no luxon/moment.
- Participant identity is `auth.users.id` (uuid). The people roster is `getWorkspaceUsers()` (`apps/crm/src/store/workspace.ts:3`), never `membros`.
- CI gates before pushing: `npm run lint`, `npm run format:check`, `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`, `npm run test`, `npm run check:functions`, `npm run test:functions`, `bash scripts/test-entitlements.sh`.
- Commit after every task, message in English conventional style, trailer exactly: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push.

## Local database workflow (Tasks 1 to 5)

```bash
colima status || colima start --cpu 4 --memory 8
npx supabase start            # once; if default ports are busy see memory reference_local_supabase_colima (port overrides, restore config.toml after)
npx supabase db reset         # after every migration edit
psql "${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_agenda_datas_regra.sql
bash scripts/test-entitlements.sh   # full CI set
```

Suites follow `supabase/tests/entitlements/99_tarefa_series_rls.sql`: `\set ON_ERROR_STOP on`, `\i supabase/tests/entitlements/_helpers.sql`, `begin; ... rollback;`, one or more `do $$ ... $$` blocks, `et_make_workspace('start')`, impersonation with `perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role','authenticated')::text, true); execute 'set local role authenticated';` and `execute 'reset role';`, final `raise notice 'PASS <suite>';`. "Today" is pinned with `perform set_config('app.agenda_hoje', '2026-10-05', true);`.

## File structure

Database:
- `supabase/migrations/20261005000001_agenda_eventos.sql` (A): sections appended by Tasks 1, 2, 3, 4: (1) tables, FKs, guard, RLS, grants; (2) date math + materialization + horizon generator + its cron; (3) read RPC + create RPC + notification types/digest claim; (4) edit/delete/RSVP RPCs.
- `supabase/migrations/20261005000002_agenda_lembretes.sql` (B): Task 5.
- `supabase/tests/entitlements/99_agenda_rls.sql` (Tasks 1, 3), `99_agenda_datas_regra.sql` (Task 2), `99_agenda_edicao.sql` (Tasks 3, 4), `99_agenda_lembretes.sql` (Task 5); `96_lockdown_definer_function_grants.sql` (Tasks 1 to 5 append names).
- `docs/superpowers/specs/assets/2026-10-05-agenda-rollback.sql` (Task 5).

Edge:
- `supabase/functions/_shared/notification-email.ts` (Task 6: three digest types).
- `supabase/functions/_shared/agenda-email.ts`, `supabase/functions/agenda-lembretes-email/{handler,index}.ts`, `supabase/config.toml` (Task 6).
- Tests: `supabase/functions/__tests__/agenda-email_test.ts`, `agenda-lembretes-email_test.ts`, `cron-auth_test.ts`, `notification-email_test.ts` (Task 6).

CRM:
- `apps/crm/src/store/notifications.ts`, `apps/crm/src/lib/notification-catalog.ts`, `apps/crm/src/lib/notification-config.ts` + tests in `apps/crm/src/__tests__/` (Task 7).
- `apps/crm/src/store/agenda.ts` + `apps/crm/src/store/__tests__/agenda.test.ts`, barrel `apps/crm/src/store/index.ts` (Task 8).
- `apps/crm/src/pages/calendario/agenda/agendaLogic.ts` + `__tests__/agendaLogic.test.ts` (Task 8).
- `apps/crm/src/pages/calendario/agenda/{AgendaTab,AgendaView,AgendaSidebar}.tsx`, `CalendarioPage.tsx`, `apps/crm/style.css`, `package.json`/`package-lock.json`, `AuthContext.tsx` (Task 9).
- `apps/crm/src/pages/calendario/agenda/{EventoFormDialog,eventoFormSchema,RepetirSelect,RecorrenciaPersonalizadaDialog,EscopoEventoDialog,PessoasCombobox}.tsx|ts` (Task 10).
- `apps/crm/src/pages/calendario/agenda/EventoPopover.tsx`, `useAgendaMutations.ts` (Task 11).

## Parallel lanes

| Wave | Lanes (run in parallel) |
|---|---|
| 1 | **SQL**: Task 1 · **EDGE**: Task 6 · **NOTIF**: Task 7 · **LOGIC**: Task 8 |
| 2 | **SQL**: Task 2 · **UI-A**: Task 9 · **UI-B**: Task 10 |
| 3 | **SQL**: Task 3 then Task 4 · **UI-C**: Task 11 |
| 4 | **SQL**: Task 5 |
| 5 | Task 12 (controller: integration, gates, browser) |

The SQL lane is one long-lived implementer resumed per task (one Supabase stack). Frontend lanes depend only on the RPC contracts below, never on a running DB.

## RPC contracts (shared by every lane)

```sql
-- Read (STABLE, DEFINER). One row per visible occurrence.
agenda_listar(p_de timestamptz, p_ate timestamptz, p_ocorrencia_id bigint DEFAULT NULL)
RETURNS TABLE (
  ocorrencia_id bigint, evento_id bigint, data_original date,
  inicio timestamptz, fim timestamptz, dia_inteiro boolean,
  data_inicio_local date, data_fim_local date,          -- fim exclusivo, no tz da série
  titulo text, descricao text, local text, link_reuniao text,
  tipo text, cor text, cliente_id bigint, cliente_nome text,
  privado boolean, mascarado boolean, recorrente boolean,
  regra jsonb,               -- null quando não repete ou mascarado; shape AgendaRegra abaixo
  organizador_id uuid,
  participantes jsonb,       -- [{"user_id": uuid, "resposta": "pendente"|"sim"|"nao"|"talvez"|null}]
  minha_resposta text, pode_editar boolean, pode_responder boolean, tz text
)

agenda_evento_criar(p_evento jsonb, p_participantes uuid[])
RETURNS TABLE (evento_id bigint, ocorrencia_id bigint, dtstart timestamp)

agenda_evento_editar(p_ocorrencia_id bigint, p_escopo text, p_evento jsonb, p_participantes uuid[] DEFAULT NULL)
RETURNS bigint            -- ocorrência que representa a editada

agenda_evento_excluir(p_ocorrencia_id bigint, p_escopo text) RETURNS void
agenda_responder(p_ocorrencia_id bigint, p_resposta text, p_escopo text) RETURNS void
```

`p_evento` jsonb (all keys present on create; on edit the full form state is sent):

```json
{
  "titulo": "Gravação: Clínica Sorriso", "descricao": null, "local": null, "link_reuniao": null,
  "tipo": "gravacao", "cor": null, "cliente_id": 12, "privado": false, "dia_inteiro": false,
  "tz": "America/Sao_Paulo",              -- only on create; edits omit it (tz is immutable)
  "inicio_local": "2026-10-05T14:00:00",     -- parede local no tz; dia inteiro: "2026-10-05T00:00:00"
  "fim_local": "2026-10-05T16:00:00",        -- dia inteiro: dia seguinte ao último dia, 00:00 (exclusivo)
  "lembretes": [10, 1440],
  "regra": null
}
```

`regra` (`AgendaRegra`): `null` or `{"freq":"daily"|"weekly"|"monthly"|"yearly","intervalo":1,"dias_semana":[1]|null,"mensal_modo":"dia_mes"|"dia_semana"|null,"mensal_ordinal":1|2|3|4|-1|null,"ate":"2026-11-30"|null,"contagem":13|null}`.

`p_escopo`: `'esta' | 'seguintes' | 'todas'` (responder: `'esta' | 'todas'`). Error messages the UI maps: `agenda: este evento não existe mais`, `agenda: você não pode editar este evento`, `agenda: a repetição não gera nenhuma data`, `agenda: este campo vale para toda a série`, plus validation messages listed in Task 3.

---

### Task 1: Tables, composite FKs, guard, RLS without recursion, grants (migration A §1)

Spec: "Modelo de dados" (all tables except `agenda_lembretes`), "Privilégios e RLS".

**Files:**
- Create: `supabase/migrations/20261005000001_agenda_eventos.sql`
- Create: `supabase/tests/entitlements/99_agenda_rls.sql`
- Modify: `supabase/tests/entitlements/96_lockdown_definer_function_grants.sql` (add `agenda_pode_ver_evento` to the invoker-context exceptions list around lines 100-103)

**Interfaces:**
- Produces: tables `agenda_eventos`, `agenda_ocorrencias`, `agenda_participantes`, `agenda_respostas`; function `agenda_pode_ver_evento(bigint, boolean, uuid) RETURNS boolean`; trigger `agenda_eventos_guard`.

- [ ] **Step 1: Write the failing suite** `99_agenda_rls.sql` with these asserts (first block only; Task 3 extends it):
  - `has_table_privilege('authenticated', 'public.agenda_eventos', 'SELECT')` true; `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` false; same for the other three tables; `anon` has nothing.
  - As `service_role`: inserting an `agenda_ocorrencias` row whose `conta_id` differs from its parent event's `conta_id` raises `foreign_key_violation`.
  - As `service_role`: guard rejects `freq='weekly'` with `dias_semana` NULL (`check_violation`), `tz = 'Mars/Olympus'` (raise from guard), `dia_inteiro=true` with `duracao_min` set.
  - As `authenticated` member of ws A: `select count(*) from agenda_eventos` does not raise (no `42P17`) and returns the non-private event and the private event they participate in, but not a private event of someone else; `agenda_ocorrencias` of that hidden event are invisible too.
  - Member of ws B sees nothing from ws A.

Start with the parity block (copy the shape from `99_tarefa_series_rls.sql:9-22`) for the four tables:

```sql
begin;
select et_grant_hosted_parity(array['agenda_eventos','agenda_ocorrencias','agenda_participantes','agenda_respostas']);
revoke all on public.agenda_eventos, public.agenda_ocorrencias, public.agenda_participantes, public.agenda_respostas from anon, authenticated;
grant select on public.agenda_eventos, public.agenda_ocorrencias, public.agenda_participantes, public.agenda_respostas to authenticated;
grant all on public.agenda_eventos, public.agenda_ocorrencias, public.agenda_participantes, public.agenda_respostas to service_role;
```

- [ ] **Step 2: Run it** — `npx supabase db reset` (migration file does not exist yet) then psql the suite. Expected: FAIL (`relation "agenda_eventos" does not exist`).

- [ ] **Step 3: Write migration section (1)**:

```sql
-- supabase/migrations/20261005000001_agenda_eventos.sql
-- Agenda (sub-projeto 1): eventos com recorrência materializada, privado/ocupado,
-- participantes com RSVP. Spec: docs/superpowers/specs/2026-10-05-agenda-eventos-core-design.md
-- Sections: (1) tables + guard + RLS, (2) date math + materialization + generator,
-- (3) read/create RPCs + notification types, (4) edit/delete/RSVP RPCs.

-- ============ (1) TABLES ============

CREATE TABLE public.agenda_eventos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conta_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  organizador_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  titulo text NOT NULL CHECK (char_length(btrim(titulo)) BETWEEN 1 AND 200),
  descricao text NULL CHECK (descricao IS NULL OR char_length(descricao) <= 5000),
  local text NULL CHECK (local IS NULL OR char_length(local) <= 300),
  link_reuniao text NULL CHECK (link_reuniao IS NULL OR (char_length(link_reuniao) <= 500 AND link_reuniao ~* '^https?://')),
  tipo text NOT NULL DEFAULT 'reuniao' CHECK (tipo IN ('reuniao','gravacao','captacao','apresentacao','interno','outro')),
  cor text NULL CHECK (cor IS NULL OR cor IN ('azul','rosa','laranja','roxo','verde','teal','cinza','amarelo')),
  cliente_id bigint NULL,
  privado boolean NOT NULL DEFAULT false,
  dia_inteiro boolean NOT NULL DEFAULT false,
  tz text NOT NULL DEFAULT 'America/Sao_Paulo',
  dtstart timestamp NOT NULL,
  duracao_min int NULL CHECK (duracao_min IS NULL OR duracao_min BETWEEN 1 AND 20160),
  duracao_dias int NULL CHECK (duracao_dias IS NULL OR duracao_dias BETWEEN 1 AND 31),
  freq text NULL CHECK (freq IS NULL OR freq IN ('daily','weekly','monthly','yearly')),
  intervalo int NOT NULL DEFAULT 1 CHECK (intervalo BETWEEN 1 AND 99),
  dias_semana int[] NULL,
  mensal_modo text NULL CHECK (mensal_modo IS NULL OR mensal_modo IN ('dia_mes','dia_semana')),
  mensal_ordinal int NULL CHECK (mensal_ordinal IS NULL OR mensal_ordinal IN (1,2,3,4,-1)),
  ate date NULL,
  contagem int NULL CHECK (contagem IS NULL OR contagem BETWEEN 1 AND 730),
  lembretes int[] NOT NULL DEFAULT '{}',
  serie_origem_id bigint NULL REFERENCES public.agenda_eventos(id) ON DELETE SET NULL,
  horizonte_ate date NULL,
  materializacao_completa boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agenda_eventos_id_conta_uq UNIQUE (id, conta_id),
  CONSTRAINT agenda_eventos_cliente_fk FOREIGN KEY (cliente_id, conta_id)
    REFERENCES public.clientes(id, conta_id) ON DELETE SET NULL (cliente_id),
  CONSTRAINT agenda_eventos_duracao_ck CHECK (
    (dia_inteiro AND duracao_dias IS NOT NULL AND duracao_min IS NULL AND dtstart::time = '00:00')
    OR (NOT dia_inteiro AND duracao_min IS NOT NULL AND duracao_dias IS NULL)),
  CONSTRAINT agenda_eventos_regra_vazia_ck CHECK (
    freq IS NOT NULL OR (dias_semana IS NULL AND mensal_modo IS NULL AND mensal_ordinal IS NULL AND ate IS NULL AND contagem IS NULL)),
  CONSTRAINT agenda_eventos_fim_ck CHECK (NOT (ate IS NOT NULL AND contagem IS NOT NULL)),
  CONSTRAINT agenda_eventos_ate_ck CHECK (ate IS NULL OR (ate >= dtstart::date AND ate <= (dtstart::date + interval '5 years')::date)),
  CONSTRAINT agenda_eventos_weekly_ck CHECK (freq IS DISTINCT FROM 'weekly' OR (dias_semana IS NOT NULL AND cardinality(dias_semana) BETWEEN 1 AND 7)),
  CONSTRAINT agenda_eventos_monthly_ck CHECK (
    (freq = 'monthly' AND mensal_modo IS NOT NULL AND ((mensal_modo = 'dia_semana') = (mensal_ordinal IS NOT NULL)))
    OR (freq IS DISTINCT FROM 'monthly' AND mensal_modo IS NULL AND mensal_ordinal IS NULL)),
  CONSTRAINT agenda_eventos_lembretes_ck CHECK (cardinality(lembretes) <= 5)
);
```

(`clientes_id_conta_uq` already exists, migration `20260815000002`.) Then `agenda_ocorrencias`, `agenda_participantes`, `agenda_respostas` exactly as the spec tables, with composite FKs:

```sql
CREATE TABLE public.agenda_ocorrencias (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conta_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  evento_id bigint NOT NULL,
  data_original date NOT NULL,
  inicio timestamptz NOT NULL,
  fim timestamptz NOT NULL,
  horario_alterado boolean NOT NULL DEFAULT false,
  titulo text NULL CHECK (titulo IS NULL OR char_length(btrim(titulo)) BETWEEN 1 AND 200),
  descricao text NULL CHECK (descricao IS NULL OR char_length(descricao) <= 5000),
  local text NULL CHECK (local IS NULL OR char_length(local) <= 300),
  link_reuniao text NULL CHECK (link_reuniao IS NULL OR (char_length(link_reuniao) <= 500 AND link_reuniao ~* '^https?://')),
  campos_sobrescritos text[] NOT NULL DEFAULT '{}' CHECK (campos_sobrescritos <@ ARRAY['titulo','descricao','local','link_reuniao']),
  cancelada boolean NOT NULL DEFAULT false,
  CONSTRAINT agenda_ocorrencias_id_conta_uq UNIQUE (id, conta_id),
  CONSTRAINT agenda_ocorrencias_evento_fk FOREIGN KEY (evento_id, conta_id)
    REFERENCES public.agenda_eventos(id, conta_id) ON DELETE CASCADE,
  CONSTRAINT agenda_ocorrencias_data_uq UNIQUE (evento_id, data_original),
  CONSTRAINT agenda_ocorrencias_fim_ck CHECK (fim > inicio)
);
CREATE INDEX agenda_ocorrencias_conta_inicio_idx ON public.agenda_ocorrencias (conta_id, inicio, fim) WHERE NOT cancelada;
CREATE INDEX agenda_ocorrencias_evento_inicio_idx ON public.agenda_ocorrencias (evento_id, inicio) WHERE NOT cancelada;

CREATE TABLE public.agenda_participantes (
  evento_id bigint NOT NULL,
  conta_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resposta text NOT NULL DEFAULT 'pendente' CHECK (resposta IN ('pendente','sim','nao','talvez')),
  respondido_em timestamptz NULL,
  PRIMARY KEY (evento_id, user_id),
  CONSTRAINT agenda_participantes_evento_fk FOREIGN KEY (evento_id, conta_id)
    REFERENCES public.agenda_eventos(id, conta_id) ON DELETE CASCADE
);
CREATE INDEX agenda_participantes_user_idx ON public.agenda_participantes (user_id);

CREATE TABLE public.agenda_respostas (
  ocorrencia_id bigint NOT NULL,
  conta_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resposta text NOT NULL CHECK (resposta IN ('sim','nao','talvez')),
  respondido_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ocorrencia_id, user_id),
  CONSTRAINT agenda_respostas_ocorrencia_fk FOREIGN KEY (ocorrencia_id, conta_id)
    REFERENCES public.agenda_ocorrencias(id, conta_id) ON DELETE CASCADE
);
```

Guard trigger (BEFORE INSERT OR UPDATE on `agenda_eventos`, SECURITY INVOKER): validates `tz` (`BEGIN PERFORM '2000-01-01'::timestamp AT TIME ZONE NEW.tz; EXCEPTION WHEN others THEN RAISE EXCEPTION 'agenda: fuso horário inválido'; END;`), `dias_semana` values in 0..6 without duplicates, `lembretes` values in -1440..40320 without duplicates (`raise 'agenda: lembrete inválido'`), and sets `updated_at = now()` on UPDATE.

RLS (spec "Privilégios e RLS"):

```sql
CREATE OR REPLACE FUNCTION public.agenda_pode_ver_evento(p_evento_id bigint, p_privado boolean, p_organizador uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT p_privado
      OR p_organizador = auth.uid()
      OR EXISTS (SELECT 1 FROM public.agenda_participantes ap
                 WHERE ap.evento_id = p_evento_id AND ap.user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.agenda_pode_ver_evento(bigint, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_pode_ver_evento(bigint, boolean, uuid) TO authenticated, service_role;

ALTER TABLE public.agenda_eventos ENABLE ROW LEVEL SECURITY;
CREATE POLICY agenda_eventos_select ON public.agenda_eventos FOR SELECT TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id())
         AND (SELECT public.has_permission('calendario','ver'))
         AND public.agenda_pode_ver_evento(id, privado, organizador_id));
CREATE POLICY agenda_eventos_service_role_bypass ON public.agenda_eventos FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.agenda_ocorrencias ENABLE ROW LEVEL SECURITY;
CREATE POLICY agenda_ocorrencias_select ON public.agenda_ocorrencias FOR SELECT TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id())
         AND EXISTS (SELECT 1 FROM public.agenda_eventos e WHERE e.id = agenda_ocorrencias.evento_id));
-- same shape for agenda_participantes (EXISTS on agenda_eventos via evento_id)
-- agenda_respostas: EXISTS (SELECT 1 FROM public.agenda_ocorrencias o WHERE o.id = agenda_respostas.ocorrencia_id)
-- + service_role bypass policy on each
```

Grants + post-condition (`REVOKE ALL ON TABLE ... FROM PUBLIC, anon, authenticated; GRANT SELECT ... TO authenticated; GRANT ALL ... TO service_role;` for the four, and `GRANT USAGE, SELECT ON SEQUENCE` of the identity sequences to service_role), then a `DO $$` block that raises if `authenticated` has any of INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER or `anon` has any privilege on these tables (copy the shape at `20260925000030_tarefa_series.sql` right after its grants).

- [ ] **Step 4: Run** `npx supabase db reset` and the suite. Expected: `PASS 99_agenda_rls` (block 1). Also run `96_lockdown_definer_function_grants.sql` after adding the name. Expected: PASS.
- [ ] **Step 5: Commit** `feat(agenda): tables, composite FKs, guard and RLS for the agenda`.

---

### Task 2: Date math, materialization, horizon generator (migration A §2)

Spec: "Semântica da regra", "Geração de inicio/fim", "Matemática de datas", "Materialização", "Gerador diário".

**Files:**
- Modify: `supabase/migrations/20261005000001_agenda_eventos.sql` (append section 2)
- Create: `supabase/tests/entitlements/99_agenda_datas_regra.sql`
- Modify: `96_lockdown_definer_function_grants.sql` (service_role-only names)

**Interfaces:**
- Produces (pure): `agenda_hoje(p_tz text) RETURNS date`; `agenda_datas_regra(p_e agenda_eventos, p_de date, p_ate date) RETURNS SETOF date`; `agenda_normalizar_dtstart(p_e agenda_eventos) RETURNS timestamp`; `agenda_inicio_fim(p_e agenda_eventos, p_data date, OUT inicio timestamptz, OUT fim timestamptz)`.
- Produces (internal DEFINER, service_role): `agenda_materializar(p_evento_id bigint, p_ate date) RETURNS void`; `agenda_regenerar(p_evento_id bigint, p_reset_horario boolean) RETURNS void`; `agenda_gerar_horizonte() RETURNS int`.

- [ ] **Step 1: Write the failing suite** `99_agenda_datas_regra.sql`. Build event rows in memory with `ROW(...)::agenda_eventos` is awkward; instead insert real rows as service_role into a throwaway workspace and call the functions with `(SELECT e FROM agenda_eventos e WHERE id = v_id)`. Helper inside the suite:

```sql
create or replace function pg_temp.datas(p_id bigint, p_de date, p_ate date) returns date[] language sql as $$
  select array_agg(d order by d) from public.agenda_datas_regra((select e from public.agenda_eventos e where e.id = p_id), p_de, p_ate) d;
$$;
```

Cases (each `assert pg_temp.datas(...) = array[...]::date[], '<case>'`):
  1. daily, intervalo 2, dtstart 2026-10-05 09:00, `[2026-10-05, 2026-10-12]` → `{10-05,10-07,10-09,10-11}`.
  2. weekly, intervalo 2, dias {1,3} (seg, qua), dtstart 2026-12-28 (seg) → in `[2026-12-28, 2027-01-24]`: `{12-28,12-30,2027-01-11,01-13}`.
  3. monthly dia_mes, dtstart 2026-01-31 → `[2026-01-01, 2026-06-30]`: `{01-31,03-31,05-31}` (pula fevereiro, abril, junho).
  4. monthly dia_semana ordinal 2, dtstart 2026-10-13 (2ª terça) → first 3: `{2026-10-13,2026-11-10,2026-12-08}`.
  5. monthly dia_semana ordinal -1, dtstart 2026-10-30 (última sexta) → `{2026-10-30,2026-11-27,2026-12-25}`.
  6. yearly, dtstart 2028-02-29 → `[2028-01-01, 2033-12-31]`: `{2028-02-29,2032-02-29}`.
  7. `ate` 2026-10-20 on daily from 10-15 → last date 10-20.
  8. `contagem` 3 on weekly {1} from 2026-10-05, querying `[2026-10-19, 2026-12-31]` → `{2026-10-19}` (count from dtstart, not from p_de).
  9. Non-repeating event → `{dtstart::date}` when in range, empty otherwise.
  10. `agenda_normalizar_dtstart`: weekly {2} (terça) with dtstart 2026-10-05 10:00 (segunda) → `2026-10-06 10:00`; weekly with `ate` before any match raises `agenda: a repetição não gera nenhuma data`.
  11. `agenda_inicio_fim` timed: tz `America/Sao_Paulo`, 14:00, 120 min → `inicio = '2026-10-05 17:00+00'`, `fim = '2026-10-05 19:00+00'`.
  12. `agenda_inicio_fim` all-day across DST: tz `America/New_York`, data 2026-11-01 (DST ends), duracao_dias 1 → `fim - inicio = interval '25 hours'` and `(fim AT TIME ZONE 'America/New_York')::time = '00:00'`.
  13. `agenda_materializar` up to `agenda_hoje + 24 months` with `app.agenda_hoje = 2026-10-05`: weekly {1} → 105 rows (verify with `count(*)`), `horizonte_ate = 2028-10-05`, `materializacao_completa = false`; contagem 3 → 3 rows and `materializacao_completa = true`; running it twice inserts nothing new.
  14. `agenda_regenerar`: change weekly {1} to {3}, `p_reset_horario` false: Monday rows gone, Wednesday rows present, an occurrence with `horario_alterado=true` on a surviving date keeps its `inicio`, a `cancelada` row on a surviving date stays cancelled; with `p_reset_horario` true the altered row is recalculated and its flag cleared.
  15. `agenda_gerar_horizonte()` extends a series whose `horizonte_ate` is behind and skips `materializacao_completa` ones (returns number of series touched).

- [ ] **Step 2: Run** — Expected FAIL (`function agenda_datas_regra does not exist`).

- [ ] **Step 3: Implement** section 2. Core of the enumerator (keep it a single SQL-language or plpgsql function; candidates are generated from `dtstart::date` to `least(p_ate, coalesce(ate, p_ate))`, then `contagem` is applied over the full sequence from `dtstart` before cutting to `[p_de, p_ate]`):

```sql
CREATE OR REPLACE FUNCTION public.agenda_hoje(p_tz text) RETURNS date
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(NULLIF(current_setting('app.agenda_hoje', true), '')::date,
                  (now() AT TIME ZONE p_tz)::date);
$$;

CREATE OR REPLACE FUNCTION public.agenda_datas_regra(p_e public.agenda_eventos, p_de date, p_ate date)
RETURNS SETOF date LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_ini date := p_e.dtstart::date;
  v_fim date := least(p_ate, coalesce(p_e.ate, p_ate));
  v_dow int := extract(dow FROM v_ini)::int;
BEGIN
  IF p_e.freq IS NULL THEN
    IF v_ini BETWEEN p_de AND p_ate THEN RETURN NEXT v_ini; END IF;
    RETURN;
  END IF;
  -- with contagem the enumeration must start at dtstart and may need to run past p_de;
  -- cap the scan end at v_fim (or, with contagem and no ate, at dtstart + 15 years, enough for 730 yearly-with-interval-1? no: cap by count below)
  RETURN QUERY
  WITH cand AS (
    SELECT d::date AS d FROM generate_series(v_ini, CASE WHEN p_e.contagem IS NOT NULL
             THEN (v_ini + make_interval(years => least(80, p_e.intervalo * p_e.contagem + 1)))::date
             ELSE v_fim END, interval '1 day') d
  ), regra AS (
    SELECT c.d FROM cand c
    WHERE CASE p_e.freq
      WHEN 'daily' THEN (c.d - v_ini) % p_e.intervalo = 0
      WHEN 'weekly' THEN extract(dow FROM c.d)::int = ANY (p_e.dias_semana)
           AND ((date_trunc('week', c.d)::date - date_trunc('week', v_ini)::date) / 7) % p_e.intervalo = 0
      WHEN 'monthly' THEN
           ((extract(year FROM c.d)::int * 12 + extract(month FROM c.d)::int)
            - (extract(year FROM v_ini)::int * 12 + extract(month FROM v_ini)::int)) % p_e.intervalo = 0
           AND CASE p_e.mensal_modo
             WHEN 'dia_mes' THEN extract(day FROM c.d) = extract(day FROM v_ini)
             ELSE extract(dow FROM c.d)::int = v_dow AND (
               (p_e.mensal_ordinal > 0 AND (extract(day FROM c.d)::int - 1) / 7 + 1 = p_e.mensal_ordinal)
               OR (p_e.mensal_ordinal = -1 AND (c.d + 7) > (date_trunc('month', c.d) + interval '1 month')::date - 1))
           END
      WHEN 'yearly' THEN (extract(year FROM c.d)::int - extract(year FROM v_ini)::int) % p_e.intervalo = 0
           AND extract(month FROM c.d) = extract(month FROM v_ini)
           AND extract(day FROM c.d) = extract(day FROM v_ini)
    END
  ), numeradas AS (
    SELECT r.d, row_number() OVER (ORDER BY r.d) AS n FROM regra r
  )
  SELECT n.d FROM numeradas n
  WHERE (p_e.contagem IS NULL OR n.n <= p_e.contagem)
    AND n.d BETWEEN p_de AND v_fim
  ORDER BY n.d;
END $$;
```

The `cand` upper bound with `contagem` must be large enough for `contagem` matches and is cut by `v_fim`: replace the `years => ...` expression with a frequency-aware bound (`daily`: `intervalo*contagem` days; `weekly`: `intervalo*contagem` weeks; `monthly`: `intervalo*contagem*2` months to absorb skipped months; `yearly`: `intervalo*contagem*4` years to absorb 29/02) and also `least(...)` it with `p_ate` when `p_ate` is earlier. Test 8 and 6 pin this. A day-by-day scan over 24 months is ~730 rows per call, acceptable; do not optimise further.

`agenda_normalizar_dtstart`: `SELECT d FROM agenda_datas_regra(p_e with contagem := NULL, p_e.dtstart::date, coalesce(p_e.ate, p_e.dtstart::date + 5 years)) LIMIT 1` + `p_e.dtstart::time`; raise when none. (Build the modified row with `p_e.contagem := NULL;` inside plpgsql.)

`agenda_inicio_fim`:

```sql
CREATE OR REPLACE FUNCTION public.agenda_inicio_fim(p_e public.agenda_eventos, p_data date, OUT inicio timestamptz, OUT fim timestamptz)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF p_e.dia_inteiro THEN
    inicio := (p_data::timestamp) AT TIME ZONE p_e.tz;
    fim := ((p_data + p_e.duracao_dias)::timestamp) AT TIME ZONE p_e.tz;
  ELSE
    inicio := (p_data + p_e.dtstart::time) AT TIME ZONE p_e.tz;
    fim := inicio + make_interval(mins => p_e.duracao_min);
  END IF;
END $$;
```

`agenda_materializar`, `agenda_regenerar`, `agenda_gerar_horizonte` per spec "Materialização" / "Gerador diário" (DEFINER, service_role only). `agenda_materializar` computes `v_ate := least(p_ate, agenda_hoje(tz) + interval '24 months')`, inserts with `ON CONFLICT (evento_id, data_original) DO NOTHING`, sets `horizonte_ate := v_ate`, and sets `materializacao_completa := (freq IS NULL OR (ate IS NOT NULL AND ate <= v_ate) OR (contagem IS NOT NULL AND (SELECT count(*) FROM agenda_datas_regra(e, dtstart::date, v_ate)) >= contagem))`. Append the cron:

```sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agenda-horizonte') THEN PERFORM cron.unschedule('agenda-horizonte'); END IF;
END $$;
SELECT cron.schedule('agenda-horizonte', '23 4 * * *', $$SELECT public.agenda_gerar_horizonte()$$);
```

(Confirm minute 23 of hour 4 is unused: `grep -n "'23 4" supabase/migrations/*.sql`.)

- [ ] **Step 4: Run** reset + suite + suite 96. Expected PASS.
- [ ] **Step 5: Commit** `feat(agenda): recurrence date math, materialization and horizon generator`.

---

### Task 3: `agenda_listar`, `agenda_evento_criar`, notification types and digest claim (migration A §3)

Spec: "RPCs de cliente" (`agenda_listar`, `agenda_evento_criar`), "Como o payload vira dtstart" (create path), "Notificações: tipos novos" items 1-4.

**Files:**
- Modify: migration A (append section 3); `99_agenda_rls.sql` (block 2: masking); create `99_agenda_edicao.sql` (block 1: create); suite 96.

**Interfaces:**
- Consumes: Task 2 functions.
- Produces: `agenda_listar`, `agenda_evento_criar` (contracts above); internal `agenda_validar_payload(p_conta uuid, p_evento jsonb) RETURNS public.agenda_eventos` (builds an unsaved row from jsonb, raising pt-BR messages); internal `agenda_notificar(p_conta uuid, p_evento_id bigint, p_ocorrencia_id bigint, p_tipo text, p_destinatarios uuid[], p_ator uuid, p_extra jsonb) RETURNS void`; notification types `event_invited`, `event_updated`, `event_cancelled`, `event_rsvp`, `event_reminder` accepted by the three CHECKs; `claim_notification_emails` claiming the first three.

- [ ] **Step 1: Write failing tests.**
  - `99_agenda_edicao.sql` block 1 (as `authenticated` owner of ws A, with two more members B1, B2 and one user of ws B):
    - `agenda_evento_criar` weekly {2} with `inicio_local` on a Monday returns `dtstart` normalized to Tuesday; occurrences exist; participants = organizer (`sim`) + B1, B2 (`pendente`); `notifications` has one `event_invited` row each for B1 and B2 and none for the organizer, `link = '/calendario?evento=' || ocorrencia_id`.
    - Participant from ws B → raises `agenda: participante fora do workspace`.
    - `cliente_id` of ws B → raises `agenda: cliente não encontrado`.
    - Agent with a custom role lacking `calendario: editar` → raises `agenda: você não pode criar eventos`.
    - Validation messages: empty title → `agenda: informe um título`; `fim_local <= inicio_local` → `agenda: o fim precisa ser depois do início`; > 50 participants → `agenda: no máximo 50 participantes`; invalid link → `agenda: link da reunião inválido`.
  - `99_agenda_rls.sql` block 2: as a non-involved member, `agenda_listar` over the week returns the private event with `titulo = 'Ocupado'`, `mascarado = true`, `descricao IS NULL`, `local IS NULL`, `regra IS NULL`, `participantes` containing every participant `user_id` with `resposta` null; involved members see real data; `pode_editar` true for organizer and owner/admin (non-private), false for a plain agent non-organizer and for admin on a private event; `p_ate - p_de > 100 days` raises; `p_ocorrencia_id` of another workspace returns 0 rows; a participant removed from `workspace_members` is absent from `participantes`.
  - `notifications` CHECKs accept the five types (insert as service_role); `claim_notification_emails` claims an `event_invited` row older than 10 min and never an `event_reminder` row.

- [ ] **Step 2: Run** — Expected FAIL.

- [ ] **Step 3: Implement.**
  - Notification CHECKs: copy the exact 22-value list from `supabase/migrations/20260815000004_instagram_automation_rpcs.sql:188-203` into `ALTER TABLE notifications DROP CONSTRAINT notifications_type_check, ADD CONSTRAINT notifications_type_check CHECK (type IN (<22>, 'event_invited','event_updated','event_cancelled','event_rsvp','event_reminder'));`. Same for `notification_inapp_prefs_type_check` (22 + 5 + `'__all__'`, from `20260903000001:18-26`) and `notification_email_prefs_type_check` (9 + `event_invited`,`event_updated`,`event_cancelled`,`event_reminder` + `'__all__'`, from `20260903000001:49-56`).
  - `claim_notification_emails`: `CREATE OR REPLACE` copying the body at `20260903000001:58-100` verbatim, only extending the type array with `'event_invited','event_updated','event_cancelled'`; keep its REVOKE/GRANT lines.
  - `agenda_notificar`: filters `p_destinatarios` to `workspace_members` of `p_conta`, then `PERFORM insert_notification_batch(p_conta, v_filtrados, p_tipo, v_link, v_metadata, p_ator);` with `v_link := CASE WHEN p_tipo = 'event_cancelled' THEN '/calendario?data=' || to_char(v_data_local,'YYYY-MM-DD') ELSE '/calendario?evento=' || p_ocorrencia_id END` and metadata per spec (`evento_id, ocorrencia_id, titulo, inicio, fim, dia_inteiro, data_local, recorrente, escopo, ator_nome` merged with `p_extra`). `ator_nome` from `profiles.nome` of `p_ator`.
  - `agenda_validar_payload`: reads every key from `p_evento`, converts `inicio_local`/`fim_local` to `dtstart`/`duracao_min`/`duracao_dias` (all-day: `duracao_dias := fim_local::date - inicio_local::date`), copies `regra` keys, validates per the messages above plus `agenda: fuso horário inválido`, `agenda: lembrete inválido`, and returns the row (`conta_id := p_conta`). Check `cliente_id` with `EXISTS (SELECT 1 FROM clientes WHERE id = ... AND conta_id = p_conta)`.
  - `agenda_evento_criar`: preamble; `IF NOT has_permission('calendario','editar') THEN RAISE 'agenda: você não pode criar eventos'`; `v_e := agenda_validar_payload(...)`; `v_e.dtstart := agenda_normalizar_dtstart(v_e)`; INSERT … RETURNING; participants (`array(SELECT DISTINCT unnest(p_participantes))` minus organizer, each validated against `workspace_members WHERE workspace_id = v_conta`, max 50); `PERFORM agenda_materializar(id, agenda_hoje(tz) + 24 months)`; first occurrence = `min(data_original)`; `agenda_notificar(..., 'event_invited', participants_without_organizer, v_user, '{}')`; return.
  - `agenda_listar` per spec, as one SQL query with LEFT JOINs (`clientes`, `agenda_participantes` of the viewer, `agenda_respostas` of the viewer) and a lateral jsonb aggregate of participants joined to `workspace_members` of `v_conta`. Masking via `CASE WHEN v_mascarado THEN ... END` per column, where `v_mascarado := e.privado AND e.organizador_id IS DISTINCT FROM v_user AND NOT EXISTS (participant v_user)`. `regra` jsonb built with `jsonb_build_object('freq', e.freq, 'intervalo', e.intervalo, 'dias_semana', e.dias_semana, 'mensal_modo', e.mensal_modo, 'mensal_ordinal', e.mensal_ordinal, 'ate', e.ate, 'contagem', e.contagem)` when `freq IS NOT NULL` and not masked. `data_inicio_local := (o.inicio AT TIME ZONE e.tz)::date`, `data_fim_local := (o.fim AT TIME ZONE e.tz)::date` for all-day, and for timed events `data_fim_local := ((o.fim AT TIME ZONE e.tz) - interval '1 microsecond')::date + 1`. Range filter `o.inicio < p_ate AND o.fim > p_de AND o.inicio >= p_de - interval '31 days'`.
  - Grants per Global Constraints; add names to suite 96.

- [ ] **Step 4: Run** reset + the three suites + 96. Expected PASS. Also `psql -c "explain analyze select * from agenda_listar(now(), now() + interval '7 days')"` as an owner with ~500 seeded occurrences: plan uses `agenda_ocorrencias_conta_inicio_idx`.
- [ ] **Step 5: Commit** `feat(agenda): list and create RPCs with masking and notification types`.

---

### Task 4: `agenda_evento_editar`, `agenda_evento_excluir`, `agenda_responder` (migration A §4)

Spec: "Como o payload vira dtstart", the three RPC paragraphs, "Ordem de travas".

**Files:**
- Modify: migration A (section 4); `99_agenda_edicao.sql` (blocks 2-5); suite 96.

**Interfaces:**
- Consumes: Tasks 2-3 (`agenda_validar_payload`, `agenda_notificar`, `agenda_regenerar`, `agenda_materializar`, `agenda_normalizar_dtstart`, `agenda_datas_regra`).
- Produces: the three RPCs (contracts above) and internal `agenda_pode_editar(p_e agenda_eventos, p_user uuid, p_conta uuid) RETURNS boolean` (same rule as `agenda_listar.pode_editar`; refactor `agenda_listar` to call it).

- [ ] **Step 1: Write failing tests** in `99_agenda_edicao.sql` (pin `app.agenda_hoje = 2026-10-05`; weekly Monday 09:00 series from 2026-10-05, 2 participants):
  - **esta**: edit occurrence 2026-10-19 title + move to Tuesday 10:00 → only that row has `titulo` in `campos_sobrescritos`, `horario_alterado`, `data_original` still 10-19; sending a different `tipo` with `esta` raises `agenda: este campo vale para toda a série`; participants get one `event_updated` each, not the actor.
  - **todas with date delta**: from occurrence 2026-10-12, payload moves to Wednesday 2026-10-14 11:00 with regra `dias_semana {3}` → series `dtstart = 2026-10-07 11:00`; Monday rows gone except none (all dates move), the earlier `esta` override on 10-19 is gone only if 10-19 left the set (it did: 10-19 is Monday) — assert it was deleted; a content-only `esta` override on a surviving date (create one on 10-21 first) keeps its title.
  - **esta clearing inherited content**: series has `local` 'Estúdio'; `esta` with `local: null` → `campos_sobrescritos` contains `local`, `agenda_listar.local` is NULL for that occurrence only; sending the series value back removes `local` from the list.
  - **todas changing dia_inteiro** → every row recalculated and `horario_alterado` cleared.
  - **tz immutable**: `todas` payload with a different `tz` leaves `agenda_eventos.tz` unchanged.
  - **old dtstart**: create with `inicio_local` 400 days ago → `agenda: a data de início é antiga demais`.
  - **seguintes**: on a `contagem = 10` series, split at the 4th occurrence with a new time → old series `ate` = cut - 1, `contagem` NULL, 3 live rows; new series `contagem = 7`, `serie_origem_id` = old; a per-occurrence RSVP on the 6th occurrence survives on the re-parented row and its `inicio` moved to the new time; an earlier `esta` date move on the cut occurrence (moved to Wednesday) does not turn the rule's weekday: the new series' `dtstart` date is `data_original + delta` of this edit only.
  - **seguintes contagem**: payload regra identical to stored → derived `contagem`; payload with `contagem` changed (or any rule key changed) → payload value used.
  - **seguintes removing a participant**: B2 left out of `p_participantes` → B2's `agenda_respostas` on re-parented rows deleted, B2 gets `event_cancelled` with `motivo = 'removido'`.
  - **seguintes** at the first live occurrence behaves as **todas** (series id unchanged).
  - **excluir**: `esta` → `cancelada`; regeneration with `todas` keeps it cancelled; `seguintes` → `ate` set and rows from cut deleted; `todas` → series gone; deleting the last live occurrence with `esta` deletes the series; each sends `event_cancelled` to participants except the actor, before deletion (rows exist with `metadata->>'titulo'`).
  - **responder**: participant `esta` → row in `agenda_respostas`, `agenda_listar.minha_resposta` reflects it only on that occurrence; `todas` → `agenda_participantes.resposta` updated and future per-occurrence answers removed (past ones stay); organizer calling it raises `agenda: o organizador não responde ao próprio evento`; organizer gets one `event_rsvp`.
  - **permissions**: plain agent non-organizer edit → `agenda: você não pode editar este evento`; admin on non-private → ok; admin on private → raises; nonexistent/cancelled occurrence → `agenda: este evento não existe mais`.
  - **participants change under todas**: removing B2 sends B2 `event_cancelled` with `metadata->>'motivo' = 'removido'`; adding B3 sends `event_invited`.

- [ ] **Step 2: Run** — Expected FAIL.

- [ ] **Step 3: Implement** following the spec paragraphs literally. Shared opening of `agenda_evento_editar` and `agenda_evento_excluir`:

```sql
SELECT o.* INTO v_o FROM agenda_ocorrencias o
 WHERE o.id = p_ocorrencia_id AND o.conta_id = v_conta AND NOT o.cancelada;
IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;
SELECT e.* INTO v_e FROM agenda_eventos e WHERE e.id = v_o.evento_id AND e.conta_id = v_conta FOR UPDATE;
IF NOT agenda_pode_editar(v_e, v_user, v_conta) THEN RAISE EXCEPTION 'agenda: você não pode editar este evento'; END IF;
-- re-read the occurrence after the series lock (it may have been deleted meanwhile)
SELECT o.* INTO v_o FROM agenda_ocorrencias o WHERE o.id = p_ocorrencia_id AND NOT o.cancelada;
IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;
v_primeira := NOT EXISTS (SELECT 1 FROM agenda_ocorrencias WHERE evento_id = v_e.id AND NOT cancelada AND data_original < v_o.data_original);
IF v_e.freq IS NULL OR (p_escopo = 'seguintes' AND v_primeira) THEN v_escopo := 'todas'; ELSE v_escopo := p_escopo; END IF;
```

Delta (spec "Como o payload vira dtstart"):

```sql
v_novo := agenda_validar_payload(v_conta, p_evento);           -- dtstart here = payload start (parede local)
v_delta := v_novo.dtstart::date - (v_o.inicio AT TIME ZONE v_e.tz)::date;
-- todas:     v_novo.dtstart := (v_e.dtstart::date + v_delta) + v_novo.dtstart::time;
-- seguintes: v_novo.dtstart := (v_o.data_original + v_delta) + v_novo.dtstart::time;
v_novo.dtstart := agenda_normalizar_dtstart(v_novo);
```

(For all-day the `::time` is `00:00`.) `agenda_responder` locks `SELECT ... FROM agenda_eventos ... FOR SHARE` before writing. "Changed fields that notify" = title, `inicio`/`fim`, rule columns, `local`, `link_reuniao`, `dia_inteiro`; compare old vs new values with `IS DISTINCT FROM`.

- [ ] **Step 4: Run** reset + all `99_agenda_*` + 96. Expected PASS.
- [ ] **Step 5: Commit** `feat(agenda): edit, delete and RSVP RPCs with this/following/all scopes`.

---

### Task 5: Reminders: ledger, per-minute tick, e-mail claim, cron, rollback runbook (migration B)

Spec: "agenda_lembretes (ledger)", "Lembretes (migration B)", "Rollout" rollback.

**Files:**
- Create: `supabase/migrations/20261005000002_agenda_lembretes.sql`, `supabase/tests/entitlements/99_agenda_lembretes.sql`, `docs/superpowers/specs/assets/2026-10-05-agenda-rollback.sql`
- Modify: suite 96; `agenda_gerar_horizonte` (via `CREATE OR REPLACE` in migration B) to also delete ledger rows older than 30 days.

**Interfaces:**
- Produces: table `agenda_lembretes`; internal `agenda_tick_lembretes(p_now timestamptz DEFAULT now(), p_chamar_email boolean DEFAULT true) RETURNS int` (claims created); internal `agenda_claim_emails_lembrete(p_limit int DEFAULT 100) RETURNS TABLE (ocorrencia_id bigint, user_id uuid, minutos int, inicio_alvo timestamptz, notification_id uuid, titulo text, inicio timestamptz, fim timestamptz, dia_inteiro boolean, local text, link_reuniao text, tz text, tentativas int)`; internal `agenda_marcar_email_lembrete(p_ocorrencia_id bigint, p_user_id uuid, p_minutos int, p_inicio_alvo timestamptz, p_ok boolean) RETURNS void`; pg_cron job `agenda-lembretes`.
- Consumed by Task 6: the two RPCs above (names, args, columns exactly as listed).

- [ ] **Step 1: Write failing suite** `99_agenda_lembretes.sql` (call the tick with `p_chamar_email => false` so no `net.http_post` fires locally):
  - Event today 14:00 with `lembretes {10}`, two participants: tick at 13:49 → 0 claims; at 13:50 → 2 claims, 2 `event_reminder` notifications with `emailed_at` NOT NULL, ledger `email_status = 'pendente'`; tick again at 13:51 → 0.
  - Tick at 14:06 for a reminder due at 13:50 (16 min late) → 0 claims.
  - Negative minutes: all-day event with `lembretes {-540}` (no dia às 9h, tz São Paulo) fires at 09:00 local.
  - Participant with effective `nao` (series-level or per-occurrence) → no claim. Ex-member (row removed from `workspace_members`) → no claim.
  - `notification_email_prefs (user, 'event_reminder', false)` → claim with `email_status = 'nao'`; `('__all__', false)` → same.
  - Move the occurrence to 15:00 (direct UPDATE as service_role) and tick at 14:50 → new claim (different `inicio_alvo`).
  - Cancelled occurrence → no claim.
  - `agenda_claim_emails_lembrete(10)` returns the pending rows and sets `enviando` + lease; a second call returns nothing; after `UPDATE ... SET email_lease_ate = now() - interval '1 second'` it returns them again; `agenda_marcar_email_lembrete(..., true)` → `enviado`; `false` with `email_tentativas = 3` → `falhou`, with fewer → `pendente`.
  - Privileges: `authenticated` has no privilege on `agenda_lembretes`; the three functions are service_role-only (suite 96).

- [ ] **Step 2: Run** — Expected FAIL.

- [ ] **Step 3: Implement** migration B per spec. Tick query skeleton:

```sql
WITH cand AS (
  SELECT o.id AS ocorrencia_id, o.conta_id, o.inicio, o.fim, e.id AS evento_id, e.tz, m AS minutos
  FROM public.agenda_eventos e
  CROSS JOIN LATERAL unnest(e.lembretes) AS m
  JOIN LATERAL (
    SELECT o.* FROM public.agenda_ocorrencias o
    WHERE o.evento_id = e.id AND NOT o.cancelada
      AND o.inicio >  p_now - interval '15 minutes' + make_interval(mins => m)
      AND o.inicio <= p_now + make_interval(mins => m)
    FOR KEY SHARE SKIP LOCKED
  ) o ON true
  WHERE cardinality(e.lembretes) > 0
), dest AS (
  SELECT c.*, ap.user_id FROM cand c
  JOIN public.agenda_participantes ap ON ap.evento_id = c.evento_id
  JOIN public.workspace_members wm ON wm.workspace_id = c.conta_id AND wm.user_id = ap.user_id
  LEFT JOIN public.agenda_respostas ar ON ar.ocorrencia_id = c.ocorrencia_id AND ar.user_id = ap.user_id
  WHERE coalesce(ar.resposta, ap.resposta) <> 'nao'
), ins AS (
  INSERT INTO public.agenda_lembretes (ocorrencia_id, conta_id, user_id, minutos, inicio_alvo, email_status)
  SELECT d.ocorrencia_id, d.conta_id, d.user_id, d.minutos, d.inicio,
         CASE WHEN EXISTS (SELECT 1 FROM public.notification_email_prefs p
                           WHERE p.user_id = d.user_id AND p.enabled = false AND p.type IN ('event_reminder','__all__'))
              THEN 'nao' ELSE 'pendente' END
  FROM dest d
  ON CONFLICT DO NOTHING
  RETURNING *
)
SELECT ... FROM ins;   -- then loop: INSERT INTO notifications ... RETURNING id; UPDATE agenda_lembretes SET notification_id
```

(`FOR KEY SHARE SKIP LOCKED` is not allowed inside a lateral subquery that also aggregates; if Postgres rejects the placement, materialize candidates first with `SELECT ... FOR KEY SHARE OF o SKIP LOCKED` into a temp array in plpgsql, then run the rest.) Add the partial index `CREATE INDEX agenda_eventos_com_lembretes_idx ON agenda_eventos (id) WHERE cardinality(lembretes) > 0;`. Notification row: `type 'event_reminder'`, `link '/calendario?evento=' || ocorrencia_id`, metadata `{evento_id, ocorrencia_id, titulo (efetivo), inicio, fim, dia_inteiro, minutos}`, `emailed_at = now()` (all reminder rows, so the digest never touches them). At the end, when `p_chamar_email` and `EXISTS (SELECT 1 FROM agenda_lembretes WHERE email_status IN ('pendente') OR (email_status='enviando' AND email_lease_ate < now()))`, `PERFORM net.http_post(url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='project_url') || '/functions/v1/agenda-lembretes-email', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='cron_secret')), body := '{}'::jsonb);` (shape of `20260813000006`).

Schedule at the end of migration B (unschedule-if-exists block, then `SELECT cron.schedule('agenda-lembretes', '* * * * *', $$SELECT public.agenda_tick_lembretes()$$);`).

Rollback runbook file: the SQL from spec "Rollout → Rollback". It must **read the current schema**, not paste historical lists: a `DO $$` block that, for each of `notifications_type_check`, `notification_inapp_prefs_type_check`, `notification_email_prefs_type_check`, takes `pg_get_constraintdef(oid)`, removes the five `'event_*'` literals (raise if any expected literal is missing), and re-adds the constraint from the edited text; and for `claim_notification_emails` takes `pg_get_functiondef(<its regprocedure>)` (confirm the signature with `\df claim_notification_emails`), removes the three literals and `EXECUTE`s it. Header comment "Não aplicar por migration. Rodar à mão só depois de reverter o PR do frontend." Add a check in `99_agenda_lembretes.sql` that runs the block inside the suite's transaction and asserts the constraints no longer accept `event_invited` while still accepting `task_assigned`.

- [ ] **Step 4: Run** reset + all suites (`bash scripts/test-entitlements.sh`). Expected all PASS.
- [ ] **Step 5: Commit** `feat(agenda): reminder ledger, per-minute tick and e-mail claim`.

---

### Task 6: Digest entries + `agenda-lembretes-email` edge function

Spec: "Notificações: tipos novos" item 5, "Edge function agenda-lembretes-email".

**Files:**
- Modify: `supabase/functions/_shared/notification-email.ts` (`resolveDigestItem` switch, lines ~27-56)
- Create: `supabase/functions/_shared/agenda-email.ts`, `supabase/functions/agenda-lembretes-email/handler.ts`, `supabase/functions/agenda-lembretes-email/index.ts`
- Modify: `supabase/config.toml` (add `[functions.agenda-lembretes-email]` + `verify_jwt = false` next to the other crons)
- Test: `supabase/functions/__tests__/notification-email_test.ts`, `agenda-email_test.ts`, `agenda-lembretes-email_test.ts`, `cron-auth_test.ts`

**Interfaces:**
- Consumes: Task 5 RPC names/columns (contract in Task 5 "Interfaces").
- Produces: `buildLembreteEmail(p: { titulo: string; inicio: string; fim: string; diaInteiro: boolean; local: string | null; linkReuniao: string | null; tz: string; minutos: number; abrirUrl: string; appBaseUrl: string }): { subject: string; html: string }`; `runAgendaLembretesEmail(deps: { db: Db; sendEmail: typeof sendViaResend; appBaseUrl: string; now: () => number; deadlineMs?: number }): Promise<{ enviados: number; falhas: number }>`; `createAgendaLembretesEmailHandler({ cronSecret, timingSafeEqual, run })`.

- [ ] **Step 1: Write failing tests.**
  - `notification-email_test.ts`: `resolveDigestItem('event_invited', {titulo:'Gravação <b>', inicio:'2026-10-05T17:00:00Z', ator_nome:'Bruno', recorrente:true})` returns heading `Bruno convidou você para um evento` and body containing `Gravação &lt;b&gt;` after `buildDigestHtml`; `event_updated` heading `Evento alterado: {titulo}`; `event_cancelled` heading `Evento cancelado: {titulo}`.
  - `agenda-email_test.ts`: subject `Em 10 minutos: {titulo}` (`minutos` 10), `Em 1 hora: ...` (60), `Amanhã: ...` (1440), `Hoje: ...` for all-day negative minutes, `Começando agora: ...` (0); subject passes through `sanitizeSubjectValue`; time formatted in `tz` (`America/Sao_Paulo` 17:00Z → `14:00`); HTML escapes `<script>` in title and local; `linkReuniao` `javascript:alert(1)` is not rendered as a link (only `https?://` becomes an `<a>`).
  - `agenda-lembretes-email_test.ts` with a fake `db` (`rpc(name,args)` recorder): claim returns 2 rows → `sendEmail` called twice with idempotency keys `agenda-lembrete:{ocorrencia_id}:{user_id}:{minutos}:{epochSeconds(inicio_alvo)}` and `from = 'Mesaas <notificacoes@mesaas.com.br>'`; one send throws → `agenda_marcar_email_lembrete` called with `p_ok=false` for it and `true` for the other; deadline exceeded (inject `now`) → remaining rows not sent and not marked; user without e-mail (`auth.admin.getUserById` returns no email) → marked `p_ok=false`.
  - `cron-auth_test.ts`: add the 401 case for `createAgendaLembretesEmailHandler`.
- [ ] **Step 2: Run** `deno test --no-check supabase/functions/__tests__/agenda-email_test.ts supabase/functions/__tests__/agenda-lembretes-email_test.ts supabase/functions/__tests__/notification-email_test.ts supabase/functions/__tests__/cron-auth_test.ts`. Expected FAIL.
- [ ] **Step 3: Implement.** Mirror `supabase/functions/notification-email-cron/{handler,index}.ts` (secret check with `timingSafeEqual` first, `reportCronFailure(svc, 'agenda-lembretes-email', detail)` on RPC failure, 500 `{error:"Internal server error"}`). Use `sendViaResend` and `layout()` from `_shared/lifecycle-emails.ts`, `escapeHtml` from `_shared/report-template/escape.ts`, `appBaseUrl()` from `_shared/app-url.ts`. Date/time formatting with `Intl.DateTimeFormat('pt-BR', { timeZone: tz, ... })`. Email copy (final): heading `Seu evento começa em {N minutos | 1 hora | ...}` (all-day: `Lembrete: {titulo} é hoje` / `é amanhã`), card with title, `Segunda, 5 de outubro · 14:00 a 16:00`, local, link "Entrar na reunião" when `https?://`, CTA "Abrir na agenda" → `${appBaseUrl}/calendario?evento={ocorrencia_id}`, footer "Você recebe este lembrete porque participa deste evento. Para desligar, vá em Configurações, Notificações."
- [ ] **Step 4: Run** the four tests + `npm run check:functions`. Expected PASS.
- [ ] **Step 5: Commit** `feat(agenda): digest entries and reminder e-mail edge function`.

---

### Task 7: CRM notification types, catalog and display

Spec: "Notificações: tipos novos" items 6-9.

**Files:**
- Modify: `apps/crm/src/store/notifications.ts:3-25`, `apps/crm/src/lib/notification-catalog.ts`, `apps/crm/src/lib/notification-config.ts`
- Test: `apps/crm/src/__tests__/notification-catalog.test.ts`, `apps/crm/src/__tests__/notification-config.test.ts`; fix the stale "22" comment in `apps/crm/src/pages/configuracao/tabs/notificacoes/SuasNotificacoesSection.tsx:38`.

**Interfaces:**
- Produces: `NotificationType` includes `'event_invited' | 'event_updated' | 'event_cancelled' | 'event_rsvp' | 'event_reminder'`; catalog category `'agenda'` labelled `Agenda`.

- [ ] **Step 1: Failing tests**: catalog length 27, email-eligible 13, the five types in category `agenda`, `event_rsvp` not email-eligible; labels/when (final copy): `event_invited` label `Convites para eventos`, when `Quando alguém adiciona você a um evento`; `event_updated` `Eventos alterados` / `Quando muda o horário, o local ou a repetição de um evento seu`; `event_cancelled` `Eventos cancelados` / `Quando um evento seu é cancelado ou você é removido dele`; `event_rsvp` `Respostas aos seus convites` / `Quando um participante responde a um evento que você organizou`; `event_reminder` `Lembretes de eventos` / `No horário dos lembretes que você definiu`. Recipients: `Participantes do evento` (rsvp: `Organizador do evento`). `getNotificationDisplay`: `event_invited` → icon `CalendarPlus`, title `{ator_nome} convidou você` (fallback `Novo convite`), body `{titulo} · {data formatada}`; `event_updated` → `CalendarClock`, `Evento alterado: {titulo}`; `event_cancelled` → `CalendarX`, `Evento cancelado: {titulo}` (motivo `removido`: `Você foi removido de {titulo}`); `event_rsvp` → `CalendarCheck`, `{ator_nome} respondeu: {Sim|Não|Talvez}` from `metadata.resposta`; `event_reminder` → `AlarmClock`, `{Em 10 minutos|Agora|Hoje|Amanhã}: {titulo}`. No em-dash anywhere (the catalog test already scans for it).
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/__tests__/notification-catalog.test.ts apps/crm/src/__tests__/notification-config.test.ts`. Expected FAIL.
- [ ] **Step 3: Implement** (the `satisfies Record<NotificationType, ...>` will force all five entries).
- [ ] **Step 4: Run** the tests + `npx vitest run apps/crm/src/pages/configuracao` + `npx tsc -p apps/crm/tsconfig.json --noEmit`. Expected PASS.
- [ ] **Step 5: Commit** `feat(agenda): notification catalog and display for agenda events`.

---

### Task 8: Store `agenda.ts` + pure `agendaLogic.ts`

Spec: "Store", `agendaLogic.ts` bullet, "Como o payload vira dtstart" (client side), "Dia inteiro" mapping.

**Files:**
- Create: `apps/crm/src/store/agenda.ts`, `apps/crm/src/store/__tests__/agenda.test.ts`, `apps/crm/src/pages/calendario/agenda/agendaLogic.ts`, `apps/crm/src/pages/calendario/agenda/__tests__/agendaLogic.test.ts`
- Modify: `apps/crm/src/store/index.ts` (add `export * from './agenda';`)

**Interfaces (produced, used by Tasks 9-11):**

```ts
// store/agenda.ts
export type AgendaTipo = 'reuniao' | 'gravacao' | 'captacao' | 'apresentacao' | 'interno' | 'outro';
export type AgendaCor = 'azul' | 'rosa' | 'laranja' | 'roxo' | 'verde' | 'teal' | 'cinza' | 'amarelo';
export type AgendaResposta = 'pendente' | 'sim' | 'nao' | 'talvez';
export type AgendaEscopo = 'esta' | 'seguintes' | 'todas';
export interface AgendaRegra {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  intervalo: number;
  dias_semana: number[] | null;
  mensal_modo: 'dia_mes' | 'dia_semana' | null;
  mensal_ordinal: 1 | 2 | 3 | 4 | -1 | null;
  ate: string | null;       // yyyy-mm-dd
  contagem: number | null;
}
export interface AgendaParticipante { user_id: string; resposta: AgendaResposta | null }
export interface AgendaOcorrencia {
  ocorrencia_id: number; evento_id: number; data_original: string;
  inicio: string; fim: string; dia_inteiro: boolean;
  data_inicio_local: string; data_fim_local: string;
  titulo: string; descricao: string | null; local: string | null; link_reuniao: string | null;
  tipo: AgendaTipo | null; cor: AgendaCor | null; cliente_id: number | null; cliente_nome: string | null;
  privado: boolean; mascarado: boolean; recorrente: boolean; regra: AgendaRegra | null;
  organizador_id: string | null; participantes: AgendaParticipante[];
  minha_resposta: AgendaResposta | null; pode_editar: boolean; pode_responder: boolean; tz: string;
}
export interface AgendaEventoPayload {
  titulo: string; descricao: string | null; local: string | null; link_reuniao: string | null;
  tipo: AgendaTipo; cor: AgendaCor | null; cliente_id: number | null; privado: boolean; dia_inteiro: boolean;
  tz: string; inicio_local: string; fim_local: string; lembretes: number[]; regra: AgendaRegra | null;
}
export async function listAgenda(de: Date, ate: Date): Promise<AgendaOcorrencia[]>;
export async function getAgendaOcorrencia(id: number): Promise<AgendaOcorrencia | null>;
export async function criarEvento(p: AgendaEventoPayload, participantes: string[]): Promise<{ evento_id: number; ocorrencia_id: number; dtstart: string }>;
export async function editarEvento(ocorrenciaId: number, escopo: AgendaEscopo, p: AgendaEventoPayload, participantes: string[] | null): Promise<number>;
export async function excluirEvento(ocorrenciaId: number, escopo: AgendaEscopo): Promise<void>;
export async function responderEvento(ocorrenciaId: number, resposta: Exclude<AgendaResposta, 'pendente'>, escopo: 'esta' | 'todas'): Promise<void>;
export function formatAgendaError(err: unknown): string; // 'agenda: X' -> 'X' (first letter upper); else 'Não foi possível salvar o evento. Tente novamente.'
export const AGENDA_QUERY_KEY = 'agenda-ocorrencias';
```

```ts
// agendaLogic.ts (pure; date-fns + ptBR locale)
export const TIPO_LABEL: Record<AgendaTipo, string>;          // Reunião, Gravação, Captação, Apresentação, Interno, Outro
export const TIPO_COR: Record<AgendaTipo, string>;            // '#3b82f6','#e1306c','#f59e0b','#8b5cf6','#64748b','#14b8a6'
export const COR_HEX: Record<AgendaCor, string>;
export function corDoEvento(o: Pick<AgendaOcorrencia, 'cor' | 'tipo' | 'mascarado'>): string;
export type RepetirOpcaoId = 'nao' | 'diario' | 'semanal' | 'mensal_dia' | 'mensal_ordinal' | 'mensal_ultima' | 'anual' | 'dias_uteis' | 'personalizado';
export interface RepetirOpcao { id: RepetirOpcaoId; label: string; regra: AgendaRegra | null }
export function opcoesRepetir(inicio: Date): RepetirOpcao[];  // 'Semanal: cada segunda', 'Mensal: no dia 5', 'Mensal: na primeira segunda', 'Mensal: na última segunda' only when ehUltimaSemanaDoMes, 'Anual: em 5 de outubro', 'Todos os dias úteis (segunda a sexta)', 'Personalizar…'
export function opcaoDaRegra(regra: AgendaRegra | null, inicio: Date): RepetirOpcaoId;
export function rederivarRegra(id: RepetirOpcaoId, regraAtual: AgendaRegra | null, novoInicio: Date): AgendaRegra | null; // preset options follow the new date; 'personalizado' keeps regraAtual
export function descreverRegra(regra: AgendaRegra, inicio: Date): string; // 'A cada 2 semanas na segunda e na quarta, até 30 de novembro de 2026'
export function ehUltimaSemanaDoMes(d: Date): boolean;
export function ordinalDoDia(d: Date): 1 | 2 | 3 | 4 | 5;
export function rotuloLembrete(min: number, diaInteiro: boolean): string; // 0 'Na hora', 10 '10 minutos antes', 60 '1 hora antes', 1440 '1 dia antes'; dia inteiro: -540 'No dia às 9h', 900 '1 dia antes às 9h', 9540 '1 semana antes às 9h'
export const LEMBRETES_HORARIO: number[];   // [0,5,10,15,30,60,1440]
export const LEMBRETES_DIA_INTEIRO: number[]; // [-540, 900, 9540]
export function toEventInput(o: AgendaOcorrencia, meuId: string): import('@fullcalendar/core').EventInput; // all-day: start=data_inicio_local, end=data_fim_local, allDay:true; editable = pode_editar && !mascarado; classNames include 'agenda-ev--pendente' | 'agenda-ev--recusado' | 'agenda-ev--mascarado'; extendedProps: { ocorrencia: o }
export function camposDeSerieMudaram(antes: AgendaEventoPayload, depois: AgendaEventoPayload): boolean; // tipo, cor, cliente_id, privado, dia_inteiro, lembretes, regra (deep), participants handled by caller
export function localIso(d: Date): string;  // 'yyyy-MM-dd'T'HH:mm:ss' in the browser zone, no offset
export function emFuso(iso: string, tz: string): Date; // instant -> Date whose local fields equal the wall clock in tz (to edit in the series tz)
export function deFuso(d: Date, tz: string): string;   // inverse: wall-clock fields of d as entered in the form -> 'yyyy-MM-ddTHH:mm:ss' meant in tz
export function fusoDoNavegador(): string;  // Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'
export function filtrarPorPessoas(os: AgendaOcorrencia[], ids: string[] | null): AgendaOcorrencia[]; // null = all; match organizador_id or any participantes.user_id
```

- [ ] **Step 1: Failing tests.** `agenda.test.ts` (mock `../core` like `store/__tests__/tarefaSeries.test.ts`): `listAgenda` calls `rpc('agenda_listar', { p_de: de.toISOString(), p_ate: ate.toISOString() })`; `getAgendaOcorrencia` passes `p_ocorrencia_id` and returns null on empty; `criarEvento` passes `{ p_evento, p_participantes }`; `editarEvento` passes `p_escopo`, `p_participantes: null` when null; errors propagate; `formatAgendaError(new Error('agenda: este evento não existe mais'))` → `Este evento não existe mais`. `agendaLogic.test.ts`: `opcoesRepetir(new Date(2026, 9, 5))` labels exactly as listed (segunda, dia 5, primeira segunda; no "última" option); `opcoesRepetir(new Date(2026, 9, 26))` includes `Mensal: na última segunda` and `Mensal: na quarta segunda`; `rederivarRegra('semanal', ..., Wed)` → `dias_semana [3]`; `descreverRegra` for daily (`Todos os dias`), intervalo 2 weekly two days with `ate`, monthly ordinal (`Mensalmente na segunda terça`), yearly, contagem (`, 13 vezes`); `rotuloLembrete` table; `toEventInput` all-day uses date strings and `allDay: true`, masked event has `editable: false` and class `agenda-ev--mascarado`, `minha_resposta 'pendente'` gets `agenda-ev--pendente`; `filtrarPorPessoas` matches participants of masked events; `camposDeSerieMudaram` true on `lembretes` change, false on title change.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/store/__tests__/agenda.test.ts apps/crm/src/pages/calendario/agenda/__tests__/agendaLogic.test.ts`. Expected FAIL.
- [ ] **Step 3: Implement.** This task adds `@fullcalendar/core` as a dependency only if needed for the `EventInput` type; to avoid lane conflicts, Task 8 instead declares `export interface AgendaEventInput { id: string; title: string; start: string; end: string; allDay: boolean; editable: boolean; backgroundColor: string; borderColor: string; textColor: string; classNames: string[]; extendedProps: { ocorrencia: AgendaOcorrencia } }` and Task 9 passes it to FullCalendar (structurally compatible with `EventInput`).
- [ ] **Step 4: Run** tests + `npx tsc -p apps/crm/tsconfig.json --noEmit`. Expected PASS.
- [ ] **Step 5: Commit** `feat(agenda): agenda store wrappers and pure recurrence helpers`.

---

### Task 9: FullCalendar view, sidebar, Agenda tab, deep link, styles

Spec: "Dependências", "Página", `AgendaView`, `AgendaSidebar`, "Deep link", "Outros pontos do CRM". Mockups: artboards "Semana", "Mês", "Mobile".

**Files:**
- Modify: `package.json` + `package-lock.json` (`npm install @fullcalendar/core@~6.1.21 @fullcalendar/react@~6.1.21 @fullcalendar/daygrid@~6.1.21 @fullcalendar/timegrid@~6.1.21 @fullcalendar/list@~6.1.21 @fullcalendar/interaction@~6.1.21` at the repo root)
- Create: `apps/crm/src/pages/calendario/agenda/AgendaTab.tsx`, `AgendaView.tsx`, `AgendaSidebar.tsx`, `__tests__/AgendaTab.test.tsx`
- Modify: `apps/crm/src/pages/calendario/CalendarioPage.tsx` (tabs at ~L794-807: add `agenda` first and default; title capture/restore), `apps/crm/src/pages/calendario/__tests__/CalendarioPage.test.tsx`, `apps/crm/src/context/AuthContext.tsx:115` (`calendario: ['calendar-deadlines', 'allClienteDatas', 'agenda-ocorrencias']`), `apps/crm/style.css` (new `.agenda-*` block after the calendar block ending ~L4660)

**Interfaces:**
- Consumes: Task 8 (`listAgenda`, `getAgendaOcorrencia`, `AGENDA_QUERY_KEY`, `toEventInput`, `filtrarPorPessoas`, `corDoEvento`, `TIPO_LABEL`, `TIPO_COR`); `getWorkspaceUsers()`; `useAuth()` for the current user id.
- Produces: `<AgendaTab />` with props none; it owns state `{ view, anchorDate, filtro, popover: { ocorrencia, anchorEl } | null, form: { mode: 'criar' | 'editar', ... } | null }` and renders `EventoPopover` (Task 11) and `EventoFormDialog` (Task 10) through these props contracts:

```ts
// consumed from Task 10
<EventoFormDialog open onOpenChange={(o)=>...} modo="criar" inicial={{ inicio: Date; fim: Date; diaInteiro: boolean }} />
<EventoFormDialog open onOpenChange={...} modo="editar" ocorrencia={AgendaOcorrencia} />
// consumed from Task 11
<EventoPopover ocorrencia={AgendaOcorrencia} anchor={HTMLElement} onClose={() => void} onEditar={(o) => void} />
// consumed from Task 11
useAgendaMutations(): { mover: (o: AgendaOcorrencia, novoInicio: Date, novoFim: Date, revert: () => void) => void }
```

While Tasks 10/11 are not merged, AgendaTab imports them from their final paths; the lane writes minimal stubs at those paths only if they do not exist yet, and the controller resolves the stubs at integration (the real files from Tasks 10/11 replace them).

- [ ] **Step 1: Failing tests.** `CalendarioPage.test.tsx`: the Agenda tab is selected by default and renders `AgendaTab` (mock `./agenda/AgendaTab`); the existing three Datas Comemorativas tests still pass after clicking that tab; `document.title` is `Agenda | Mesaas` while mounted and restored on unmount. `AgendaTab.test.tsx` (mock `@fullcalendar/react` with a component that records props and renders `events` titles; mock store): fetches with the FC `datesSet` range; switching "Minha agenda" filters to events where the user participates; `?evento=42` calls `getAgendaOcorrencia(42)` and opens the popover; not found → toast `Este evento não existe mais ou você não tem acesso.` and the param removed; mobile width (`matchMedia('(max-width: 767px)')` true) starts in `listWeek`.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/calendario`. Expected FAIL.
- [ ] **Step 3: Implement.** FullCalendar setup:

```tsx
<FullCalendar
  ref={calRef}
  plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
  locale={ptBrLocale}
  initialView={isMobile ? 'listWeek' : 'timeGridWeek'}
  headerToolbar={false}
  firstDay={1}
  nowIndicator
  selectable
  selectMirror
  dayMaxEvents
  slotMinTime="06:00:00"
  scrollTime={format(new Date(), 'HH:00:00')}
  height="auto"
  events={eventos}
  datesSet={(arg) => setRange({ start: arg.start, end: arg.end, title: arg.view.title })}
  select={(arg) => abrirCriar(arg.start, arg.end, arg.allDay)}
  eventClick={(arg) => abrirPopover(arg.event.extendedProps.ocorrencia, arg.el)}
  eventDrop={(arg) => mover(arg.event.extendedProps.ocorrencia, arg.event.start!, arg.event.end ?? arg.event.start!, arg.revert)}
  eventResize={(arg) => mover(arg.event.extendedProps.ocorrencia, arg.event.start!, arg.event.end!, arg.revert)}
/>
```

Toolbar (Hoje, ‹, ›, title from `datesSet`, `ToggleGroup` Mês/Semana/Dia/Lista calling `calRef.current.getApi().changeView(...)`) and sidebar per mockups; copy: `Criar evento`, `Minha agenda`, `Toda a equipe`, `Pessoas`, `Legenda`, `Borda tracejada: aguardando sua resposta`. Sidebar collapses into a `Sheet` at ≤ 1100px (button `Pessoas e filtros`). Mobile toggle shows Mês/Dia/Lista and a floating `Criar evento` button (`aria-label`). `.agenda-*` CSS overrides `--fc-border-color: var(--border-color)`, `--fc-page-bg-color: var(--card-bg)`, `--fc-today-bg-color: var(--surface-hover)`, `--fc-now-indicator-color: #ef4444`, `--fc-neutral-bg-color: var(--surface-1)`, list view colours, event chip radius 8px, and the three state classes (`--pendente` dashed 1.5px border in the event colour, `--recusado` line-through + opacity .6, `--mascarado` `repeating-linear-gradient(135deg, var(--surface-2) 0 6px, var(--surface-3) 6px 12px)` with `var(--text-muted)` text), for both themes (`[data-theme='dark']` reuses the same variables so most needs nothing extra).
- [ ] **Step 4: Run** tests + `npx tsc -p apps/crm/tsconfig.json --noEmit` + `npm run lint`. Expected PASS.
- [ ] **Step 5: Commit** `feat(agenda): FullCalendar agenda tab with team filter and deep link`.

---

### Task 10: Event form, Repetir, custom recurrence, scope dialog, people picker

Spec: `EventoFormDialog`, `RepetirSelect` + `RecorrenciaPersonalizadaDialog`, `EscopoEventoDialog`. Mockups: "Criar evento", "Repetição personalizada e escopo".

**Files:**
- Create: `apps/crm/src/pages/calendario/agenda/EventoFormDialog.tsx`, `eventoFormSchema.ts`, `RepetirSelect.tsx`, `RecorrenciaPersonalizadaDialog.tsx`, `EscopoEventoDialog.tsx`, `PessoasCombobox.tsx`, `__tests__/EventoFormDialog.test.tsx`, `__tests__/eventoFormSchema.test.ts`

**Interfaces:**
- Consumes: Task 8 (`criarEvento`, `editarEvento`, `getAgendaEvento` is NOT needed: the occurrence row carries `regra`, participants and fields; `opcoesRepetir`, `rederivarRegra`, `descreverRegra`, `rotuloLembrete`, `LEMBRETES_*`, `camposDeSerieMudaram`, `localIso`, `fusoDoNavegador`, `formatAgendaError`, `AGENDA_QUERY_KEY`); `getClientes`; `getWorkspaceUsers`.
- Produces: `EventoFormDialog` (props in Task 9), `EscopoEventoDialog`:

```ts
export function EscopoEventoDialog(props: {
  open: boolean; acao: 'editar' | 'excluir'; esteDesabilitado?: boolean;
  onCancel: () => void; onConfirm: (escopo: AgendaEscopo) => void;
}): JSX.Element;
```

- [ ] **Step 1: Failing tests.** Schema: title required (`Informe um título.`), end after start (`O fim precisa ser depois do início.`), link must be `https?://` (`Informe um link que comece com http:// ou https://.`), ≤ 50 people, ≤ 5 reminders. Dialog: create flow submits `criarEvento` with `inicio_local`/`fim_local` from `localIso`, `tz` from `fusoDoNavegador()`; edit flow pre-fills date/time with `emFuso(o.inicio, o.tz)`, sends `inicio_local` via `deFuso(..., o.tz)`, **never sends `tz`**, and shows `Horários no fuso {o.tz}` when `o.tz !== fusoDoNavegador()`; `lembretes [10]` by default (`[]` after toggling Dia inteiro); toggling Dia inteiro switches the time pickers off and sends `fim_local` = day after the end date at `00:00:00`; picking "Semanal: cada segunda" then changing the date to a Wednesday sends `dias_semana [3]`; editing a recurring occurrence opens `EscopoEventoDialog` and "Este evento" is disabled when `lembretes` changed, with helper `Vale para toda a série: você mudou {a repetição | os lembretes | ...}` (use the generic `Vale para toda a série.` if several); saving a non-recurring event skips the scope dialog and sends `todas`; dirty form + Esc shows the confirm-close dialog; server error `agenda: este evento não existe mais` → toast `Este evento não existe mais` and the dialog closes; when `criarEvento` returns a `dtstart` different from the chosen start → toast `A série começa em {segunda, 6 de outubro}.`.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/calendario/agenda/__tests__/EventoFormDialog.test.tsx apps/crm/src/pages/calendario/agenda/__tests__/eventoFormSchema.test.ts`. Expected FAIL.
- [ ] **Step 3: Implement** with `Dialog` + `DialogContent confirmClose={isDirty || isSubmitting} onConfirmClose={close}`, `Form`/`FormField` from `ui/form`, `DatePicker`, a 15-minute time `Select` (96 options `00:00`..`23:45`; end options after the start show the duration suffix ` (1 h 30 min)`), `Switch` for Dia inteiro and Privado (copy `Evento privado` / `Outras pessoas verão apenas "Ocupado" nesse horário.`), `PessoasCombobox` on `ui/command.tsx` + `Popover` with avatar chips (copy `Adicionar pessoa da equipe`, helper `Quem for adicionado recebe a notificação no app e por e-mail.`), client `Select` (`Sem cliente` option), reminders as chips + `Adicionar lembrete` menu, buttons `Cancelar` / `Salvar`, title `Novo evento` / `Editar evento`. `RecorrenciaPersonalizadaDialog` per mockup (copy `Repetição personalizada`, `Repetir a cada`, `Nos dias`, `Termina`, `Nunca`, `Em`, `Após`, `ocorrências`, `Cancelar`, `Concluir`, live summary from `descreverRegra`). `EscopoEventoDialog` copy: titles `Editar evento recorrente` / `Excluir evento recorrente?`, options `Este evento`, `Este e os seguintes`, `Todos os eventos`, confirm `Salvar` / `Excluir` (destructive), delete helper `Os participantes recebem um aviso de cancelamento.` On successful save: invalidate `[AGENDA_QUERY_KEY]`, toast `Evento criado` / `Evento atualizado`.
- [ ] **Step 4: Run** tests + tsc + lint. Expected PASS.
- [ ] **Step 5: Commit** `feat(agenda): event form with Google-style recurrence and scope dialog`.

---

### Task 11: Event popover, RSVP, delete, drag-to-move mutations

Spec: `EventoPopover`, drag behaviour in `AgendaView`. Mockup: "Detalhe do evento".

**Files:**
- Create: `apps/crm/src/pages/calendario/agenda/EventoPopover.tsx`, `useAgendaMutations.ts`, `__tests__/EventoPopover.test.tsx`, `__tests__/useAgendaMutations.test.tsx`

**Interfaces:**
- Consumes: Task 8 store + logic; Task 10 `EscopoEventoDialog`; `getWorkspaceUsers` for names/avatars.
- Produces: `EventoPopover` and `useAgendaMutations` exactly as listed in Task 9 "Interfaces".

- [ ] **Step 1: Failing tests.** Popover renders title, `Segunda, 5 de outubro · 14:00 a 16:00` (all-day: `Segunda, 5 de outubro · Dia inteiro`, multi-day `5 a 7 de outubro`), recurrence summary via `descreverRegra`, local, `Entrar na reunião` only for `https?://` (through `sanitizeUrl`), `Cliente: {nome}`, reminders joined (`10 minutos antes, 1 dia antes`), description, participant list with badges `Sim`/`Não`/`Talvez`/`Aguardando` and `organizador` suffix, count line `{n} participantes · {x} sim, {y} aguardando, {z} talvez`; RSVP buttons only when `pode_responder`, recurring asks `Este evento` / `Todos os eventos` (small `AlertDialog` titled `Responder a qual evento?`), non-recurring calls `responderEvento(id, 'sim', 'todas')`; Edit/Delete icons only when `pode_editar` (`aria-label` `Editar evento`, `Excluir evento`); delete non-recurring asks `Excluir evento?` with `Excluir` and helper `Os participantes recebem um aviso de cancelamento.`; recurring delete opens `EscopoEventoDialog acao="excluir"`; masked shows only `Ocupado` + time and no actions. `useAgendaMutations.mover`: non-recurring → `editarEvento(id, 'todas', payloadFromOcorrencia(o, novoInicio, novoFim), null)` then toast `Evento movido` with action `Desfazer` that calls it back with the old times; recurring → opens the scope dialog (via a returned `dialog` element the tab renders) and `revert()` on cancel; error → `revert()` + toast from `formatAgendaError`.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/calendario/agenda/__tests__/EventoPopover.test.tsx apps/crm/src/pages/calendario/agenda/__tests__/useAgendaMutations.test.tsx`. Expected FAIL.
- [ ] **Step 3: Implement.** `payloadFromOcorrencia(o, inicio, fim)` lives in `agendaLogic.ts`? No: add it to `useAgendaMutations.ts` (it needs the full payload: title etc. come from the occurrence row, `tz` from `o.tz`, `regra` from `o.regra`, `lembretes` are not on the row, so the move uses `getAgendaEvento`-free path: the RPC treats missing keys as "keep"). Therefore extend the RPC contract minimally: for drag the client sends only `{ "inicio_local", "fim_local", "tz" }` and Task 4's `agenda_validar_payload` must merge missing keys from the current series/occurrence. **Coordinate:** the SQL lane implements "missing key = keep the stored value" in `agenda_evento_editar` (add a test in Task 4: edit with only times keeps title, tipo, lembretes, regra). Popover is a shadcn `Popover` anchored to the clicked element (virtual anchor via `PopoverAnchor` positioned at the element's rect), closes on Esc and outside click. Mutations invalidate `[AGENDA_QUERY_KEY]` and on RSVP also `['notifications']` and `['notifications-unread-count']` prefixes.
- [ ] **Step 4: Run** tests + tsc + lint. Expected PASS.
- [ ] **Step 5: Commit** `feat(agenda): event popover with RSVP, delete and drag-to-move`.

---

### Task 12: Integration, full gates, browser verification (controller)

- [ ] Cherry-pick every lane onto `claude/full-featured-calendar-app-c56639` in task order; replace any Task 9 stubs with the real Task 10/11 files; `npm ci` (Deno pollution, memory `project_deno_npm_node_modules_gotcha`).
- [ ] Run every gate in Global Constraints; fix failures (`npm run format` for format).
- [ ] Browser: local stack (`.env.local` with local URL/anon, seeded owner + 2 members per memory `reference_local_supabase_colima`), `npm run dev`, verify: create single + weekly event, drag in week view (recurring asks scope), "Este e os seguintes" title change, RSVP from a second account, private event masked for a third account, all-day event, dark mode, 375 px list view, deep link from a bell notification. Run `select public.agenda_tick_lembretes(now(), false)` with a reminder due now and see the bell entry.
- [ ] Commit fixes; open no PR until the user asks (rollout needs prod deploy order from the spec).

## Self-review notes

- Drag contract gap found while writing Task 11 ("missing key = keep") is assigned to the SQL lane in Task 4; Task 4 Step 1 must include that test.
- Spec coverage: data model (T1), date math/materialization/generator (T2), list/create/notification types/digest claim (T3), edit/delete/RSVP/locks (T4), reminders + rollback (T5), digest copy + e-mail function (T6), CRM notification catalog (T7), store/logic (T8), page/view/sidebar/deep link/styles/AuthContext (T9), form/recurrence/scope (T10), popover/RSVP/drag (T11), rollout verification (T12).
