import { useEffect, useState, type CSSProperties } from 'react';
// Cross-boundary import, same precedent as ReportPreview.tsx importing the report
// template's theme resolver: the preview must render with the EXACT resolver the
// real Hub uses, not a hand-copied approximation that can drift from it. `apps/hub`
// isn't a workspace dependency of `apps/crm`, so this reaches across the monorepo by
// relative path instead of a package import.
import {
  resolveHubTheme,
  DEFAULT_HUB_THEME,
  buildGoogleFontsHref,
  HUB_DISPLAY_FONTS,
  HUB_BODY_FONTS,
  type HubSurface,
  type HubRadius,
  type HubCardStyle,
  type HubThemeConfig,
} from '../../../../hub/src/theme';

export interface HubPreviewDraft {
  brandColor: string;
  surface: HubSurface;
  fontDisplay: string;
  fontBody: string;
  radius: HubRadius;
  cardStyle: HubCardStyle;
  logoStyle: string;
  logoDarkUrl: string | null;
  hideBranding: boolean;
  defaultAppearance: string;
}

interface HubPreviewProps {
  draft: HubPreviewDraft;
  workspaceName: string;
  workspaceLogoUrl: string | null;
  /** Whether the workspace's plan actually grants feature_brand_customization. Un-entitled
   * workspaces see what the Hub renders for them TODAY: DEFAULT_HUB_THEME plus their accent
   * (brand_color editing is ungated), never the draft's customization picks. */
  customized: boolean;
}

const GOOGLE_FONTS_LINK_ID = 'crm-hub-preview-fonts';

const NAV_ITEMS = ['Início', 'Postagens', 'Aprovações', 'Marca'];
const ACTIVE_NAV_INDEX = 1;
const CALENDAR_DAYS = [18, 19, 20, 21, 22];
const ACCENT_DAY_INDEX = 2;

/**
 * Pure presentational miniature of the client Hub: sidebar + main content, resolved
 * through the REAL `resolveHubTheme`. No data fetching, no persistence — every value
 * comes from `draft` so the settings tab can preview edits before "Salvar".
 *
 * The wrapper div carries the resolved CSS variables inline (never :root — this sits
 * inside the CRM, which has its own global theme). It also owns its own light/dark
 * toggle so the agency can check both without leaving Configurações, independent of
 * `hub_default_appearance` (which only sets the client's FIRST visit).
 */
