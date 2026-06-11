-- Resource count enforcement triggers (block-new; existing rows untouched).
drop trigger if exists trg_limit_clientes on clientes;
create trigger trg_limit_clientes before insert on clientes
  for each row execute function enforce_plan_count_limit('max_clients', 'direct', 'conta_id', 'conta_id');
