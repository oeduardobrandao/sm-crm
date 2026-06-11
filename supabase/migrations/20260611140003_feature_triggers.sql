drop trigger if exists trg_feature_ideias on ideias;
create trigger trg_feature_ideias before insert on ideias
  for each row execute function enforce_plan_feature('feature_ideas', 'direct', 'workspace_id');

drop trigger if exists trg_feature_financial on transacoes;
create trigger trg_feature_financial before insert on transacoes
  for each row execute function enforce_plan_feature('feature_financial', 'direct', 'conta_id');

drop trigger if exists trg_feature_contracts on contratos;
create trigger trg_feature_contracts before insert on contratos
  for each row execute function enforce_plan_feature('feature_contracts', 'direct', 'conta_id');

drop trigger if exists trg_feature_leads on leads;
create trigger trg_feature_leads before insert on leads
  for each row execute function enforce_plan_feature('feature_leads', 'direct', 'conta_id');

drop trigger if exists trg_feature_hub_tokens on client_hub_tokens;
create trigger trg_feature_hub_tokens before insert on client_hub_tokens
  for each row execute function enforce_plan_feature('feature_hub_portal', 'direct', 'conta_id');

drop trigger if exists trg_feature_custom_props on template_property_definitions;
create trigger trg_feature_custom_props before insert on template_property_definitions
  for each row execute function enforce_plan_feature('feature_custom_properties', 'direct', 'conta_id');

-- brand: block edits too (INSERT OR UPDATE); hub_brand + hub_brand_files are scoped via clientes
drop trigger if exists trg_feature_brand on hub_brand;
create trigger trg_feature_brand before insert or update on hub_brand
  for each row execute function enforce_plan_feature('feature_brand_customization', 'via_clientes', 'cliente_id');

drop trigger if exists trg_feature_brand_files on hub_brand_files;
create trigger trg_feature_brand_files before insert or update on hub_brand_files
  for each row execute function enforce_plan_feature('feature_brand_customization', 'via_clientes', 'cliente_id');
