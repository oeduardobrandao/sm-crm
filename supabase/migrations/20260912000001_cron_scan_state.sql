-- =====================================================================
-- 20260912000001_cron_scan_state.sql
-- Checkpoint durável para varreduras paginadas de bucket. Service-role
-- only, sem acesso de cliente.
--
-- Motivo: listOrphanKeys() materializava TODAS as chaves do prefixo dentro
-- de um único isolate. Isso morreu com WORKER_RESOURCE_LIMIT em produção
-- (evidência 2026-08-13) e, como o scan roda por último no
-- post-media-cleanup-cron, a morte levava junto tudo que viesse depois.
-- A varredura passa a consumir um número fixo de páginas por execução e a
-- guardar aqui o ContinuationToken do R2, retomando de onde parou.
--
-- Uma linha por alvo de varredura (hoje 'orphan-scan:contas/' e
-- 'orphan-scan:briefing-audio/'). Sem FK para nada: é estado de
-- infraestrutura, não dado de tenant.
-- =====================================================================

create table if not exists cron_scan_state (
  -- '<scan>:<prefixo>' — ver SCAN_TARGETS em orphan-scan.ts.
  scan_key            text primary key,
  -- ContinuationToken do R2 para a PRÓXIMA execução.
  -- NULL = recomeçar o ciclo do início do prefixo.
  continuation_token  text,
  -- Início do ciclo em andamento: (now() - cycle_started_at) é quanto tempo
  -- uma varredura completa do prefixo está levando. É a métrica que diz se
  -- ORPHAN_SCAN_PAGES_PER_RUN precisa subir.
  cycle_started_at    timestamptz not null default now(),
  cycles_completed    bigint      not null default 0,
  updated_at          timestamptz not null default now()
);

comment on table cron_scan_state is
  'Checkpoint de varreduras paginadas de bucket (orphan scan). Service-role only.';

alter table cron_scan_state enable row level security;

drop policy if exists service_role_bypass_cron_scan_state on cron_scan_state;
create policy service_role_bypass_cron_scan_state on cron_scan_state
  for all to service_role using (true) with check (true);

-- ---------- Escrita do checkpoint -------------------------------------
-- Uma chamada só: posição, relógio do ciclo e contador andam juntos. Feito
-- como upsert em statement único para não depender de leitura-antes-de-escrita
-- (duas execuções concorrentes do cron não podem se sobrescrever pela metade).
create or replace function record_scan_checkpoint(
  p_scan_key        text,
  p_token           text,
  p_cycle_completed boolean
) returns void
language sql
security definer
set search_path = public
as $$
  insert into cron_scan_state (scan_key, continuation_token, cycles_completed, updated_at)
  values (p_scan_key, p_token, case when p_cycle_completed then 1 else 0 end, now())
  on conflict (scan_key) do update
    set continuation_token = excluded.continuation_token,
        updated_at         = now(),
        cycles_completed   = cron_scan_state.cycles_completed
                             + case when p_cycle_completed then 1 else 0 end,
        cycle_started_at   = case when p_cycle_completed
                                  then now()
                                  else cron_scan_state.cycle_started_at end;
$$;

revoke all on function record_scan_checkpoint(text, text, boolean) from public;
revoke all on function record_scan_checkpoint(text, text, boolean) from anon;
revoke all on function record_scan_checkpoint(text, text, boolean) from authenticated;
grant execute on function record_scan_checkpoint(text, text, boolean) to service_role;
