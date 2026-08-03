-- Vendor-identity ledger: which email address was actually synced to Crisp.
--
-- Crisp keys person profiles by email, so honouring an erasure, an email change
-- or an account deletion requires knowing the address that was sent. None of
-- that is derivable from live state after the fact.
--
-- on delete SET NULL, deliberately NOT cascade: when the account goes, this row
-- must SURVIVE carrying synced_email, because that is the only remaining handle
-- for deleting the profile at Crisp. A cascade would erase the evidence needed
-- to honour the erasure.
--
-- Hence the surrogate `id` primary key: user_id cannot be the PK, because SET
-- NULL on a primary key column is a constraint violation. A nullable UNIQUE
-- user_id gives the one-row-per-user guarantee AND survives the user's deletion.
--
-- synced_people_id is a CACHE, not a record of what was sent — synced_email is
-- that record. Its only job is to save an email-addressed lookup next sweep, so
-- losing it is harmless and the sweep always recovers by email.
--
-- Spec: docs/superpowers/specs/2026-08-03-crisp-customer-sync-design.md
create table if not exists crisp_contacts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid null unique references auth.users(id) on delete set null,
  synced_email       text not null,
  synced_people_id   text null,
  synced_fingerprint text null,
  synced_at          timestamptz not null default now(),
  deleted_at         timestamptz null
);

create index if not exists crisp_contacts_pending_delete
  on crisp_contacts (deleted_at) where deleted_at is null;

alter table crisp_contacts enable row level security;

drop policy if exists "crisp_contacts_service_role" on crisp_contacts;
create policy "crisp_contacts_service_role" on crisp_contacts
  for all to service_role using (true) with check (true);
