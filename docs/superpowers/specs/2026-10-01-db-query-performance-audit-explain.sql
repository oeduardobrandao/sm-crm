-- Verification for 2026-10-01-db-query-performance-audit.md, finding 1.
-- Runs EXPLAIN ANALYZE (SELECT-only) as an authenticated user inside a transaction
-- that is never committed. Run against the intended project only:
--   cat supabase/.temp/project-ref   # skjzpekeqefvlojenfsw = prod
--   npx supabase db query --linked --file docs/superpowers/specs/2026-10-01-db-query-performance-audit-explain.sql -o json
-- The user below is the owner of the largest workspace (by workflow_posts) as of 2026-10-01.
begin;
create temp table _plans(k text, n serial, line text);
grant all on _plans to authenticated;
grant usage on sequence _plans_n_seq to authenticated;
select set_config('request.jwt.claims',
  '{"sub":"94300680-bc0a-44ff-9067-8c31a545a054","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r record; qs text[][] := array[
  ['1 templates',  'select * from workflow_templates order by created_at desc'],
  ['2 workflows',  'select * from workflows order by created_at desc'],
  ['3 etapas',     'select * from workflow_etapas where workflow_id = 1235 order by ordem'],
  ['4 banners',    'select id, type, content from global_banners order by created_at desc'],
  ['5 clientes_v', 'select * from clientes_v order by created_at desc, id desc']
];
begin
  for i in 1..array_length(qs, 1) loop
    for r in execute 'explain (analyze, buffers) ' || qs[i][2] loop
      insert into _plans(k, line) values (qs[i][1], r."QUERY PLAN");
    end loop;
  end loop;
end $$;
reset role;
select k, string_agg(line, E'\n' order by n) as plan from _plans group by k order by k;
