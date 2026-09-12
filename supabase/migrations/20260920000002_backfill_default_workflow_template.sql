-- Backfill "Padrão" into every workspace with no workflow_templates at all. Idempotent
-- (a fresh NOT EXISTS check per workspace makes a re-run a no-op); a workspace with ANY
-- existing template (even a user-made one) is never touched. Iterates `workspaces` (not
-- `contas`) because effective_plan_limit() resolves the plan from `workspaces` and
-- returns 0 for an id it can't find there. Runs as `postgres`, which bypasses RLS but
-- not triggers, so trg_limit_templates still fires per row.
--
-- Per-workspace loop with its own BEGIN/EXCEPTION, not a single set-based INSERT...SELECT.
-- enforce_plan_count_limit() (20260611130002_enforce_plan_count_limit_fn.sql) is plpgsql
-- with no volatility marker, so it defaults to VOLATILE: each internal query inside it
-- gets a FRESH snapshot taken the moment it runs, not the snapshot of whatever statement
-- invoked it. A single top-level INSERT...SELECT's WHERE NOT EXISTS is evaluated once,
-- against the snapshot at the start of that statement -- but the trigger's own count(*)
-- re-runs fresh per row, after taking its advisory lock. That gap is exploitable by an
-- ordinary concurrent user action: workspace W has 0 templates when this migration's
-- candidate-selection snapshot is taken; before this migration's own per-row insert for W
-- reaches the trigger, a live user creates W's actual first template through the app,
-- commits, and releases the advisory lock; this migration's insert for W then takes that
-- same lock and its trigger's fresh count(*) sees the user's newly-committed row, so
-- `count >= limit` and the trigger raises plan_limit_exceeded. Under the old plain
-- INSERT...SELECT, that one row's unhandled exception aborted the ENTIRE statement --
-- and with it the whole migration transaction, failing `db push` against a live database
-- over something that has nothing to do with this migration and everything to do with
-- one workspace's ordinary, unrelated traffic. The advisory lock is doing its documented
-- job here (serializing concurrent inserts, making the "loser" see the "winner's"
-- committed row) -- the bug was this migration having no handler for being the loser.
--
-- The fix deliberately does NOT lock each workspace before testing emptiness (which
-- would make the *migration* win the race instead): that would make the user's ordinary
-- "create my first template" action fail instead, routing them into a confusing raw
-- plan_limit_exceeded error. A convenience backfill silently skipping a workspace that
-- turns out not to need seeding is the correct trade -- the same philosophy
-- 20260920000001_seed_default_workflow_template.sql's own seed block already uses for
-- the identical class of problem. The outer `for w in <query> loop` opens one cursor: its
-- candidate list is a single snapshot taken when the loop opens, NOT re-taken per
-- iteration. The NOT EXISTS check inside the body is a separate statement, so it DOES get
-- a fresh snapshot each time through the loop (plain READ COMMITTED per-statement
-- semantics) -- that per-iteration re-check is what tightens the race window as much as
-- practical; it cannot close it entirely, which is exactly why the insert is also wrapped
-- in its own exception handler. The effective_plan_limit(...) IS NULL OR > 0 pre-filter in
-- the loop's candidate query is kept as a first-pass filter -- still correct and still
-- useful, just no longer the only guard.
--
-- profiles.role is compared as an untyped literal ('owner'), not cast to the user_role
-- enum. In a fresh local `supabase db reset`, profiles.role is still `text` (CHECK
-- role = ANY ('{owner,admin,agent}')) at runtime: 20260505000002_create_user_role_enum.sql
-- attempts `ALTER TABLE profiles ALTER COLUMN role TYPE user_role`, but that ALTER is
-- wrapped in `EXCEPTION WHEN others THEN NULL` and silently no-ops locally, failing with
-- "default for column "role" cannot be cast automatically to type user_role" (that
-- enum's own header notes it "was created manually in production", so prod's actual
-- column type was not independently verified here and may differ). Comparing against
-- an untyped literal is deliberate and correct either way: 'owner' resolves to text under
-- a text column (text = text) and to user_role under an enum column (the literal takes
-- the column's type) -- unlike `'owner'::user_role`, which raises "operator does not
-- exist: text = user_role" against a text column.
do $$
declare
  w record;
  v_owner uuid;
begin
  for w in
    select id, created_by
    from workspaces
    where effective_plan_limit(id, 'max_workflow_templates') is null  -- unlimited
       or effective_plan_limit(id, 'max_workflow_templates') > 0
  loop
    begin
      -- Fresh check per workspace (READ COMMITTED re-evaluates this each iteration),
      -- tightening -- not eliminating -- the race the exception handler below exists for.
      if not exists (select 1 from workflow_templates t where t.conta_id = w.id) then
        select coalesce(
          (select p.id from profiles p where p.conta_id = w.id and p.role = 'owner'
            order by p.created_at limit 1),
          w.created_by
        ) into v_owner;

        if v_owner is not null then -- workflow_templates.user_id is NOT NULL; skip rows we can't resolve
          insert into workflow_templates (user_id, conta_id, nome, etapas, modo_prazo)
          values (
            v_owner,
            w.id,
            'Padrão',
            '[
              {"nome":"Copy","prazo_dias":3,"tipo_prazo":"uteis","tipo":"padrao"},
              {"nome":"Aprovação da Copy","prazo_dias":2,"tipo_prazo":"corridos","tipo":"aprovacao_cliente"},
              {"nome":"Mídia","prazo_dias":3,"tipo_prazo":"uteis","tipo":"padrao"},
              {"nome":"Aprovação da Mídia","prazo_dias":2,"tipo_prazo":"corridos","tipo":"aprovacao_cliente"},
              {"nome":"Agendamento","prazo_dias":1,"tipo_prazo":"uteis","tipo":"padrao"}
            ]'::jsonb,
            'padrao'
          );
        end if;
      end if;
    exception when others then
      -- One workspace losing this race (or failing for any other reason) must never
      -- abort the backfill for every other workspace, nor abort the migration/db push.
      raise warning 'backfill skipped for workspace % (sqlstate %): %', w.id, sqlstate, sqlerrm;
    end;
  end loop;
end $$;
