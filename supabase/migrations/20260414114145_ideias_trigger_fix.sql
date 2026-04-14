-- Rename set_updated_at to set_ideias_updated_at to follow codebase naming convention
-- and update the trigger to use the renamed function

create or replace function set_ideias_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Re-create trigger pointing to the correctly named function
drop trigger if exists ideias_updated_at on ideias;

create trigger ideias_updated_at
  before update on ideias
  for each row execute function set_ideias_updated_at();

-- Drop the generic function if no other triggers depend on it
drop function if exists set_updated_at();
