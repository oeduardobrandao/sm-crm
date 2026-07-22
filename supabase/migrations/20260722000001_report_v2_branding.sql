-- Report v2 branding: splash art upload + deprecate v1-only branding fields
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS report_splash_url text;

COMMENT ON COLUMN workspaces.report_splash_url IS
  'Public URL of the agency-uploaded report cover splash art (avatars bucket, mirrors logo_url). NULL = typographic cover.';
COMMENT ON COLUMN workspaces.report_secondary_color IS 'DEPRECATED 2026-07-22: unused by report v2 template';
COMMENT ON COLUMN workspaces.report_accent_color   IS 'DEPRECATED 2026-07-22: unused by report v2 template';
COMMENT ON COLUMN workspaces.report_font_family    IS 'DEPRECATED 2026-07-22: unused by report v2 template';
COMMENT ON COLUMN workspaces.report_theme          IS 'DEPRECATED 2026-07-22: unused by report v2 template';
