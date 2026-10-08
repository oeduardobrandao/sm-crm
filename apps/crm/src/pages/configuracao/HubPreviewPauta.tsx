import type { ReactNode } from 'react';
import { Menu } from 'lucide-react';
import type { PreviewDims } from './HubPreview';

export function PautaPreviewGreeting({ dims }: { dims: PreviewDims }) {
  return (
    <div>
      <div
        style={{
          fontSize: dims.kpiLabelFont,
          fontWeight: 600,
          letterSpacing: '.09em',
          textTransform: 'uppercase',
          color: 'var(--hub-tx3)',
        }}
      >
        Quinta, 8 de outubro
      </div>
      <div
        style={{
          fontFamily: 'var(--hub-font-display)',
          fontWeight: 'var(--hub-display-weight)' as unknown as number,
          fontSize: dims.greetingFont,
          lineHeight: 1.2,
          color: 'var(--hub-txt)',
          marginTop: 4,
        }}
      >
        Bom dia, Ana.
      </div>
    </div>
  );
}

export function PautaPreviewKpiRow({
  dims,
  kpis,
}: {
  dims: PreviewDims;
  kpis: { label: string; value: string }[];
}) {
  return (
    <div
      style={{
        display: 'flex',
        background: 'var(--hub-card-bg)',
        border: '1px solid var(--hub-card-bd)',
        borderRadius: 'var(--hub-r-card)',
        boxShadow: 'var(--hub-shadow-card)',
        overflow: 'hidden',
      }}
    >
      {kpis.map((kpi, i) => (
        <div
          key={kpi.label}
          style={{
            flex: 1,
            minWidth: 0,
            padding: dims.kpiPad,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            borderLeft: i > 0 ? '1px solid var(--hub-bd)' : undefined,
          }}
        >
          <div
            style={{ fontSize: dims.kpiLabelFont, color: 'var(--hub-tx3)', whiteSpace: 'nowrap' }}
          >
            {kpi.label}
          </div>
          <div style={{ fontSize: dims.kpiValueFont, fontWeight: 700, color: 'var(--hub-txt)' }}>
            {kpi.value}
          </div>
        </div>
      ))}
    </div>
  );
}

const PAUTA_PILLS: { label: string; tone: 'wait' | 'ok' | 'sched' }[] = [
  { label: 'Aguardando', tone: 'wait' },
  { label: 'Aprovado', tone: 'ok' },
  { label: 'Agendado', tone: 'sched' },
];

export function PautaPreviewStatusRow({ dims }: { dims: PreviewDims }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} data-testid="preview-status-pills">
      {PAUTA_PILLS.map((pill) => (
        <span
          key={pill.label}
          style={{
            fontSize: dims.pillFont,
            fontWeight: 600,
            padding: dims.pillPad,
            borderRadius: 'var(--hub-r-chip)',
            background: `var(--hub-st-${pill.tone}-bg)`,
            color: `var(--hub-st-${pill.tone}-fg)`,
            whiteSpace: 'nowrap',
          }}
        >
          {pill.label}
        </span>
      ))}
    </div>
  );
}

export function PautaPreviewFloatingBar({
  dims,
  logoMark,
}: {
  dims: PreviewDims;
  logoMark: ReactNode;
}) {
  return (
    <div style={{ flexShrink: 0, padding: 8 }}>
      <div
        data-testid="hub-preview-floating-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: dims.topbarPad,
          borderRadius: 'var(--hub-r-card)',
          border: '1px solid var(--hub-bd)',
          background: 'var(--hub-card)',
        }}
      >
        {logoMark}
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 'var(--hub-r-ctl)',
            border: '1px solid var(--hub-bd)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Menu size={12} color="var(--hub-txt)" aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}
