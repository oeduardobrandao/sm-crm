-- Backfill + constrain existing brand_color (now used as CSS variable in reports)
UPDATE workspaces SET brand_color = '#eab308'
  WHERE brand_color IS NULL OR brand_color !~ '^#[0-9a-fA-F]{6}$';

ALTER TABLE workspaces
  ALTER COLUMN brand_color SET NOT NULL,
  ALTER COLUMN brand_color SET DEFAULT '#eab308';

-- Separate statement: can't combine SET NOT NULL and ADD CONSTRAINT in one ALTER
ALTER TABLE workspaces
  ADD CONSTRAINT brand_color_hex CHECK (brand_color ~ '^#[0-9a-fA-F]{6}$');

-- New report branding columns on workspaces
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS report_secondary_color text NOT NULL DEFAULT '#1a1e26'
    CHECK (report_secondary_color ~ '^#[0-9a-fA-F]{6}$'),
  ADD COLUMN IF NOT EXISTS report_accent_color text NOT NULL DEFAULT '#3ecf8e'
    CHECK (report_accent_color ~ '^#[0-9a-fA-F]{6}$'),
  ADD COLUMN IF NOT EXISTS report_font_family text NOT NULL DEFAULT 'DM Sans'
    CHECK (report_font_family IN ('DM Sans', 'Inter', 'Poppins', 'Montserrat', 'Plus Jakarta Sans')),
  ADD COLUMN IF NOT EXISTS report_theme text NOT NULL DEFAULT 'dark'
    CHECK (report_theme IN ('dark', 'light')),
  ADD COLUMN IF NOT EXISTS send_report_email boolean NOT NULL DEFAULT false;

-- Per-client report flags
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS send_report_email boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS include_ai_analysis boolean NOT NULL DEFAULT true;

-- New columns on analytics_reports for v2 generator
ALTER TABLE analytics_reports
  ADD COLUMN IF NOT EXISTS html_storage_path text,
  ADD COLUMN IF NOT EXISTS ai_content jsonb,
  ADD COLUMN IF NOT EXISTS ai_status text NOT NULL DEFAULT 'skipped'
    CHECK (ai_status IN ('skipped', 'success', 'validation_failed', 'generation_failed')),
  ADD COLUMN IF NOT EXISTS ai_error text,
  ADD COLUMN IF NOT EXISTS include_ai boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS generation_error text,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0
    CHECK (retry_count >= 0 AND retry_count <= 3),
  ADD COLUMN IF NOT EXISTS last_emailed_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by text;

-- Status constraint (existing column, new constraint)
ALTER TABLE analytics_reports
  ADD CONSTRAINT status_check
    CHECK (status IN ('pending', 'generating', 'ready', 'failed'));

-- Worker index for finding pending/retryable reports
CREATE INDEX IF NOT EXISTS idx_reports_pending_work
  ON analytics_reports(status, retry_count, generated_at)
  WHERE status IN ('pending', 'failed');
