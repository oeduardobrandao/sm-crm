# Agenda: Google button, .ics and personal feed (sub-project 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Adicionar ao Google Agenda" and "Baixar .ics" on an event, plus a per-user secret iCal feed URL, all behind `feature_agenda`.

**Architecture:** A migration adds `agenda_feed_tokens`, three CRM RPCs and a service-role-only `agenda_feed_eventos(token) → jsonb`. One Deno edge function `agenda-feed` serves the feed (token in the path) and the per-occurrence `.ics` download (user JWT), both through a pure `_shared/ics.ts`. The CRM builds the Google link itself and calls the function for downloads.

**Tech Stack:** Postgres (plpgsql, SECURITY DEFINER), Deno edge functions, React 19 + TanStack Query + shadcn/Radix, Vitest, psql entitlement suites.

**Spec:** `docs/superpowers/specs/2026-10-06-agenda-google-ics-feed-design.md`. It is the source of truth for every contract below; read the section named in each task.

## Global Constraints

- Migration file: `supabase/migrations/20261006000001_agenda_feed.sql` (main's tail is `20261005000002`).
- Token: `replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')`, 64 lowercase hex; handler regex `^[0-9a-f]{64}$`.
- UID: `agenda-oc-<ocorrencia_id>@mesaas.com.br`. No `RRULE`, no `SEQUENCE`, no `LAST-MODIFIED`.
- Feed window: `o.inicio >= now() - interval '30 days' AND o.inicio < now() + interval '12 months'`, `ORDER BY o.inicio, o.id LIMIT 2000`.
- Feed content: non-cancelled occurrences where the token's user is organizer or participant, excluding effective response `nao` (`coalesce(agenda_respostas.resposta, agenda_participantes.resposta)`).
- RPC preamble identical to `agenda_listar`: `get_my_conta_id()` + `auth.uid()` non-null, `effective_plan_feature(v_conta,'feature_agenda')` else `RAISE EXCEPTION 'feature_disabled:feature_agenda' USING ERRCODE = 'P0001'`, `has_permission('calendario','ver')` else raise.
- Rate limits: valid token `agenda-feed:<hashToken(token)>` 60/3600; unknown token `agenda-feed-badtoken:<getClientIP(req)>` 30/600.
- Edge function deployed with `--no-verify-jwt`; `[functions.agenda-feed] verify_jwt = false` in `supabase/config.toml`.
- User-facing copy in Portuguese, no em-dashes. Icons from `lucide-react` only.
- Never use `useBlocker`. Never redeploy `client-event-email-cron` from this branch.
- Lanes must NOT run `deno` / `npm run check:functions` / `npm run test:functions` while sharing `node_modules` with other lanes; the controller runs them after integration (then `git checkout deno.lock && npm ci`).

---

### Task 1 (Lane DB): migration + entitlement suite

**Files:**
- Create: `supabase/migrations/20261006000001_agenda_feed.sql`
- Create: `supabase/tests/entitlements/99_agenda_feed.sql`

**Interfaces:**
- Produces (consumed by Tasks 2 and 3):
  - `public.agenda_feed_obter() RETURNS text` (token or NULL)
  - `public.agenda_feed_gerar() RETURNS text` (new token)
  - `public.agenda_feed_desativar() RETURNS void`
  - `public.agenda_feed_eventos(p_token text) RETURNS jsonb`: `NULL` | `{"estado":"desligado","workspace_nome":text,"eventos":[]}` | `{"estado":"ok","workspace_nome":text,"eventos":[{ocorrencia_id, evento_id, data_original, inicio, fim, dia_inteiro, data_inicio_local, data_fim_local, titulo, descricao, local, link_reuniao, tz}]}`. `inicio`/`fim` as ISO timestamptz strings (jsonb default), dates as `YYYY-MM-DD`.

- [ ] **Step 1: Write the failing suite** `99_agenda_feed.sql`, copying the header, `et_grant_hosted_parity`/grant block (add `'agenda_feed_tokens'` to the array and `revoke all on public.agenda_feed_tokens from anon, authenticated; grant all on public.agenda_feed_tokens to service_role;`), seeding, and `pg_temp.criar`/`pg_temp.erro` helpers from `99_agenda_feature_flag.sql` / `99_agenda_rls.sql`. Put `update plans set feature_agenda = true;` right after `begin;` for the main blocks. Assertions (each as `DO $$ ... RAISE EXCEPTION ... $$` like the siblings):
  1. `agenda_feed_obter()` is NULL at first; `agenda_feed_gerar()` returns 64-hex; `obter` returns the same; a second `gerar` returns a different value and the old one no longer resolves in `agenda_feed_eventos`; `desativar` → `obter` NULL and feed NULL.
  2. User B's `obter` never returns A's token; `authenticated` has no SELECT on `agenda_feed_tokens` (`has_table_privilege('authenticated','public.agenda_feed_tokens','SELECT')` false).
  3. Feed for A includes: an event A organizes; an event B organizes with A as participant; a private event B organizes with A as participant, with its real title (not "Ocupado"). Excludes: B's event without A; an occurrence A declined via `agenda_responder`; a cancelled occurrence (delete one occurrence with escopo `esta`); an occurrence older than 30 days and one more than 12 months out.
  4. A per-occurrence title override (edit escopo `esta` with a new `titulo`) shows the overridden title.
  5. `UPDATE plans SET feature_agenda = false` → `gerar`/`obter`/`desativar` raise `feature_disabled:feature_agenda`; feed returns `estado = 'desligado'` with empty `eventos`.
  6. Delete A's `workspace_members` row → feed NULL.
  7. `has_function_privilege('anon', 'public.agenda_feed_eventos(text)', 'EXECUTE')` and same for `authenticated` are false; `service_role` true. `anon` cannot execute the three CRM RPCs.

- [ ] **Step 2: Run it, expect failure** (functions don't exist): `bash scripts/test-entitlements.sh` (needs local Supabase on colima; see memory `reference_local_supabase_colima`). If no local DB is available, say so in the report; CI's `entitlement-tests` job gates it.

- [ ] **Step 3: Write the migration**

```sql
-- Agenda (sub-projeto 2): feed iCal pessoal. Spec:
-- docs/superpowers/specs/2026-10-06-agenda-google-ics-feed-design.md
CREATE TABLE public.agenda_feed_tokens (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conta_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, conta_id)
);
ALTER TABLE public.agenda_feed_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY agenda_feed_tokens_service_role_bypass ON public.agenda_feed_tokens
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.agenda_feed_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.agenda_feed_tokens TO service_role;

-- Shared preamble of the three CRM RPCs; returns (conta, user).
CREATE OR REPLACE FUNCTION public.agenda_feed_contexto(OUT v_conta uuid, OUT v_user uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  v_conta := get_my_conta_id(); v_user := auth.uid();
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'agenda: sessão sem workspace ativo'; END IF;
  IF NOT public.effective_plan_feature(v_conta, 'feature_agenda') THEN
    RAISE EXCEPTION 'feature_disabled:feature_agenda' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.has_permission('calendario', 'ver') THEN
    RAISE EXCEPTION 'agenda: você não pode ver a agenda';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.agenda_feed_contexto() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_feed_contexto() TO service_role;

CREATE OR REPLACE FUNCTION public.agenda_feed_obter()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; v text;
BEGIN
  c := public.agenda_feed_contexto();
  SELECT t.token INTO v FROM public.agenda_feed_tokens t
   WHERE t.user_id = c.v_user AND t.conta_id = c.v_conta;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.agenda_feed_gerar()
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; v text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
BEGIN
  c := public.agenda_feed_contexto();
  INSERT INTO public.agenda_feed_tokens (user_id, conta_id, token)
  VALUES (c.v_user, c.v_conta, v)
  ON CONFLICT (user_id, conta_id) DO UPDATE SET token = EXCLUDED.token, criado_em = now();
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.agenda_feed_desativar()
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE c record;
BEGIN
  c := public.agenda_feed_contexto();
  DELETE FROM public.agenda_feed_tokens t WHERE t.user_id = c.v_user AND t.conta_id = c.v_conta;
END $$;

REVOKE ALL ON FUNCTION public.agenda_feed_obter() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agenda_feed_gerar() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agenda_feed_desativar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_feed_obter() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agenda_feed_gerar() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agenda_feed_desativar() TO authenticated, service_role;

-- Service role only (edge function agenda-feed). The token is the credential.
-- Contents = "my events": the user organizes or participates, not declined.
-- No masking needed: a participant always sees the details (agenda_listar's
-- mascarado requires NOT participant).
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

  SELECT coalesce(jsonb_agg(x ORDER BY x.inicio, x.ocorrencia_id), '[]'::jsonb) INTO v_eventos
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
           e.tz
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
```

  Before relying on it, verify against `20261005000001_agenda_eventos.sql`: the organizer is always inserted in `agenda_participantes` (lines ~999 and ~1192, per review), `ap.resposta` column name, `o.cancelada`, `o.campos_sobrescritos`. The `agenda_feed_contexto` OUT-record call pattern: if plpgsql rejects `c := f()` for an OUT-param function, use `SELECT * INTO c FROM public.agenda_feed_contexto();`. Note `agenda_feed_contexto` runs `auth.uid()` inside a DEFINER called from a DEFINER: the JWT claim GUC is unchanged, so this works; the suite proves it.

- [ ] **Step 4: Run the suite until green**, then the whole `bash scripts/test-entitlements.sh` to confirm no other suite broke.
- [ ] **Step 5: Commit** `feat(agenda): feed token table, RPCs and agenda_feed_eventos`.

---

### Task 2 (Lane Edge): `_shared/ics.ts` + `agenda-feed` function

**Files:**
- Create: `supabase/functions/_shared/ics.ts`
- Create: `supabase/functions/agenda-feed/handler.ts`, `supabase/functions/agenda-feed/index.ts`
- Create: `supabase/functions/__tests__/ics_test.ts`, `supabase/functions/__tests__/agenda-feed_test.ts`
- Modify: `supabase/config.toml` (add `[functions.agenda-feed]\nverify_jwt = false` next to `agenda-lembretes-email`)

**Interfaces:**
- Consumes: `agenda_feed_eventos(p_token) → jsonb` (Task 1 contract above); `agenda_listar(p_ocorrencia_id)` row shape (`AgendaOcorrencia` in `apps/crm/src/store/agenda.ts` mirrors it: `ocorrencia_id`, `inicio`, `fim`, `dia_inteiro`, `data_inicio_local`, `data_fim_local`, `titulo`, `descricao`, `local`, `link_reuniao`, `mascarado`).
- Produces (consumed by Task 3): `GET {SUPABASE_URL}/functions/v1/agenda-feed/<token>.ics`; `GET {SUPABASE_URL}/functions/v1/agenda-feed/ocorrencia/<id>.ics` with `Authorization: Bearer <jwt>`, answering 200 `text/calendar`, 401, 404, 500; `OPTIONS` 204.

- [ ] **Step 1: Failing tests for `ics.ts`** (`ics_test.ts`, `Deno.test` + `jsr:@std/assert` like sibling tests): escaping `\ ; , \n` and stripping `\r`/control chars; every line ends `\r\n`; no line exceeds 75 octets (`new TextEncoder().encode(line).length <= 75`) with a 200-char title full of `ç`, `ã` and `🎬`, and unfolding (remove `\r\n `) restores the exact escaped value; timed event `DTSTART:20261007T130000Z`; all-day `DTSTART;VALUE=DATE:20261007` / `DTEND;VALUE=DATE:20261008`; `url: 'javascript:alert(1)'` → no `URL:` line and not in DESCRIPTION; DESCRIPTION = description + `\n\nLink da reunião: <url>`; empty `eventos` → valid `BEGIN:VCALENDAR ... END:VCALENDAR` with no VEVENT; header lines exactly as spec section "_shared/ics.ts".

- [ ] **Step 2: Implement `ics.ts`** to the API in the spec:

```ts
export interface IcsEvento {
  uid: string;
  inicio: Date;
  fim: Date;
  diaInteiro: boolean;
  dataInicio?: string; // YYYY-MM-DD, all-day
  dataFim?: string; // YYYY-MM-DD exclusive, all-day
  titulo: string;
  descricao?: string | null;
  local?: string | null;
  url?: string | null;
}

const CRLF = "\r\n";

export function escaparTexto(v: string): string {
  return v
    .replace(/\r\n?/g, "\n")
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** Folds at 75 octets without splitting a UTF-8 sequence (RFC 5545 3.1). */
export function dobrar(linha: string): string {
  const enc = new TextEncoder();
  const partes: string[] = [];
  let atual = "";
  let bytes = 0;
  let limite = 75;
  for (const ch of linha) {
    const n = enc.encode(ch).length;
    if (bytes + n > limite) {
      partes.push(atual);
      atual = "";
      bytes = 0;
      limite = 74; // continuation lines start with one space
    }
    atual += ch;
    bytes += n;
  }
  partes.push(atual);
  return partes.join(CRLF + " ");
}

function utc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
function data(d: string): string {
  return d.replace(/-/g, "");
}
function urlSegura(u?: string | null): string | null {
  return u && /^https?:\/\//i.test(u) ? u : null;
}

export function gerarCalendario(
  { nome, eventos, agora }: { nome: string; eventos: IcsEvento[]; agora: Date },
): string {
  const l: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mesaas//Agenda//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escaparTexto(nome)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const e of eventos) {
    const url = urlSegura(e.url);
    const desc = [e.descricao?.trim() || null, url ? `Link da reunião: ${url}` : null]
      .filter(Boolean)
      .join("\n\n");
    l.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${utc(agora)}`);
    if (e.diaInteiro && e.dataInicio && e.dataFim) {
      l.push(`DTSTART;VALUE=DATE:${data(e.dataInicio)}`, `DTEND;VALUE=DATE:${data(e.dataFim)}`);
    } else {
      l.push(`DTSTART:${utc(e.inicio)}`, `DTEND:${utc(e.fim)}`);
    }
    l.push(`SUMMARY:${escaparTexto(e.titulo)}`);
    if (desc) l.push(`DESCRIPTION:${escaparTexto(desc)}`);
    if (e.local?.trim()) l.push(`LOCATION:${escaparTexto(e.local.trim())}`);
    if (url) l.push(`URL:${url}`);
    l.push("TRANSP:OPAQUE", "END:VEVENT");
  }
  l.push("END:VCALENDAR");
  return l.map(dobrar).join(CRLF) + CRLF;
}
```

  Calendar name passed by the handler: `Mesaas: <workspace_nome>` (feed) or the event title (download).

- [ ] **Step 3: Failing handler tests** (`agenda-feed_test.ts`) with injected fakes (pattern: `supabase/functions/__tests__/hub-*` tests + `hub-approve/handler.ts`). Dependencies to inject:

```ts
export interface AgendaFeedDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  feedEventos: (token: string) => Promise<FeedResultado | null>; // service-role rpc
  getUser: (jwt: string) => Promise<{ id: string } | null>;      // service-role auth.getUser
  listarOcorrencia: (jwt: string, id: number) =>                 // anon key + user JWT client
    Promise<{ rows: OcorrenciaIcs[] } | { erro: "jwt" | "negado" | "outro" }>;
  rateLimit: (key: string, max: number, windowSeconds: number) => Promise<boolean>;
  hashToken: (t: string) => Promise<string>;
  clientIP: (req: Request) => string;
  now: () => Date;
}
export function createAgendaFeedHandler(deps: AgendaFeedDeps): (req: Request) => Promise<Response>;
```

  Cases (all from spec "Edge function agenda-feed"): bad format → 404 and `feedEventos` not called; unknown token → `rateLimit('agenda-feed-badtoken:<ip>',30,600)` then 404; bad-token limit exhausted → 429; valid token over limit (`agenda-feed:<hash>`, 60, 3600) → 429; `desligado` → 200 calendar with no VEVENT; `ok` → 200 with `Content-Type: text/calendar; charset=utf-8`, `Cache-Control: private, max-age=300`, UID `agenda-oc-<id>@mesaas.com.br`, `X-WR-CALNAME:Mesaas: <nome>`; `HEAD` → same status/headers, empty body; `feedEventos` throws → 500 generic. Download route: `OPTIONS` → 204 with CORS; no `Authorization` → 401; `getUser` null → 401; `listarOcorrencia` `{erro:'jwt'}` → 401; `{erro:'negado'}` → 404; `{erro:'outro'}` → 500; zero rows → 404; `mascarado` → 404; id `abc`/`0`/`-1` → 404; ok → 200 with `Content-Disposition: attachment; filename="<ascii-slug>.ics"; filename*=UTF-8''<encoded>.ics` and CORS headers. Any other path/method → 404. Bodies are generic Portuguese JSON (`{"error":"Não encontrado"}` etc.); the token is never passed to `console.*`.

- [ ] **Step 4: Implement `handler.ts` and `index.ts`.** `index.ts` wires: service-role `createClient(SUPABASE_URL, SERVICE_ROLE_KEY)`; `feedEventos` = `db.rpc('agenda_feed_eventos', { p_token })`; `getUser` = `db.auth.getUser(jwt)`; `listarOcorrencia` = `createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: 'Bearer ' + jwt } }, auth: { persistSession: false } }).rpc('agenda_listar', { p_ocorrencia_id: id })`, mapping PostgREST errors: HTTP status 401 or code `PGRST301`/`PGRST302` → `jwt`; message starting `agenda:` or `feature_disabled` → `negado`; else `outro` (verify the error shape against `instagram-publish/index.ts` and supabase-js docs; record what you found). `rateLimit` = `checkRateLimit(db, …)`, `hashToken` from `_shared/mcp-token.ts`, `getClientIP` from `_shared/rate-limit.ts`. Path parsing: `new URL(req.url).pathname.replace(/^\/agenda-feed/, '')`.

- [ ] **Step 5: Do NOT run deno in the lane** (Global Constraints). Report the exact commands for the controller: `deno test --no-check supabase/functions/__tests__/ics_test.ts supabase/functions/__tests__/agenda-feed_test.ts` and `npm run check:functions`.
- [ ] **Step 6: Commit** `feat(agenda): agenda-feed edge function and shared ICS builder`.

---

### Task 3 (Lane UI): Google link, popover menu, download, feed dialog

**Files:**
- Create: `apps/crm/src/pages/calendario/agenda/googleAgenda.ts`, `baixarIcs.ts`, `FeedAgendaDialog.tsx`
- Create tests: `apps/crm/src/pages/calendario/agenda/__tests__/googleAgenda.test.ts`, `baixarIcs.test.ts`, `FeedAgendaDialog.test.tsx`
- Modify: `apps/crm/src/pages/calendario/agenda/EventoPopover.tsx`, `AgendaSidebar.tsx`, `apps/crm/src/store/agenda.ts`, and existing popover/sidebar tests in `agenda/__tests__/`

**Interfaces:**
- Consumes: RPCs `agenda_feed_obter` / `agenda_feed_gerar` / `agenda_feed_desativar` (Task 1), edge routes (Task 2). `AgendaOcorrencia` from `store/agenda.ts`.
- Produces: nothing for other lanes.

- [ ] **Step 1: `googleAgenda.ts` test first**, then:

```ts
import type { AgendaOcorrencia } from '@/store/agenda';

