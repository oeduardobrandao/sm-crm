import { useTranslation } from 'react-i18next';
import { STATUS_COLORS, getClientStatusLabel } from '../../lib/postView';

export function StatusTag({ status, size = 'sm' }: { status: string; size?: 'sm' | 'md' }) {
  const { t } = useTranslation('hubPosts');
  const color = STATUS_COLORS[status] ?? '#94a3b8';
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md font-semibold tracking-[0.02em] whitespace-nowrap"
      style={{
        fontSize: size === 'md' ? '0.72rem' : '0.65rem',
        color,
        background: `${color}1f`,
        border: `1px solid ${color}40`,
        padding: size === 'md' ? '0.25rem 0.6rem' : '0.2rem 0.5rem',
        backdropFilter: 'blur(6px)',
      }}
    >
      <span
        style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }}
      />
      {getClientStatusLabel(t, status)}
    </span>
  );
}
