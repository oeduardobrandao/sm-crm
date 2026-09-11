-- Ordem manual do quadro de Fluxos, atomica.
--
-- workflows.position e um inteiro denso por coluna. Ate aqui o CRM gravava
-- N UPDATEs em paralelo (updateWorkflowPositions) e so para os cards VISIVEIS
-- da coluna, entao fluxos ocultos por filtro ficavam com posicoes colidentes.
-- Esta RPC grava o lote inteiro numa chamada, conta-scoped, all-or-nothing
-- na posse, no mesmo desenho de reorder_board_posts (20260901000020).
--
-- Nenhum trigger le position; um UPDATE so dessa coluna nao passa pelo guard
-- post_a0_sync_cliente (que e de workflow_posts). RLS de workflows continua
-- cobrindo escrita direta; a RPC e o caminho sancionado por ser atomica.

create or replace function public.reorder_workflow_positions(
  p_workflow_ids bigint[],
  p_positions integer[]
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conta uuid := public.get_my_conta_id();
  v_count int;
begin
  if v_conta is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if p_workflow_ids is null or p_positions is null
     or array_length(p_workflow_ids, 1) is null
     or array_length(p_workflow_ids, 1) is distinct from array_length(p_positions, 1) then
    raise exception 'invalid_arguments' using errcode = 'P0001';
  end if;
  if array_position(p_positions, null) is not null then
    raise exception 'invalid_arguments' using errcode = 'P0001';
  end if;

  perform 1 from workflows
   where id = any(p_workflow_ids) and conta_id = v_conta
   order by id
   for update;

  -- Ids duplicados no array tambem caem aqui: o count nunca alcanca array_length com duplicatas.
  select count(*) into v_count
    from workflows
   where id = any(p_workflow_ids) and conta_id = v_conta;
  if v_count is distinct from array_length(p_workflow_ids, 1) then
    raise exception 'workflow_not_found' using errcode = 'P0001';
  end if;

  update workflows w
     set position = u.pos
    from unnest(p_workflow_ids, p_positions) as u(id, pos)
   where w.id = u.id and w.conta_id = v_conta;
end;
$$;

revoke all on function public.reorder_workflow_positions(bigint[], integer[]) from public, anon;
grant execute on function public.reorder_workflow_positions(bigint[], integer[]) to authenticated, service_role;