export function HubPreview({
  draft,
  workspaceName,
  workspaceLogoUrl,
  customized,
}: HubPreviewProps) {
  const [dark, setDark] = useState(draft.defaultAppearance === 'dark');

  useEffect(() => {
    const href = buildGoogleFontsHref(draft.fontDisplay, draft.fontBody);
    const existing = document.getElementById(GOOGLE_FONTS_LINK_ID) as HTMLLinkElement | null;
    if (!href) {
      existing?.remove();
      return;
    }
    const link = existing ?? document.createElement('link');
    link.id = GOOGLE_FONTS_LINK_ID;
    link.rel = 'stylesheet';
    link.href = href;
    if (!existing) document.head.appendChild(link);
  }, [draft.fontDisplay, draft.fontBody]);

  // Remove the preview's font link when the tab is left — nothing else on the page
  // needs Fraunces/Sora/etc. loaded once Configurações → Hub is no longer mounted.
  useEffect(() => {
    return () => {
      document.getElementById(GOOGLE_FONTS_LINK_ID)?.remove();
    };
  }, []);

  const config: HubThemeConfig = customized
    ? {
        accent: draft.brandColor,
        surface: draft.surface,
        fontDisplay: draft.fontDisplay,
        fontBody: draft.fontBody,
        radius: draft.radius,
        cardStyle: draft.cardStyle,
        customized: true,
      }
    : { ...DEFAULT_HUB_THEME, accent: draft.brandColor, customized: false };

  const resolved = resolveHubTheme(config, dark);
  const wrapperStyle = { ...resolved.vars } as CSSProperties;

  const logoUrl = dark && draft.logoDarkUrl ? draft.logoDarkUrl : workspaceLogoUrl;
  const isWordmark = draft.logoStyle === 'wordmark';
  const initial = (workspaceName || '?').trim().charAt(0).toUpperCase() || '?';

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '0.35rem',
          marginBottom: '0.5rem',
        }}
      >
        <button
          type="button"
          aria-pressed={!dark}
          onClick={() => setDark(false)}
          style={togglePillStyle(!dark)}
        >
          Claro
        </button>
        <button
          type="button"
          aria-pressed={dark}
          onClick={() => setDark(true)}
          style={togglePillStyle(dark)}
        >
          Escuro
        </button>
      </div>

      <div
        data-testid="hub-preview-wrapper"
        style={{
          ...wrapperStyle,
          display: 'flex',
          height: 280,
          borderRadius: 12,
          overflow: 'hidden',
          border: '1px solid var(--border-color)',
          background: 'var(--hub-bg)',
          color: 'var(--hub-txt)',
          fontFamily: 'var(--hub-font-sans)',
        }}
      >
        {/* Sidebar */}
        <div
          style={{
            width: 88,
            flexShrink: 0,
            background: 'var(--hub-soft)',
            borderRight: '1px solid var(--hub-bd)',
            padding: '14px 8px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {logoUrl ? (
            <img
              data-testid="preview-logo"
              src={logoUrl}
              alt=""
              style={
                isWordmark
                  ? { height: 20, width: 'auto', maxWidth: 60, objectFit: 'contain' }
                  : {
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      objectFit: 'cover',
                    }
              }
            />
          ) : (
            <div
              aria-hidden="true"
              style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                background: 'var(--hub-primary)',
                color: 'var(--hub-primary-fg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {initial}
            </div>
          )}
          <div
            style={{
              fontSize: 9,
              fontWeight: 600,
              textAlign: 'center',
              lineHeight: 1.3,
              color: 'var(--hub-txt)',
            }}
          >
            {workspaceName || 'Seu workspace'}
          </div>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
            {NAV_ITEMS.map((item, i) => (
              <div
                key={item}
                style={{
                  fontSize: 8,
                  padding: '4px 6px',
                  borderRadius: 6,
                  textAlign: 'center',
                  background: i === ACTIVE_NAV_INDEX ? 'var(--hub-primary)' : 'transparent',
                  color: i === ACTIVE_NAV_INDEX ? 'var(--hub-primary-fg)' : 'var(--hub-tx2)',
                  fontWeight: i === ACTIVE_NAV_INDEX ? 600 : 400,
                }}
              >
                {item}
              </div>
            ))}
          </nav>
        </div>

        {/* Main */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--hub-font-display)',
              fontSize: 16,
              lineHeight: 1.2,
              color: 'var(--hub-txt)',
            }}
          >
            Bem-vindo(a) de volta
          </div>

          <div
            style={{
              background: 'var(--hub-card-bg)',
              border: '1px solid var(--hub-card-bd)',
              borderRadius: 'var(--hub-r-card)',
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 10, lineHeight: 1.4, color: 'var(--hub-tx2)' }}>
              Uma postagem nova está pronta para aprovação.
            </div>
            <button
              type="button"
              disabled
              style={{
                alignSelf: 'flex-start',
                background: 'var(--hub-primary)',
                color: 'var(--hub-primary-fg)',
                borderRadius: 'var(--hub-r-ctl)',
                border: 'none',
                fontSize: 9,
                fontWeight: 600,
                padding: '5px 10px',
                cursor: 'default',
              }}
            >
              Ver postagem
            </button>
          </div>

          <div style={{ display: 'flex', gap: 4 }}>
            {CALENDAR_DAYS.map((day, i) => (
              <div
                key={day}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 'var(--hub-r-ctl)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 8,
                  background: i === ACCENT_DAY_INDEX ? 'var(--hub-acc)' : 'var(--hub-soft)',
                  color: i === ACCENT_DAY_INDEX ? 'var(--hub-acc-fg)' : 'var(--hub-tx3)',
                }}
              >
                {day}
              </div>
            ))}
          </div>

          {!draft.hideBranding && (
            <div
              style={{
                marginTop: 'auto',
                fontSize: 8,
                textAlign: 'center',
                color: 'var(--hub-tx3)',
              }}
            >
              powered by mesaas
            </div>
          )}
        </div>
      </div>

      <p
        style={{
          fontSize: '0.7rem',
          color: 'var(--text-muted)',
          marginTop: '0.5rem',
        }}
      >
        Fontes reais carregam ao vivo · dados fictícios
      </p>
    </div>
  );
}

function togglePillStyle(active: boolean): CSSProperties {
  return {
    fontSize: '0.7rem',
    padding: '0.2rem 0.55rem',
    borderRadius: 999,
    border: '1px solid var(--border-color)',
    background: active ? 'var(--surface-1)' : 'transparent',
    color: active ? 'var(--text-main)' : 'var(--text-muted)',
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
  };
}

// Re-exported so callers (HubTab) can build the font-select option lists from the
// same allowlists the resolver uses, instead of re-typing font ids.
export { HUB_DISPLAY_FONTS, HUB_BODY_FONTS };
