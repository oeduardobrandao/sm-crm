-- Backfill "Padrão" into every workspace with no workflow_templates at all. Idempotent
-- (NOT EXISTS makes a re-run a no-op); a workspace with ANY existing template (even a
-- user-made one) is never touched. Iterates `workspaces` (not `contas`) because
-- effective_plan_limit() resolves the plan from `workspaces` and returns 0 for an id it
-- can't find there. Runs as `postgres`, which bypasses RLS but not triggers, so
-- trg_limit_templates still fires per row -- the predicate below pre-filters out rows
-- that would be rejected rather than fighting the trigger.
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
insert into workflow_templates (user_id, conta_id, nome, etapas, modo_prazo)
select
  coalesce(
    (select p.id from profiles p where p.conta_id = w.id and p.role = 'owner'
      order by p.created_at limit 1),
    w.created_by
  ),
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
from workspaces w
where not exists (select 1 from workflow_templates t where t.conta_id = w.id)
  and coalesce(
        (select p.id from profiles p where p.conta_id = w.id and p.role = 'owner'
          order by p.created_at limit 1),
        w.created_by
      ) is not null  -- workflow_templates.user_id is NOT NULL; skip rows we can't resolve
  and (
        effective_plan_limit(w.id, 'max_workflow_templates') is null  -- unlimited
        or effective_plan_limit(w.id, 'max_workflow_templates') > 0
      );
