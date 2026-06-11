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

-- active workflows per client: scope cliente_id, only status='ativo'
-- WHEN guard ensures the trigger only fires for active inserts (not arquivado/concluido),
-- so archived inserts are never blocked by the active-workflow limit.
-- NOTE: BEFORE INSERT only — promoting an existing arquivado row to 'ativo' via UPDATE is
-- not blocked here (matches the "block new" policy); enforce at the app layer if needed.
drop trigger if exists trg_limit_workflows on workflows;
create trigger trg_limit_workflows before insert on workflows
  for each row when (new.status = 'ativo')
  execute function enforce_plan_count_limit(
    'max_active_workflows_per_client', 'direct', 'conta_id', 'cliente_id', 'status = ''ativo''');

-- custom properties per template
drop trigger if exists trg_limit_custom_props on template_property_definitions;
create trigger trg_limit_custom_props before insert on template_property_definitions
  for each row execute function enforce_plan_count_limit(
    'max_custom_properties_per_template', 'direct', 'conta_id', 'template_id');

-- posts per workflow
drop trigger if exists trg_limit_posts on workflow_posts;
create trigger trg_limit_posts before insert on workflow_posts
  for each row execute function enforce_plan_count_limit(
    'max_posts_per_workflow', 'direct', 'conta_id', 'workflow_id');
