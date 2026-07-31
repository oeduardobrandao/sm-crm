-- Workspace-level Hub white-label customization (Personalizar Hub).
-- Columns are inert data unless the workspace's plan grants
-- feature_brand_customization: hub-bootstrap gates at read time (fail closed),
-- so no enforce_plan_feature trigger here (a trigger on workspaces would fire
-- on billing/plan writes too).

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS hub_surface_theme text NOT NULL DEFAULT 'neutral',
  ADD COLUMN IF NOT EXISTS hub_font_display text NOT NULL DEFAULT 'fraunces',
  ADD COLUMN IF NOT EXISTS hub_font_body text NOT NULL DEFAULT 'instrument-sans',
  ADD COLUMN IF NOT EXISTS hub_radius text NOT NULL DEFAULT 'soft',
  ADD COLUMN IF NOT EXISTS hub_card_style text NOT NULL DEFAULT 'filled',
  ADD COLUMN IF NOT EXISTS hub_logo_style text NOT NULL DEFAULT 'round',
  ADD COLUMN IF NOT EXISTS hub_logo_dark_url text,
  ADD COLUMN IF NOT EXISTS hub_hide_branding boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hub_default_appearance text NOT NULL DEFAULT 'light';

ALTER TABLE workspaces
  ADD CONSTRAINT hub_surface_theme_allowed CHECK (hub_surface_theme IN ('neutral','warm','cool')),
  ADD CONSTRAINT hub_font_display_allowed CHECK (hub_font_display IN ('fraunces','playfair-display','dm-serif-display','space-grotesk','sora','lora')),
  ADD CONSTRAINT hub_font_body_allowed CHECK (hub_font_body IN ('instrument-sans','inter','dm-sans','manrope','public-sans')),
  ADD CONSTRAINT hub_radius_allowed CHECK (hub_radius IN ('square','soft','pill')),
  ADD CONSTRAINT hub_card_style_allowed CHECK (hub_card_style IN ('filled','outline','tonal')),
  ADD CONSTRAINT hub_logo_style_allowed CHECK (hub_logo_style IN ('round','wordmark')),
  ADD CONSTRAINT hub_default_appearance_allowed CHECK (hub_default_appearance IN ('light','dark'));
