interface ReportPreviewProps {
  accentColor: string;
  splashUrl: string | null;
  logoUrl: string | null;
  workspaceName: string;
}

const INK = '#1C1917';
const PAPER = '#FAFAF7';

/**
 * Pure presentational miniature of the v2 monthly report: an ink cover
 * (logo plate + workspace name + serif handle + optional splash art + a
 * teaser metrics row) followed by a light paper strip (takeaway dash +
 * rank chip + KPI row). No data fetching, no state — everything comes
 * from props so the settings page can preview edits live.
 *
 * The accent colour tints ONLY structural marks (takeaway dash, rank
 * chip) — never the chart/KPI marks — matching the promise made in the
 * settings helper copy ("nunca nos gráficos de dados").
 */
export function ReportPreview({
  accentColor,
  splashUrl,
  logoUrl,
  workspaceName,
}: ReportPreviewProps) {
  return (
    <div
      style={{
        width: 240,
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid var(--border-color)',
        fontFamily: "'DM Sans', 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      {/* Cover */}
      <div
        style={{
          background: INK,
          color: '#F5F5F4',
          padding: '14px 14px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {logoUrl && (
            <div
              style={{
                background: PAPER,
                borderRadius: 6,
                padding: 3,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <img
                data-testid="preview-logo"
                src={logoUrl}
                alt=""
                style={{ width: 18, height: 18, objectFit: 'contain', display: 'block' }}
              />
            </div>
          )}
          <div
            style={{
              fontSize: '0.6rem',
              fontWeight: 600,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              opacity: 0.75,
            }}
          >
            {workspaceName}
          </div>
        </div>

        <div
          style={{
            fontFamily: 'Georgia, serif',
            fontSize: '1.15rem',
            lineHeight: 1.2,
          }}
        >
          @seucliente
        </div>

        {splashUrl && (
          <img
            data-testid="preview-splash"
            src={splashUrl}
            alt=""
            style={{
              width: '100%',
              height: 70,
              objectFit: 'cover',
              borderRadius: 6,
              display: 'block',
            }}
          />
        )}

        <div style={{ display: 'flex', gap: 10 }} data-testid="preview-teaser-row">
          {['24,8K', '142K', '4,6%'].map((value) => (
            <div key={value} style={{ flex: 1 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 700 }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Paper strip */}
      <div
        style={{
          background: PAPER,
          color: '#1C1917',
          padding: '12px 14px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 3,
              height: 22,
              borderRadius: 2,
              background: accentColor,
              flexShrink: 0,
            }}
          />
          <div style={{ fontSize: '0.65rem', lineHeight: 1.4, color: '#57534E' }}>
            Engajamento cresceu <strong>12,4%</strong> este mês.
          </div>
          <div
            data-testid="preview-rank-chip"
            style={{
              marginLeft: 'auto',
              fontSize: '0.6rem',
              fontWeight: 700,
              color: '#fff',
              backgroundColor: accentColor,
              borderRadius: 999,
              padding: '2px 8px',
              flexShrink: 0,
            }}
          >
            #1
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }} data-testid="preview-kpi-row">
          {[
            { label: 'Seguidores', value: '24,8K' },
            { label: 'Alcance', value: '142K' },
            { label: 'Impressões', value: '389K' },
          ].map((kpi) => (
            <div
              key={kpi.label}
              style={{
                flex: 1,
                background: '#fff',
                border: '1px solid rgba(28,25,23,0.08)',
                borderRadius: 8,
                padding: '6px 8px',
              }}
            >
              <div style={{ fontSize: '0.5rem', color: '#78716C', textTransform: 'uppercase' }}>
                {kpi.label}
              </div>
              <div data-testid="preview-kpi-value" style={{ fontSize: '0.7rem', fontWeight: 700 }}>
                {kpi.value}
              </div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: '0.55rem', color: '#A8A29E', textAlign: 'center' }}>
          Pré-visualização · fontes ilustrativas
        </div>
      </div>
    </div>
  );
}
