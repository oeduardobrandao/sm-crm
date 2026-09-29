import type { CSSProperties } from 'react';

import type { PostAnalytics } from '../../../services/analytics';
import { missingActionMetricTitle, type ActionMetricKey } from '../../../lib/post-action-metrics';

const groupStyle: CSSProperties = {
  background: 'var(--card-bg)',
  border: '1px solid var(--border-color)',
  borderRadius: 10,
  padding: '0.75rem 0.9rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  minWidth: 0,
};

const headingStyle: CSSProperties = {
  margin: '0 0 0.25rem',
  fontSize: '0.72rem',
  fontWeight: 600,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '0.75rem',
  fontSize: '0.84rem',
  fontVariantNumeric: 'tabular-nums',
};

/** A post's action-metric value, or "—" with a tooltip explaining why it's missing. */
export function ActionMetricValue({
  post,
  metric,
  as: Tag = 'strong',
}: {
  post: PostAnalytics;
  metric: ActionMetricKey;
  /** `span` renders plain text (table cells); `strong` is for label/value rows. */
  as?: 'strong' | 'span';
}) {
  const value = post[metric];
  if (typeof value === 'number') return <Tag>{value.toLocaleString('pt-BR')}</Tag>;
  return (
    <Tag
      title={missingActionMetricTitle(metric, post.unavailable_metrics)}
      style={{ color: 'var(--text-muted)', fontWeight: 400 }}
    >
      —
    </Tag>
  );
}

function CountRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={rowStyle}>
      <span>{label}</span>
      <strong>{value.toLocaleString('pt-BR')}</strong>
    </div>
  );
}

function ActionRow({
  label,
  post,
  metric,
}: {
  label: string;
  post: PostAnalytics;
  metric: ActionMetricKey;
}) {
  return (
    <div style={rowStyle}>
      <span>{label}</span>
      <ActionMetricValue post={post} metric={metric} />
    </div>
  );
}

/** Expanded-row panel of the posts table, grouped like Instagram's own "Post insights". */
export function PostInsightsDetail({ post }: { post: PostAnalytics }) {
  const follows = post.follows;
  const reachPerFollower =
    typeof follows === 'number' && follows > 0 && post.reach > 0
      ? Math.max(1, Math.round(post.reach / follows))
      : null;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: '0.75rem',
        marginTop: '0.75rem',
      }}
    >
      <div style={groupStyle}>
        <h4 style={headingStyle}>Interações</h4>
        <CountRow label="Curtidas" value={post.likes ?? 0} />
        <CountRow label="Comentários" value={post.comments ?? 0} />
        <ActionRow label="Reposts" post={post} metric="reposts" />
        <CountRow label="Compartilhamentos" value={post.shares ?? 0} />
        <CountRow label="Salvamentos" value={post.saved ?? 0} />
      </div>
      <div style={groupStyle}>
        <h4 style={headingStyle}>Ações após a visualização</h4>
        <ActionRow label="Visitas ao perfil" post={post} metric="profile_visits" />
        <ActionRow label="Novos seguidores" post={post} metric="follows" />
        <ActionRow label="Toques no link da bio" post={post} metric="bio_link_clicks" />
        {reachPerFollower !== null && (
          <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            1 novo seguidor a cada {reachPerFollower.toLocaleString('pt-BR')} contas alcançadas
          </span>
        )}
      </div>
    </div>
  );
}
