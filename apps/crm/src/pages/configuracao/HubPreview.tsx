import { useEffect, useState, type CSSProperties } from 'react';
import {
  Monitor,
  Smartphone,
  Menu,
  Image as ImageIcon,
  Home,
  CheckSquare,
  LayoutList,
  MoreHorizontal,
} from 'lucide-react';
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

const MOBILE_NAV_ITEMS: { label: string; icon: typeof Home }[] = [
  { label: 'Início', icon: Home },
  { label: 'Aprovar', icon: CheckSquare },
  { label: 'Posts', icon: LayoutList },
  { label: 'Mais', icon: MoreHorizontal },
];

const STATUS_PILLS = ['Aprovado · 8', 'Em revisão · 2', 'Agendado · 5'];

// Fixed, illustrative heights (%). Not derived from real data — the preview has
// none — just enough visual variety that a sparkline reads as a sparkline instead
// of a flat bar. Last bar always the accent, matching "today" being the highlighted
// point in a trend.
const KPI_STATS: { label: string; value: string; spark: number[] }[] = [
  { label: 'Aprovações', value: '8', spark: [35, 55, 40, 70, 50, 65, 85] },
  { label: 'Agendados', value: '5', spark: [50, 35, 60, 45, 70, 55, 40] },
  { label: 'Rascunhos', value: '3', spark: [20, 40, 25, 50, 35, 45, 30] },
];

/** Per-device sizing. The preview reads as a real browser window now (max-width
 * ~900px, centered), not a cramped 380px sidebar column, so desktop content needs
 * meaningfully larger type/padding than the original design to read comfortably.
 * Mobile keeps the original compact scale — it was already sized for a narrow
 * frame and stays roughly phone-proportioned. */
interface PreviewDims {
  maxWidth: number;
  sidebarWidth: number;
  logoSize: number;
  wsNameFont: number;
  navItemFont: number;
  navItemPad: string;
  navGap: number;
  mainPad: number;
  mainGap: number;
  greetingFont: number;
  pillFont: number;
  pillPad: string;
  kpiLabelFont: number;
  kpiValueFont: number;
  kpiPad: string;
  kpiGap: number;
  sparkHeight: number;
  approvalPad: number;
  approvalThumb: number;
  approvalTextFont: number;
  approvalBtnFont: number;
  approvalBtnPad: string;
  calDaySize: number;
  calDayFont: number;
  verTudoFont: number;
  poweredByFont: number;
  chromeBarHeight: number;
  chromeUrlFont: number;
  topbarPad: string;
  bottomNavIconBox: number;
  bottomNavIconSize: number;
  bottomNavLabelFont: number;
  frameHeight: number;
}

const DESKTOP_DIMS: PreviewDims = {
  maxWidth: 900,
  sidebarWidth: 180,
  logoSize: 40,
  wsNameFont: 13,
  navItemFont: 13,
  navItemPad: '9px 12px',
  navGap: 6,
  mainPad: 30,
  mainGap: 18,
  greetingFont: 27,
  pillFont: 12,
  pillPad: '5px 13px',
  kpiLabelFont: 12,
  kpiValueFont: 22,
  kpiPad: '14px 16px',
  kpiGap: 14,
  sparkHeight: 26,
  approvalPad: 18,
  approvalThumb: 52,
  approvalTextFont: 14,
  approvalBtnFont: 13,
  approvalBtnPad: '9px 18px',
  calDaySize: 38,
  calDayFont: 13,
  verTudoFont: 12,
  poweredByFont: 11,
  chromeBarHeight: 34,
  chromeUrlFont: 12,
  topbarPad: '8px 10px',
  bottomNavIconBox: 20,
  bottomNavIconSize: 10,
  bottomNavLabelFont: 6,
  frameHeight: 480,
};

const MOBILE_DIMS: PreviewDims = {
  maxWidth: 300,
  sidebarWidth: 88,
  logoSize: 26,
  wsNameFont: 9,
  navItemFont: 8,
  navItemPad: '4px 6px',
  navGap: 4,
  mainPad: 14,
  mainGap: 8,
  greetingFont: 16,
  pillFont: 7,
  pillPad: '3px 7px',
  kpiLabelFont: 7,
  kpiValueFont: 12,
  kpiPad: '7px 8px',
  kpiGap: 6,
  sparkHeight: 14,
  approvalPad: 10,
  approvalThumb: 32,
  approvalTextFont: 9,
  approvalBtnFont: 9,
  approvalBtnPad: '5px 10px',
  calDaySize: 22,
  calDayFont: 8,
  verTudoFont: 7,
  poweredByFont: 8,
  chromeBarHeight: 26,
  chromeUrlFont: 8,
  topbarPad: '8px 10px',
  bottomNavIconBox: 20,
  bottomNavIconSize: 10,
  bottomNavLabelFont: 6,
  frameHeight: 440,
};

