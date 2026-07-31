-- Candidate RPCs + atomic claim for the Loops marketing sweep.
-- Spec: docs/superpowers/specs/2026-07-31-loops-lifecycle-marketing-emails-design.md
--
-- Shared predicates in every candidate RPC:
--   1. profiles.marketing_opt_in = true, for the ONE deterministically chosen owner
--   2. effective free plan (null plan_id resolves to the is_default plan)
--   3. 72h cap (prefilter only; claim_marketing_email is the authority)
--   4. ledger exclusion: undelivered, stale >1h, attempts < 20
--
-- Note on the 20 vs. 20260730000001's 30: not an inconsistency. Both vendors
-- dedupe on a 24h Idempotency-Key window (_shared/loops.ts documents Loops'
-- events/send 409 the same way that ledger's header documents Resend's), but
-- this sweep deliberately gives up sooner -- 20 hourly retries, not 30 -- so a
-- permanently unreachable Loops recipient surfaces in cron_failures a day
-- earlier than the welcome/thank-you path does.

-- Helper: the single default plan id. plans has a unique partial index
-- guaranteeing at most one is_default row (20260501000002).
create or replace function default_plan_id()
returns text language sql stable set search_path = public as $$
  select id from plans where is_default limit 1
$$;

-- ---------------------------------------------------------------------------
-- Atomic claim. Returns true if the caller won.
--
-- Why a function and not a predicate: two overlapping cron runs both SELECT
-- before either writes, so run A can pick paywall_hit and run B
-- checkout_abandoned for the SAME workspace and both pass a SELECT-time cap.
-- The per-type idempotency key cannot help — it dedupes a type against itself,
-- never two different types against each other.
--
-- The advisory lock is transaction-scoped: it releases on commit or crash with
-- no cleanup path to get wrong.
-- ---------------------------------------------------------------------------
create or replace function claim_marketing_email(
  p_email_type text,
  p_workspace_id uuid,
  p_user_id uuid,
  p_attempts int
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));

  -- Send-time re-check, inside the lock rather than as a separate round trip.
  -- Between the candidate RPC's SELECT and this call the workspace can have
  -- subscribed, the user can have revoked consent, or the user can have LOST
  -- the workspace (removed from workspace_members, or demoted out of 'owner').
  -- Re-verifying here makes the decision atomic with the claim; a separate query
  -- would reopen the same race it is meant to close.
  if not exists (
    select 1 from profiles p
    where p.id = p_user_id and p.marketing_opt_in = true
  ) then
    return false;
  end if;

  -- Membership re-check. NOT redundant with the candidate RPCs' own owner join,
  -- and must not be deleted as such: the sweep processes up to 50 candidates in
  -- a loop, so up to roughly a minute passes between the RPC's SELECT and this
  -- call. In that window an owner can be removed from workspace_members or
  -- demoted. All three checks above still pass -- the ex-owner's profile still
  -- exists with consent, and the workspace is still free -- so without this the
  -- claim succeeds and the cron sends that person a Loops event carrying
  -- workspaceName, planName and clientCount. Someone just removed from an
  -- agency would receive marketing naming that agency and its client count.
  --
  -- It checks that p_user_id is still THE deterministically selected owner, not
  -- merely *an* owner: if the pick would now resolve to a different person,
  -- sending to the stale pick is wrong regardless of disclosure. The ORDER BY
  -- below is copied verbatim from the owner lateral in
  -- get_paywall_hit_candidates / get_abandoned_checkout_candidates. Keep the two
  -- in lockstep -- if they diverge, the claim and the candidate RPCs disagree
  -- about who the recipient is, which is the same bug from the other direction.
  --
  -- This also serves get_dormant_signup_candidates, which establishes ownership
  -- differently (it drives from auth.users and joins workspace_members wm on
  -- wm.user_id = u.id and wm.workspace_id = ws.id and wm.role = 'owner', with
  -- ws.created_by = u.id). Whenever that RPC's conditions hold, this lateral
  -- resolves to the same user: the leading (wm.user_id = ws.created_by) desc
  -- tiebreak puts the creator first, and at most one member can equal
  -- ws.created_by. So the workspace-scoped pick is the correct re-check for the
  -- dormant path too.
  --
  -- Refusing writes no ledger row, so the workspace simply becomes eligible
  -- again on a later sweep, with whoever the correct owner is by then.
  if not exists (
    select 1
    from workspaces ws
    cross join lateral (
      select wm.user_id from workspace_members wm
      where wm.workspace_id = ws.id and wm.role = 'owner'
      order by (wm.user_id = ws.created_by) desc, wm.joined_at asc, wm.user_id asc
      limit 1
    ) o
    where ws.id = p_workspace_id and o.user_id = p_user_id
  ) then
    return false;
  end if;

  if not exists (
    select 1 from workspaces w
    where w.id = p_workspace_id
      and coalesce(w.plan_id, default_plan_id()) = default_plan_id()
  ) then
    return false;
  end if;

  if exists (
    select 1 from workspace_subscriptions s
    where s.workspace_id = p_workspace_id and s.status in ('trialing', 'active')
  ) then
    return false;
  end if;

  if exists (
    select 1 from lifecycle_emails
    where workspace_id = p_workspace_id
      and email_type in ('paywall_hit', 'checkout_abandoned', 'dormant_signup')
      and sent_at > now() - interval '72 hours'
      and (delivered_at is not null or sent_at > now() - interval '1 hour')
  ) then
    return false;
  end if;

  -- dormant_signup dedupes on (email_type, user_id) but also carries
  -- workspace_id, because the 72h cap above (and every candidate RPC's own
  -- prefilter) queries lifecycle_emails by workspace_id. The other two types
  -- dedupe on (email_type, workspace_id) and MUST leave user_id NULL: the
  -- ledger's header comment (20260730000001) documents the invariant that
  -- each email type populates only its own keying column, "so the cross-type
  -- NULL columns never collide". Writing user_id here too breaks that -- a
  -- user who owns two free workspaces (W1, W2) can have claim(paywall_hit, W1)
  -- succeed, and once W2 becomes independently eligible, claim(paywall_hit,
  -- W2) finds no conflict on the (email_type, workspace_id) arbiter, inserts,
  -- and trips the OTHER unique constraint, lifecycle_emails_user_type, on
  -- (paywall_hit, user_id) -- a conflict on a non-arbiter index is not caught
  -- by ON CONFLICT; it raises and fails the whole cron batch.
  if p_email_type = 'dormant_signup' then
    insert into lifecycle_emails (email_type, workspace_id, user_id, sent_at, attempts)
    values (p_email_type, p_workspace_id, p_user_id, now(), p_attempts)
    on conflict (email_type, user_id) do update
      set sent_at = now(), attempts = excluded.attempts, workspace_id = excluded.workspace_id;
  else
    insert into lifecycle_emails (email_type, workspace_id, sent_at, attempts)
    values (p_email_type, p_workspace_id, now(), p_attempts)
    on conflict (email_type, workspace_id) do update
      set sent_at = now(), attempts = excluded.attempts;
  end if;

  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Vendor-identity ledger write. Returns true if the caller may now talk to
