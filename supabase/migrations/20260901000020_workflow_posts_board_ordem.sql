-- Ordem manual do board de Publicacoes.
--
-- board_ordem e um rank fracionario (estilo Trello): NULL = post nunca
-- posicionado manualmente (cai na ordenacao automatica, scheduled_at asc
-- nulls last com desempate por id). O frontend escreve midpoints entre
-- vizinhos e re-materializa a coluna (multiplos de 1024) quando nao ha
-- espaco -- por isso a RPC recebe arrays e atualiza N posts numa chamada.
--
-- Nenhum trigger le esta coluna. O guard post_a0_sync_cliente so dispara
-- quando workflow_id/cliente_id mudam; um UPDATE apenas de board_ordem
-- passa direto. RLS (workspace_posts_all) continua cobrindo escrita direta,
-- mas a RPC e o caminho sancionado por ser atomica para o lote.

alter table workflow_posts add column board_ordem double precision;

create or replace function public.reorder_board_posts(
  p_post_ids bigint[],
  p_ordens double precision[]
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
  if p_post_ids is null or p_ordens is null
     or array_length(p_post_ids, 1) is null
     or array_length(p_post_ids, 1) is distinct from array_length(p_ordens, 1) then
    raise exception 'invalid_arguments' using errcode = 'P0001';
  end if;

  -- Lock em ordem estavel (padrao da casa: FOR UPDATE separado da agregacao).
  perform 1 from workflow_posts
   where id = any(p_post_ids) and conta_id = v_conta
   order by id
   for update;

  -- Posse all-or-nothing. Ids duplicados no array tambem caem aqui: o count
  -- de linhas nunca alcanca array_length com duplicatas.
  select count(*) into v_count
    from workflow_posts
   where id = any(p_post_ids) and conta_id = v_conta;
  if v_count is distinct from array_length(p_post_ids, 1) then
    raise exception 'post_not_found' using errcode = 'P0001';
  end if;

  update workflow_posts wp
     set board_ordem = u.ordem
    from unnest(p_post_ids, p_ordens) as u(id, ordem)
   where wp.id = u.id and wp.conta_id = v_conta;
end;
$$;

revoke all on function public.reorder_board_posts(bigint[], double precision[]) from public, anon;
grant execute on function public.reorder_board_posts(bigint[], double precision[]) to authenticated, service_role;