/**
 * Live preview block: a caption + device/appearance toggles header, then a
 * fake-browser-chrome frame around a miniature of the client Hub (sidebar + main
 * content on desktop, top bar + bottom nav on mobile), resolved through the REAL
 * `resolveHubTheme`. No data fetching, no persistence, no real navigation —
 * everything comes from `draft` so the settings tab can preview edits before
 * "Salvar", and every colour comes from the resolved CSS variables, never a
 * hand-picked hex.
 *
 * The inner wrapper div carries the resolved CSS variables inline (never :root —
 * this sits inside the CRM, which has its own global theme). The component also
 * owns its own light/dark and desktop/mobile toggles so the agency can check every
 * combination without leaving Configurações, independent of `hub_default_appearance`
 * (which only sets the client's FIRST visit).
 */
export function HubPreview({
  draft,
  workspaceName,
  workspaceLogoUrl,
  customized,
}: HubPreviewProps) {
  const [dark, setDark] = useState(draft.defaultAppearance === 'dark');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const dims = device === 'mobile' ? MOBILE_DIMS : DESKTOP_DIMS;

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

  // Mirror WorkspaceMark (apps/hub/src/components/WorkspaceMark.tsx): it reads
  // logo_style/logo_dark_url off bootstrap.hub_theme, which hub-bootstrap only
  // populates when the workspace is entitled -- an un-entitled workspace's
  // stored picks are otherwise inert data the client never sees. Gating on
  // `customized` here (not just reading `draft` directly) keeps a downgraded
  // workspace's preview honest instead of showing a portal it can't get.
  const logoUrl = customized && dark && draft.logoDarkUrl ? draft.logoDarkUrl : workspaceLogoUrl;
  const isWordmark = customized && draft.logoStyle === 'wordmark';
  const initial = (workspaceName || '?').trim().charAt(0).toUpperCase() || '?';
  // Same entitlement gate as logoUrl/isWordmark above: hub-bootstrap only honors
  // hub_hide_branding when the workspace is entitled -- an un-entitled workspace
  // with a stored hide_branding=true still gets the mark forced on by the real hub.
  const showPoweredBy = !(customized && draft.hideBranding);

  const logoMark = logoUrl ? (
    <img
      data-testid="preview-logo"
      src={logoUrl}
      alt=""
      style={
        isWordmark
          ? {
              height: dims.logoSize * 0.75,
              width: 'auto',
              maxWidth: dims.logoSize * 2.3,
              objectFit: 'contain',
            }
          : {
              width: dims.logoSize,
              height: dims.logoSize,
              borderRadius: '50%',
              objectFit: 'cover',
            }
      }
    />
  ) : (
    <div
      aria-hidden="true"
      style={{
        width: dims.logoSize,
        height: dims.logoSize,
        borderRadius: '50%',
        background: 'var(--hub-primary)',
        color: 'var(--hub-primary-fg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: dims.logoSize * 0.42,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );

  const kpiCards = (device === 'mobile' ? KPI_STATS.slice(0, 2) : KPI_STATS).map((kpi) => (
    <div
      key={kpi.label}
      style={{
        flex: 1,
        minWidth: 0,
        background: 'var(--hub-card-bg)',
        border: '1px solid var(--hub-card-bd)',
        borderRadius: 'var(--hub-r-card)',
        padding: dims.kpiPad,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ fontSize: dims.kpiLabelFont, color: 'var(--hub-tx3)', whiteSpace: 'nowrap' }}>
        {kpi.label}
      </div>
      <div style={{ fontSize: dims.kpiValueFont, fontWeight: 700, color: 'var(--hub-txt)' }}>
        {kpi.value}
      </div>
      <Sparkline values={kpi.spark} height={dims.sparkHeight} />
    </div>
  ));

  const statusPillsRow = (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} data-testid="preview-status-pills">
      {STATUS_PILLS.map((pill) => (
        <span
          key={pill}
          style={{
            fontSize: dims.pillFont,
            fontWeight: 500,
            padding: dims.pillPad,
            borderRadius: 999,
            background: 'var(--hub-soft)',
            color: 'var(--hub-tx2)',
            whiteSpace: 'nowrap',
          }}
        >
          {pill}
        </span>
      ))}
    </div>
  );

  const approvalsCard = (
    <div
      style={{
        background: 'var(--hub-card-bg)',
        border: '1px solid var(--hub-card-bd)',
        borderRadius: 'var(--hub-r-card)',
        padding: dims.approvalPad,
        display: 'flex',
        gap: dims.approvalPad * 0.55,
        alignItems: 'center',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: dims.approvalThumb,
          height: dims.approvalThumb,
          flexShrink: 0,
          borderRadius: 'var(--hub-r-ctl)',
          background: 'var(--hub-soft)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ImageIcon size={dims.approvalThumb * 0.4} color="var(--hub-tx3)" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: dims.approvalTextFont, lineHeight: 1.35, color: 'var(--hub-tx2)' }}>
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
            fontSize: dims.approvalBtnFont,
            fontWeight: 600,
            padding: dims.approvalBtnPad,
            cursor: 'default',
          }}
        >
          Ver postagem
        </button>
      </div>
    </div>
  );

  const calendarRow = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, flex: 1 }}>
        {CALENDAR_DAYS.map((day, i) => (
          <div
            key={day}
            style={{
              width: dims.calDaySize,
              height: dims.calDaySize,
              borderRadius: 'var(--hub-r-ctl)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: dims.calDayFont,
              background: i === ACCENT_DAY_INDEX ? 'var(--hub-acc)' : 'var(--hub-soft)',
              color: i === ACCENT_DAY_INDEX ? 'var(--hub-acc-fg)' : 'var(--hub-tx3)',
            }}
          >
            {day}
          </div>
        ))}
      </div>
      <span
        style={{
          fontSize: dims.verTudoFont,
          fontWeight: 600,
          color: 'var(--hub-acc)',
          whiteSpace: 'nowrap',
        }}
      >
        Ver tudo
      </span>
    </div>
  );

  const greeting = (
    <div
      style={{
        fontFamily: 'var(--hub-font-display)',
        fontSize: dims.greetingFont,
        lineHeight: 1.2,
        color: 'var(--hub-txt)',
      }}
    >
      Bem-vindo(a) de volta
    </div>
  );

  const poweredBy = showPoweredBy && (
    <div style={{ fontSize: dims.poweredByFont, textAlign: 'center', color: 'var(--hub-tx3)' }}>
      powered by mesaas
    </div>
  );

  const mainContent = (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        padding: dims.mainPad,
        display: 'flex',
        flexDirection: 'column',
        gap: dims.mainGap,
        overflow: 'auto',
      }}
    >
      {greeting}
      {statusPillsRow}
      <div style={{ display: 'flex', gap: dims.kpiGap }}>{kpiCards}</div>
      {approvalsCard}
      {calendarRow}
      <div style={{ marginTop: 'auto' }}>{poweredBy}</div>
    </div>
  );

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.75rem',
          marginBottom: '0.85rem',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-main)' }}>
          Pré-visualização ao vivo
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            aria-pressed={device === 'desktop'}
            aria-label="Computador"
            onClick={() => setDevice('desktop')}
            style={togglePillStyle(device === 'desktop')}
          >
            <Monitor size={12} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-pressed={device === 'mobile'}
            aria-label="Celular"
            onClick={() => setDevice('mobile')}
            style={togglePillStyle(device === 'mobile')}
          >
            <Smartphone size={12} aria-hidden="true" />
          </button>
          <span
            aria-hidden="true"
            style={{ width: 1, height: 16, background: 'var(--border-color)' }}
          />
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
      </div>

      {/* Soft container so the framed browser window has room to breathe instead of
          sitting flush against the page — it reads as a "stage" for the preview. */}
      <div
        style={{
          background: 'var(--surface-1)',
          borderRadius: 16,
          padding: device === 'mobile' ? '1.75rem' : '2rem',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: dims.maxWidth,
            borderRadius: 12,
            overflow: 'hidden',
            border: '1px solid var(--border-color)',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
            background: 'var(--card-bg)',
          }}
        >
          {/* Fake browser chrome: three muted dots + a centered fake URL, framing the
              hub content below as "what the client sees in their browser tab". */}
          <div
            data-testid="hub-preview-chrome"
            style={{
              height: dims.chromeBarHeight,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              position: 'relative',
              padding: '0 12px',
              background: 'var(--surface-1)',
              borderBottom: '1px solid var(--border-color)',
            }}
          >
            <div style={{ display: 'flex', gap: 5 }} aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--text-muted)',
                    opacity: 0.35,
                  }}
                />
              ))}
            </div>
            <span
              style={{
                position: 'absolute',
                left: '50%',
                transform: 'translateX(-50%)',
                fontSize: dims.chromeUrlFont,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-muted)',
                whiteSpace: 'nowrap',
              }}
            >
              app.mesaas.com.br/•••/hub
            </span>
          </div>

          <div
            data-testid="hub-preview-wrapper"
            style={{
              ...wrapperStyle,
              display: 'flex',
              flexDirection: device === 'mobile' ? 'column' : 'row',
              height: dims.frameHeight,
              background: 'var(--hub-bg)',
              color: 'var(--hub-txt)',
              fontFamily: 'var(--hub-font-sans)',
            }}
          >
            {device === 'desktop' && (
              <div
                data-testid="hub-preview-sidebar"
                style={{
                  width: dims.sidebarWidth,
                  flexShrink: 0,
                  background: 'var(--hub-soft)',
                  borderRight: '1px solid var(--hub-bd)',
                  padding: '22px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                {logoMark}
                <div
                  style={{
                    fontSize: dims.wsNameFont,
                    fontWeight: 600,
                    textAlign: 'center',
                    lineHeight: 1.3,
                    color: 'var(--hub-txt)',
                  }}
                >
                  {workspaceName || 'Seu workspace'}
                </div>
                <nav
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: dims.navGap,
                    width: '100%',
                    marginTop: 8,
                  }}
                >
                  {NAV_ITEMS.map((item, i) => (
                    <div
                      key={item}
                      style={{
                        fontSize: dims.navItemFont,
                        padding: dims.navItemPad,
                        borderRadius: 8,
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
            )}

            <div
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {device === 'mobile' && (
                <div
                  data-testid="hub-preview-topbar"
                  style={{
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: dims.topbarPad,
                    borderBottom: '1px solid var(--hub-bd)',
                  }}
                >
                  {logoMark}
                  <Menu size={14} color="var(--hub-tx2)" aria-hidden="true" />
                </div>
              )}

              {mainContent}

              {device === 'mobile' && (
                <div
                  data-testid="hub-preview-bottom-nav"
                  style={{
                    flexShrink: 0,
                    display: 'flex',
                    borderTop: '1px solid var(--hub-bd)',
                    background: 'var(--hub-card)',
                  }}
                >
                  {MOBILE_NAV_ITEMS.map(({ label, icon: Icon }, i) => {
                    const active = i === 0;
                    return (
                      <div
                        key={label}
                        style={{
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 2,
                          padding: '6px 0',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: dims.bottomNavIconBox,
                            height: 16,
                            borderRadius: 999,
                            background: active ? 'var(--hub-primary)' : 'transparent',
                          }}
                        >
                          <Icon
                            size={dims.bottomNavIconSize}
                            color={active ? 'var(--hub-primary-fg)' : 'var(--hub-tx3)'}
                            aria-hidden="true"
                          />
                        </div>
                        <span
                          style={{
                            fontSize: dims.bottomNavLabelFont,
                            color: active ? 'var(--hub-txt)' : 'var(--hub-tx3)',
                          }}
                        >
                          {label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <p
        style={{
          fontSize: '0.7rem',
          color: 'var(--text-muted)',
          marginTop: '0.65rem',
          textAlign: 'center',
        }}
      >
        Fontes reais carregam ao vivo · dados fictícios
      </p>
    </div>
  );
}

/** Six-bar illustrative trend, last bar always the accent (today). Pure divs, no
 * chart library — this is decoration on a settings preview, not a real chart. */
function Sparkline({ values, height }: { values: number[]; height: number }) {
  return (
    <div
      data-testid="preview-sparkline"
      aria-hidden="true"
      style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height }}
    >
      {values.map((v, i) => (
        // Fixed-length illustrative data, never reordered — index is a stable key here.
        <div
          key={i}
          style={{
            flex: 1,
            height: `${Math.max(15, v)}%`,
            borderRadius: 1,
            background: i === values.length - 1 ? 'var(--hub-acc)' : 'var(--hub-soft)',
          }}
        />
      ))}
    </div>
  );
}

function togglePillStyle(active: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
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