-- Loops about this person, false if it must skip them this sweep.
--
-- WHY THIS IS CALLED BEFORE EVERY LOOPS CALL, INCLUDING events/send:
-- Loops' own docs for POST /events/send state that "if a contact is not found,
-- a new contact will be created using both email and userId values". So the
-- TRIGGER path creates contacts at the vendor exactly like contacts/update
-- does. Recording after the call -- or not at all, as the trigger sweeps
-- originally did -- means a contact can exist at Loops with NOTHING in our
-- system recording it, which makes a later consent revocation, email change or
-- account deletion impossible to honour. Do not remove the trigger-path call as
-- "redundant, only updateContact creates contacts": it does not, and the residue
-- is permanent.
--
-- Record-FIRST is strictly safe in the other direction: a row written for a
-- contact that then failed to be created at Loops resolves to a 404 on the
-- eventual delete, and deleteContact (_shared/loops.ts) treats 404 as success.
--
-- THE REFUSAL IS THE WHOLE POINT OF THE FUNCTION. A naive upsert with
-- `deleted_at = null` would reintroduce, on the trigger path, the exact race
-- that get_loops_trait_candidates' pending-deletion `not exists` predicate was
-- added to close:
--   1. lc row holds synced_email = old@x, deleted_at null.
--   2. The user changes their email to new@x.
--   3. The deletion sweep's delete of old@x fails transiently, so deleted_at
--      stays null.
--   4. A trigger sweep upserts synced_email = new@x -- and old@x is now
--      unreachable by get_loops_contact_deletions on ANY branch, stranding that
--      person's name and address at a US vendor forever.
-- loops_contacts.user_id is UNIQUE (one row per person, by design, because the
-- row must survive account deletion), so the old address cannot simply be kept
-- alongside the new one. Refusing instead is the same bounded, self-healing
-- tradeoff the trait path already takes: the deletion is retried every sweep, so
-- the record -- and the email -- land a run or two later. And refusing to email
-- someone while a deletion we owe them is still outstanding is the correct
-- behaviour on its own terms, not merely a bookkeeping convenience.
-- ---------------------------------------------------------------------------
create or replace function record_loops_contact(p_user_id uuid, p_email text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  -- Own lock namespace, not the workspace one claim_marketing_email uses: a
  -- collision would only serialise unrelated callers, but the prefix keeps the
  -- two independent. Transaction-scoped, so it releases on commit or crash.
  perform pg_advisory_xact_lock(hashtextextended('loops_contact:' || p_user_id::text, 0));

  if exists (
    select 1 from loops_contacts lc
    where lc.user_id = p_user_id
      and lc.deleted_at is null
      and lc.synced_email is distinct from p_email
  ) then
    return false;
  end if;

  insert into loops_contacts (user_id, synced_email, synced_at, deleted_at)
  values (p_user_id, p_email, now(), null)
  on conflict (user_id) do update
    set synced_email = excluded.synced_email,
        synced_at    = excluded.synced_at,
        deleted_at   = null;

  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Candidate RPCs
-- ---------------------------------------------------------------------------

create or replace function get_paywall_hit_candidates()
returns table (
  workspace_id uuid, workspace_name text, owner_user_id uuid, owner_email text,
  owner_nome text, plan_name text, client_count int, feature text,
  clicked_upgrade boolean, attempts int
)
language sql security definer set search_path = public as $$
  select ws.id, ws.name, o.user_id, u.email::text, p.nome,
         pl.name, (select count(*)::int from clientes c where c.conta_id = ws.id),
         h.feature, hc.clicked_upgrade, coalesce(le.attempts, 0)
  from workspaces ws
  cross join lateral (
    select wm.user_id from workspace_members wm
    where wm.workspace_id = ws.id and wm.role = 'owner'
    order by (wm.user_id = ws.created_by) desc, wm.joined_at asc, wm.user_id asc
    limit 1
  ) o
  join auth.users u on u.id = o.user_id
  join profiles p on p.id = o.user_id
  left join plans pl on pl.id = coalesce(ws.plan_id, default_plan_id())
  -- Two separate laterals, deliberately: the most recent feature and whether
  -- ANY hit in the window was an upgrade click are different aggregations over
  -- the same rows. Combining them with a window function under LIMIT 1 works but
  -- reads as a bug and breaks the moment someone adds an ORDER BY.
  cross join lateral (
    select ph.feature
    from paywall_hits ph
    where ph.workspace_id = ws.id and ph.hit_at > now() - interval '7 days'
    order by ph.hit_at desc
    limit 1
  ) h
  cross join lateral (
    select coalesce(bool_or(ph.clicked_upgrade), false) as clicked_upgrade
    from paywall_hits ph
    where ph.workspace_id = ws.id and ph.hit_at > now() - interval '7 days'
  ) hc
  left join lifecycle_emails le
    on le.email_type = 'paywall_hit' and le.workspace_id = ws.id
  where p.marketing_opt_in = true
    and u.email is not null
    and coalesce(ws.plan_id, default_plan_id()) = default_plan_id()
    -- A trialing/active subscription with plan_id still resolving to the
    -- default plan (webhook lag, manual Stripe action, plan_source='manual'
    -- drift) must not be treated as free: without this, the claim's own
    -- subscription check refuses every run before writing any ledger row, so
    -- nothing ever removes the workspace from the candidate set and it
    -- accumulates at the head of the ORDER BY / LIMIT 50 batch forever.
    and not exists (
      select 1 from workspace_subscriptions s
      where s.workspace_id = ws.id and s.status in ('trialing', 'active')
    )
    and not exists (
      select 1 from lifecycle_emails le2
      where le2.workspace_id = ws.id
        and le2.email_type in ('paywall_hit', 'checkout_abandoned', 'dormant_signup')
        and le2.sent_at > now() - interval '72 hours'
        and (le2.delivered_at is not null or le2.sent_at > now() - interval '1 hour')
    )
    and (le.id is null
         or (le.delivered_at is null
             and le.sent_at <= now() - interval '1 hour'
             and le.attempts < 20))
  order by ws.created_at asc, ws.id asc
  limit 50
$$;

create or replace function get_abandoned_checkout_candidates()
returns table (
  workspace_id uuid, workspace_name text, owner_user_id uuid, owner_email text,
  owner_nome text, plan_name text, hours_since_attempt int, attempts int
)
language sql security definer set search_path = public as $$
  select ws.id, ws.name, o.user_id, u.email::text, p.nome,
         pl.name,
         extract(epoch from (now() - a.created_at))::int / 3600,
         coalesce(le.attempts, 0)
  from workspaces ws
  cross join lateral (
    select wm.user_id from workspace_members wm
    where wm.workspace_id = ws.id and wm.role = 'owner'
    order by (wm.user_id = ws.created_by) desc, wm.joined_at asc, wm.user_id asc
    limit 1
  ) o
  join auth.users u on u.id = o.user_id
  join profiles p on p.id = o.user_id
  cross join lateral (
    select ca.created_at, ca.plan_id from checkout_attempts ca
    where ca.workspace_id = ws.id
    order by ca.created_at desc
    limit 1
  ) a
  left join plans pl on pl.id = a.plan_id
  left join lifecycle_emails le
    on le.email_type = 'checkout_abandoned' and le.workspace_id = ws.id
  where p.marketing_opt_in = true
    and u.email is not null
    and a.created_at <= now() - interval '24 hours'
    and coalesce(ws.plan_id, default_plan_id()) = default_plan_id()
    -- A cancelled workspace keeps its subscription mirror row, so row existence
    -- is NOT a proxy for paid. Check status.
    and not exists (
      select 1 from workspace_subscriptions s
      where s.workspace_id = ws.id and s.status in ('trialing', 'active')
    )
    and not exists (
      select 1 from lifecycle_emails le2
      where le2.workspace_id = ws.id
        and le2.email_type in ('paywall_hit', 'checkout_abandoned', 'dormant_signup')
        and le2.sent_at > now() - interval '72 hours'
        and (le2.delivered_at is not null or le2.sent_at > now() - interval '1 hour')
    )
    and (le.id is null
         or (le.delivered_at is null
             and le.sent_at <= now() - interval '1 hour'
             and le.attempts < 20))
  order by a.created_at asc, ws.id asc
  limit 50
$$;

create or replace function get_dormant_signup_candidates()
returns table (
  workspace_id uuid, workspace_name text, owner_user_id uuid, owner_email text,
  owner_nome text, days_since_signup int, attempts int
)
language sql security definer set search_path = public as $$
  -- dormant_signup is a USER-scoped email -- its ledger row keys on user_id,
  -- not workspace_id (claim_marketing_email's dormant_signup branch dedupes
  -- on (email_type, user_id), unlike the workspace-scoped types). The
  -- ws.created_by = u.id join below fans out one row per workspace a user
  -- self-created, so a user who created TWO qualifying free workspaces (both
  -- in the 3-14 day window, both with zero clientes) would otherwise be
  -- returned TWICE. Nothing downstream catches that: the two workspaces take
  -- different advisory locks, the 72h cap is keyed by workspace_id so the
  -- second workspace's check never sees the first claim. The Loops
  -- idempotency key is dormant_signup/<user_id> (user-scoped, not
  -- workspace-scoped -- see the handler.ts comment), so a duplicate row here
  -- would still cost a second claim upsert and a second outbound Loops call
  -- even though the 409 Loops returns on the reused key stops it from
  -- becoming a second email. Net effect without the fix below would be
  -- redundant claim/send round trips per extra workspace, not a clean no-op.
  --
  -- `distinct on (u.id)` in the inner subquery collapses this to exactly one
  -- row per user, picking the OLDEST qualifying workspace
  -- (ws.created_at asc, ws.id asc tiebreak) so the choice is stable across
  -- sweeps rather than varying between runs. Do NOT flatten this back into a
  -- single-level query or replace it with a bare `select distinct`: unlike
  -- get_welcome_email_candidates' distinct fix (20260730000001), this
  -- function's returned columns (workspace_id, workspace_name) genuinely
  -- differ per candidate workspace and must be picked, not deduped away by a
  -- distinct over the whole row. get_welcome_email_candidates hit the
  -- identical ws.created_by = u.id trap; read its comment for the shape this
  -- borrows.
  select d.workspace_id, d.workspace_name, d.owner_user_id, d.owner_email,
         d.owner_nome, d.days_since_signup, d.attempts
  from (
    select distinct on (u.id)
           ws.id as workspace_id, ws.name as workspace_name, u.id as owner_user_id,
           u.email::text as owner_email, p.nome as owner_nome,
           extract(epoch from (now() - u.email_confirmed_at))::int / 86400 as days_since_signup,
           coalesce(le.attempts, 0) as attempts,
           u.email_confirmed_at
    from auth.users u
    join workspaces ws on ws.created_by = u.id
    join workspace_members wm
      on wm.user_id = u.id and wm.workspace_id = ws.id and wm.role = 'owner'
    join profiles p on p.id = u.id
    left join lifecycle_emails le
      on le.email_type = 'dormant_signup' and le.user_id = u.id
    where p.marketing_opt_in = true
      and u.email is not null
      and u.email_confirmed_at is not null
      and u.email_confirmed_at <= now() - interval '3 days'
      and u.email_confirmed_at >= now() - interval '14 days'
      -- Self-serve discriminator: BOTH halves required. The invite-path fallback
      -- in 20260719000002 sets created_by to the INVITED user when no workspace
      -- exists, which the created_by join alone would misclassify as self-serve.
      and nullif(u.raw_user_meta_data ->> 'conta_id', '') is null
      and coalesce(ws.plan_id, default_plan_id()) = default_plan_id()
      -- Same reasoning as get_paywall_hit_candidates: plan_id drift must not
      -- masquerade as free while a subscription is actually trialing/active,
      -- or the claim refuses forever and this candidate never clears.
      and not exists (
        select 1 from workspace_subscriptions s
        where s.workspace_id = ws.id and s.status in ('trialing', 'active')
      )
      and not exists (select 1 from clientes c where c.conta_id = ws.id)
      and not exists (
        select 1 from lifecycle_emails le2
        where le2.workspace_id = ws.id
          and le2.email_type in ('paywall_hit', 'checkout_abandoned', 'dormant_signup')
          and le2.sent_at > now() - interval '72 hours'
          and (le2.delivered_at is not null or le2.sent_at > now() - interval '1 hour')
      )
      and (le.id is null
           or (le.delivered_at is null
               and le.sent_at <= now() - interval '1 hour'
               and le.attempts < 20))
    order by u.id, ws.created_at asc, ws.id asc
  ) d
  order by d.email_confirmed_at asc, d.owner_user_id asc
  limit 50
$$;

-- Person-level traits only. Workspace facts (name, plan, client count) travel
-- in event properties instead: Loops keys contacts by email, and one person can
-- own several workspaces (max_workspaces_per_user is a real entitlement), so
-- per-workspace traits would be clobbered by whichever workspace synced last.
--
-- PENDING-DELETION EXCLUSION (the `not exists` in the WHERE clause below): do
-- NOT remove it as redundant with the deletion sweep. It closes a race that
-- leaves PII resident at Loops FOREVER, with nothing left in our system that
-- records it:
--   1. U's loops_contacts row holds synced_email = old@x.com, deleted_at null.
--   2. U changes their email to new@x.com.
--   3. The deletion sweep runs FIRST (handler.ts orders it first, deliberately)
--      and get_loops_contact_deletions selects the row on its
--      `u.email is distinct from lc.synced_email` branch. deleteContact
--      (old@x.com) fails TRANSIENTLY -- a network blip. The handler tolerates
--      and logs that by design, so deleted_at is NOT stamped.
--   4. Without this exclusion the trait sweep, which runs LAST in the same
--      invocation, still returns U. recordContactSync upserts on user_id and
--      overwrites synced_email = new@x.com, deleted_at = null.
--   5. u.email now EQUALS lc.synced_email, so get_loops_contact_deletions can
--      never select that row again on any branch.
--   6. The Loops contact for old@x.com -- that person's name and email address
--      -- stays at the vendor permanently. One transient failure, unrecoverable
--      PII residue, in the consent architecture that exists for LGPD.
-- Excluding the user costs nothing: deletions are retried every sweep, so the
-- deletion lands on a later run, deleted_at gets stamped, and the trait sync
-- resumes on the run after that. The delay is bounded and it self-heals.
--
-- record_loops_contact enforces the same predicate atomically at write time and
-- is the last line of defence (it also covers the trigger sweeps, which have no
-- candidate-side exclusion at all). This one stays because it is cheaper to
-- never select the candidate than to select it and refuse the write, and
-- because it keeps the reason visible where the candidate set is defined.
--
-- Only the email-change branch of get_loops_contact_deletions can collide here,
-- which is why the predicate mirrors exactly that branch. The other two branches
-- are already excluded upstream and must stay that way:
--   * consent revoked (p.marketing_opt_in is distinct from true) -- this RPC's
--     own `p.marketing_opt_in = true` filter drops the user for as long as the
--     deletion is owed. If they later re-consent WITHOUT changing their email,
--     the contact at Loops is legitimately wanted again and matches
--     synced_email, so no residue exists to clean up.
--   * account deleted (lc.user_id is null, via loops_contacts' FK ON DELETE SET
--     NULL) -- there is no auth.users row left for this RPC's join to return,
--     and recordContactSync only ever upserts a NON-NULL user_id, so it can
--     never touch that orphan row. It stays selectable by the deletion sweep
--     indefinitely.
create or replace function get_loops_trait_candidates()
returns table (
  user_id uuid, email text, nome text, days_since_signup int,
  workspace_count int, any_free boolean
)
language sql security definer set search_path = public as $$
  select u.id, u.email::text, p.nome,
         extract(epoch from (now() - u.email_confirmed_at))::int / 86400,
         count(ws.id)::int,
         -- any_free MUST stay consistent with the event RPCs' definition of a
         -- free workspace: effective default plan AND no trialing/active
         -- subscription. plan_id alone is not sufficient -- it drifts out of
         -- sync with the real subscription state (Stripe webhook lag, a manual
         -- action in the Stripe dashboard, plan_source = 'manual'), which is
         -- exactly why all three event RPCs carry the same workspace_subscriptions
         -- exclusion. If the two definitions diverge again, a genuinely paying
         -- customer whose plan_id still resolves to the default plan reports
         -- any_free = true, and the trait sync files them into whatever Loops
         -- segment keys on it -- free-to-paid campaigns targeting someone who
         -- already pays. The symptom is silent mis-segmentation that nobody
         -- notices, so keep this expression and the RPCs' clause in lockstep.
         --
         -- The subscription exclusion belongs INSIDE the per-workspace
         -- expression bool_or aggregates, never in the WHERE clause: a WHERE
         -- would drop the user's paid workspaces from the row set entirely and
         -- silently deflate workspace_count, which must stay a count of ALL
         -- owned workspaces regardless of plan. A correlated `not exists` is
         -- used rather than a join partly to keep this byte-identical to the
         -- clause the three event RPCs carry, and partly because it cannot
         -- affect count(ws.id) even if workspace_subscriptions ever stops being
         -- one row per workspace (today workspace_id is its primary key,
         -- 20260609120003).
         bool_or(
           coalesce(ws.plan_id, default_plan_id()) = default_plan_id()
           and not exists (
             select 1 from workspace_subscriptions s
             where s.workspace_id = ws.id and s.status in ('trialing', 'active')
           )
         )
  from auth.users u
  join profiles p on p.id = u.id
  join workspace_members wm on wm.user_id = u.id and wm.role = 'owner'
  join workspaces ws on ws.id = wm.workspace_id
  left join loops_contacts lc on lc.user_id = u.id
  where p.marketing_opt_in = true
    and u.email is not null
    and u.email_confirmed_at is not null
    -- A contact deletion is OWED at the vendor for this person's previous
    -- address. Syncing traits now would overwrite synced_email and strand that
    -- address at Loops permanently -- see the block comment above this function.
    -- Written as a correlated `not exists` rather than folded into the `lc` left
    -- join below on purpose: for a never-synced user (no lc row), `lc.deleted_at
    -- is null` is TRUE and `lc.synced_email is distinct from u.email::text` is
    -- also TRUE (`is distinct from` is two-valued and never yields NULL), so
    -- `not (lc.deleted_at is null and ...)` evaluates to `not(TRUE and TRUE)` =
    -- FALSE -- which would silently drop everyone who has no loops_contacts row
    -- at all.
    and not exists (
      select 1 from loops_contacts lc2
      where lc2.user_id = u.id
        and lc2.deleted_at is null
        and lc2.synced_email is distinct from u.email::text
    )
  group by u.id, u.email, p.nome, u.email_confirmed_at, lc.synced_at
  -- The ordering IS the convergence mechanism: this RPC has no time window
  -- and no ledger exclusion, so without a rotating order the same first-200
  -- users by uuid would re-sync forever and everyone past #200 would never
  -- sync at all, silently. Never-synced users (lc.synced_at is null, thanks
  -- to loops_contacts.user_id being nullable-unique per Task 2) sort first,
  -- then the stalest previous sync, so each run advances the frontier.
  order by lc.synced_at asc nulls first, u.id
  limit 200
$$;

-- Contacts to remove at Loops: consent revoked, email changed (delete the OLD
-- address), or the account was deleted (user_id nulled by the FK).
create or replace function get_loops_contact_deletions()
returns table (id uuid, synced_email text)
language sql security definer set search_path = public as $$
  select lc.id, lc.synced_email
  from loops_contacts lc
  left join auth.users u on u.id = lc.user_id
  left join profiles p on p.id = lc.user_id
  where lc.deleted_at is null
    and (lc.user_id is null
         or p.marketing_opt_in is distinct from true
         or u.email::text is distinct from lc.synced_email)
  order by lc.synced_at asc
  limit 50
$$;

-- ---------------------------------------------------------------------------
-- Lock everything to the service role.
-- REVOKE FROM PUBLIC alone ALSO strips service_role on this instance (it has
-- bitten this repo before). Grant explicitly, and verify with proacl, not
-- has_function_privilege.
-- ---------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'claim_marketing_email(text,uuid,uuid,int)',
    'record_loops_contact(uuid,text)',
    'get_paywall_hit_candidates()',
    'get_abandoned_checkout_candidates()',
    'get_dormant_signup_candidates()',
    'get_loops_trait_candidates()',
    'get_loops_contact_deletions()',
    'default_plan_id()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Backfill seed: terminal rows so switching the cron on does not blast the
-- entire back catalogue. Same technique as 20260730000001.
-- ---------------------------------------------------------------------------
insert into lifecycle_emails (email_type, workspace_id, delivered_at)
select 'paywall_hit', workspace_id, now() from (
  select distinct workspace_id from paywall_hits
) s
on conflict do nothing;

insert into lifecycle_emails (email_type, workspace_id, delivered_at)
select 'checkout_abandoned', workspace_id, now() from (
  select distinct workspace_id from checkout_attempts
) s
on conflict do nothing;

insert into lifecycle_emails (email_type, user_id, workspace_id, delivered_at)
select distinct 'dormant_signup', u.id, ws.id, now()
from auth.users u
join workspaces ws on ws.created_by = u.id
where u.email_confirmed_at is not null
on conflict do nothing;
