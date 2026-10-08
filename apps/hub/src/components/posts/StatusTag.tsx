import { useTranslation } from 'react-i18next';
import { STATUS_COLORS, getClientStatusLabel, statusTone } from '../../lib/postView';
import { useHubLook } from '../../hooks/useHubLook';

export function StatusTag({ status, size = 'sm' }: { status: string; size?: 'sm' | 'md' }) {
  const { t } = useTranslation('hubPosts');
  const look = useHubLook();
  if (look === 'pauta') {
    const tone = statusTone(status);
    return (
      <span
        data-hub-status={tone}
        className="inline-flex items-center gap-1.5 font-semibold whitespace-nowrap"
        style={{
          fontSize: size === 'md' ? '0.72rem' : '0.68rem',
          padding: size === 'md' ? '0.25rem 0.6rem' : '0.2rem 0.5rem',
          color: `var(--hub-st-${tone}-fg)`,
          background: 'var(--hub-card)',
          borderRadius: 'var(--hub-r-chip)',
          boxShadow: '0 1px 2px rgba(0,0,0,.12)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: 'var(--hub-r-dot)',
            background: 'currentColor',
          }}
        />
        {getClientStatusLabel(t, status)}
      </span>
    );
  }
  const color = STATUS_COLORS[status] ?? '#94a3b8';
  return (
    <span
      className="inline-flex items-center rounded-[4px] font-semibold tracking-[0.02em] whitespace-nowrap"
      style={{
        fontSize: size === 'md' ? '0.72rem' : '0.65rem',
        color,
        background: `${color}1f`,
        border: `1px solid ${color}40`,
        padding: size === 'md' ? '0.25rem 0.6rem' : '0.2rem 0.5rem',
        backdropFilter: 'blur(6px)',
      }}
    >
      {getClientStatusLabel(t, status)}
    </span>
  );
}
