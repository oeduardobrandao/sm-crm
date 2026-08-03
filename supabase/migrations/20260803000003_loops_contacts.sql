-- Vendor-identity ledger: which email address was actually synced to Loops.
--
-- Loops keys contacts by email, so honouring a consent revocation, an email
-- change, or an account deletion requires knowing the address that was sent.
-- None of that is derivable from live state after the fact.
--
-- on delete SET NULL, deliberately NOT cascade: when the account goes, this row
-- must SURVIVE carrying synced_email, because that is the only remaining handle
-- for deleting the contact at Loops. A cascade would erase the evidence needed
-- to honour the erasure.
--
-- Hence the surrogate `id` primary key: user_id cannot be the PK, because SET
-- NULL on a primary key column is a constraint violation. A nullable UNIQUE
-- user_id gives the one-row-per-user guarantee AND survives the user's
-- deletion; the PK guarantees the row remains addressable afterwards, which is
-- what markContactDeleted(id) needs.
create table if not exists loops_contacts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid null unique references auth.users(id) on delete set null,
  synced_email text not null,
  synced_at    timestamptz not null default now(),
  deleted_at   timestamptz null
);

create index if not exists loops_contacts_pending_delete
  on loops_contacts (deleted_at) where deleted_at is null;

alter table loops_contacts enable row level security;

create policy "loops_contacts_service_role" on loops_contacts
  for all to service_role using (true) with check (true);
