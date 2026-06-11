-- Resource count enforcement triggers (block-new; existing rows untouched).
drop trigger if exists trg_limit_clientes on clientes;
create trigger trg_limit_clientes before insert on clientes
  for each row execute function enforce_plan_count_limit('max_clients', 'direct', 'conta_id', 'conta_id');

drop trigger if exists trg_limit_leads on leads;
create trigger trg_limit_leads before insert on leads
  for each row execute function enforce_plan_count_limit('max_leads', 'direct', 'conta_id', 'conta_id');

-- login seats: workspace_members is scoped by workspace_id (not conta_id)
drop trigger if exists trg_limit_seats on workspace_members;
create trigger trg_limit_seats before insert on workspace_members
  for each row execute function enforce_plan_count_limit('max_team_members', 'direct', 'workspace_id', 'workspace_id');

drop trigger if exists trg_limit_hub_tokens on client_hub_tokens;
create trigger trg_limit_hub_tokens before insert on client_hub_tokens
  for each row execute function enforce_plan_count_limit('max_hub_tokens', 'direct', 'conta_id', 'conta_id');

drop trigger if exists trg_limit_templates on workflow_templates;
create trigger trg_limit_templates before insert on workflow_templates
  for each row execute function enforce_plan_count_limit('max_workflow_templates', 'direct', 'conta_id', 'conta_id');

-- instagram_accounts has no conta_id: resolve + count through clientes
drop trigger if exists trg_limit_instagram on instagram_accounts;
create trigger trg_limit_instagram before insert on instagram_accounts
  for each row execute function enforce_plan_count_limit('max_instagram_accounts', 'via_clientes', 'client_id', '');