const utc = (iso: string) =>
  new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dia = (d: string) => d.replace(/-/g, '');

export function linkGoogleAgenda(o: AgendaOcorrencia): string {
  const datas = o.dia_inteiro
    ? `${dia(o.data_inicio_local)}/${dia(o.data_fim_local)}`
    : `${utc(o.inicio)}/${utc(o.fim)}`;
  const detalhes = [o.descricao?.trim() || null, o.link_reuniao ? `Link da reunião: ${o.link_reuniao}` : null]
    .filter(Boolean)
    .join('\n\n');
  const p = new URLSearchParams({ action: 'TEMPLATE', text: o.titulo, dates: datas });
  if (detalhes) p.set('details', detalhes);
  if (o.local) p.set('location', o.local);
  if (o.tz) p.set('ctz', o.tz);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
```

  Check `AgendaOcorrencia` field names/types in `store/agenda.ts` (`data_fim_local` is exclusive for all-day; confirm against `agenda_listar`). Tests: timed → `dates=20261007T130000Z%2F20261007T140000Z`; all-day exclusive end; `&`, `#`, accents survive round-trip via `new URL(...).searchParams`; no description and no link → no `details`.

- [ ] **Step 2: `store/agenda.ts`**: add, following `listAgenda`'s pattern:

```ts
export async function obterFeedToken(): Promise<string | null> { /* rpc('agenda_feed_obter') */ }
export async function gerarFeedToken(): Promise<string> { /* rpc('agenda_feed_gerar') */ }
export async function desativarFeedToken(): Promise<void> { /* rpc('agenda_feed_desativar') */ }
export function urlFeedAgenda(token: string): string {
  return `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/agenda-feed/${token}.ics`;
}
```

- [ ] **Step 3: `baixarIcs.ts` test first, then implement**: `baixarIcsDaOcorrencia(o: AgendaOcorrencia): Promise<void>`: session via `supabase.auth.getSession()` (as `useWorkspaceLimits.fetchWorkspaceLimits`), `fetch(`${VITE_SUPABASE_URL}/functions/v1/agenda-feed/ocorrencia/${o.ocorrencia_id}.ics`, { headers: { Authorization: `Bearer ${token}` } })`; `!res.ok` → `toast.error('Não foi possível baixar o arquivo.')`; else `URL.createObjectURL(await res.blob())`, `<a download="<slug>.ics">` click, `revokeObjectURL`. Slug: lowercase, NFD strip diacritics, non-alphanumerics → `-`, trim dashes, max 60, fallback `evento`. Export the slug helper and test it.

- [ ] **Step 4: Popover menu.** In `EventoPopover.tsx` header, before the Fechar button, when `!o.mascarado`: a `DropdownMenu` (`@/components/ui/dropdown-menu`) with trigger `Button variant="ghost" size="icon" className="mb-0 h-9 w-9 rounded-lg"`, `aria-label="Mais ações"`, icon `MoreVertical`. Items: "Adicionar ao Google Agenda" (`window.open(linkGoogleAgenda(o), '_blank', 'noopener,noreferrer')`) and "Baixar .ics" (`void baixarIcsDaOcorrencia(o)`). Tests: menu present for a normal occurrence and both items render after opening; absent when `mascarado`; clicking Google calls `window.open` with a `calendar.google.com` URL. The controller verifies in the browser that a menu click doesn't close the popover first (spec CRM section).

- [ ] **Step 5: `FeedAgendaDialog.tsx` test first, then implement** to the spec's CRM section (three states: loading/no link/with link; "Gerar link"; URL read-only `Input` + "Copiar" via `navigator.clipboard.writeText` + `toast.success('Link copiado')`; "Abrir no Google Agenda" → `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(url.replace(/^https:/, 'webcal:'))}`; "Abrir no Apple Calendar" → `url.replace(/^https:/, 'webcal:')`; Outlook instruction text; the two warnings; "Gerar novo link" and "Desativar link" each behind an `AlertDialog` confirm). Props `{ open: boolean; onOpenChange: (v: boolean) => void }`. Query key `['agenda-feed-token', profile?.conta_id ?? null]` (`useAuth().profile`), `enabled: open`. Mutations `gerarFeedToken` / `desativarFeedToken` set the query data on success; errors `toast.error(formatAgendaError(err))`. Exact copy from the spec; no em-dashes.

- [ ] **Step 6: Sidebar entry.** `AgendaSidebar.tsx`: a footer button "Sincronizar com seu calendário" with `CalendarSync` icon that opens `FeedAgendaDialog` (state local to the sidebar). Test: renders and opens the dialog.

- [ ] **Step 7: Gates in the lane:** `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx vitest run apps/crm/src/pages/calendario`, `npm run lint`, `npx prettier --check` on touched files.
- [ ] **Step 8: Commit** `feat(agenda): Google link, .ics download and personal feed dialog`.

---

### Task 4 (Controller): integrate, verify, ship

- [ ] Cherry-pick the three lanes; run all CI gates: lint, format:check, four `tsc`, `npm run test`, `npm run check:functions`, `npm run test:functions` (then `git checkout deno.lock && npm ci`), entitlement suites.
- [ ] Browser verification on the local stack (memory recipe; serve `agenda-feed` with `npx supabase functions serve agenda-feed --no-verify-jwt` or stub it): popover menu, Google link opens prefilled, `.ics` downloads with the right name, feed dialog states, copy, regenerate/deactivate confirms; `curl` the local feed URL and validate the output (CRLF, folding, UIDs).
- [ ] Final whole-branch review (Fable). Open PR.
- [ ] Rollout (user-visible prod steps): `db push --linked` → verify objects/grants → deploy `agenda-feed --no-verify-jwt --use-api --project-ref skjzpekeqefvlojenfsw` → merge → pilot: subscribe in Google/Apple.
