-- Per-seat display prices (centavos) shown in the CRM cost breakdown.
-- Net-new columns: listActivePlans selects them, so they must exist or the
-- PostgREST select 400s at runtime. Seat price is shared across paid tiers.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS seat_addon_brl int;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS seat_addon_brl_annual int;

UPDATE plans
  SET seat_addon_brl = 2500,
      seat_addon_brl_annual = 25000
  WHERE id IN ('starter', 'agency', 'scale');
