import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { ClientHealth } from '../../../services/clientHealth';
import type { HealthStatus } from '../../../lib/health/score';
import { getInstagramAuthUrl, syncInstagramData } from '../../../services/instagram';
import { Sparkline } from './Sparkline';
import { PipelineRow } from './PipelineRow';

// status → badge background/text tone (uses project CSS vars)
const TONE: Record<HealthStatus, { bg: string; fg: string }> = {
  em_alta: { bg: '#dff7ea', fg: '#0f7a4d' },
  saudavel: { bg: '#e9f9f1', fg: '#1a8f5e' },
  estavel: { bg: '#eef1f5', fg: '#5b6472' },
  atencao: { bg: '#fef4e6', fg: '#b9791f' },
  em_queda: { bg: '#fdecea', fg: '#c43c28' },
  inativo: { bg: '#eef1f5', fg: '#5b6472' },
  sem_dados: { bg: '#eef1f5', fg: '#5b6472' },
  sincronizando: { bg: '#eef1f5', fg: '#5b6472' },
  sem_sincronizar: { bg: '#eef0ff', fg: '#5b5bd6' },
  reconectar: { bg: '#fdecea', fg: '#c43c28' },
  desconectado: { bg: '#f1f3f6', fg: '#9aa0ab' },
};

const nfmt = (n: number, locale: string) => n.toLocaleString(locale);

export function ClientHealthCard({ client: c }: { client: ClientHealth }) {
  const { t, i18n } = useTranslation('dashboard');
  const locale = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  const [busy, setBusy] = useState(false);
  const tone = TONE[c.status];

  const lastPostLabel =
    c.days_since_last_post === null
      ? t('health.lastPost.never')
      : t('health.lastPost.days', { count: c.days_since_last_post });

  async function handleConnect() {
    setBusy(true);
    try {
      const url = await getInstagramAuthUrl(c.client_id);
      window.location.href = url;
    } catch {
      toast.error(t('health.error'));
      setBusy(false);
    }
  }

  async function handleSync() {
    setBusy(true);
    try {
      await syncInstagramData(c.client_id);
      toast.success(t('health.cta.sincronizar'));
    } catch {
      toast.error(t('health.error'));
    } finally {
      setBusy(false);
    }
  }

  const isConnectState = c.status === 'desconectado';
  const isReconnectState = c.status === 'reconectar';
  const isStaleState = c.status === 'sem_sincronizar';
  const showMetrics = !isConnectState && !isReconnectState;

  return (
    <div className="card" style={{ padding: '13px 15px', borderRadius: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          {c.profile_picture_url ? (
            <img
              src={c.profile_picture_url}
              alt=""
              style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }}
            />
          ) : (
            <span
              className="avatar"
              style={{ width: 32, height: 32, fontSize: '0.7rem', background: c.client_cor }}
            >
              {c.client_sigla}
            </span>
          )}
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.82rem' }}>{c.client_name}</div>
            {c.username && (
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>@{c.username}</div>
            )}
          </div>
        </div>
        <span
          style={{
            fontSize: '0.6rem',
            fontWeight: 700,
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
            padding: '2px 7px',
            borderRadius: 3,
            background: tone.bg,
            color: tone.fg,
          }}
        >
          {t(`health.status.${c.status}`)}
        </span>
      </div>

      {showMetrics ? (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              marginTop: 10,
            }}
          >
            <div style={{ display: 'flex', gap: 14, fontSize: '0.78rem' }}>
              <Metric label={t('health.metric.seguidores')}>
                {nfmt(c.follower_count, locale)}{' '}
                {c.follower_delta !== 0 && (
                  <span style={{ color: c.follower_delta > 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>
                    {c.follower_delta > 0 ? '▲' : '▼'}
                    {Math.abs(c.follower_delta)}
                  </span>
                )}
              </Metric>
              <Metric label={t('health.metric.engajamento')}>{c.engagement_rate}%</Metric>
              <Metric label={t('health.metric.alcance')}>{nfmt(c.reach_28d, locale)}</Metric>
            </div>
            <Sparkline values={c.follower_series} />
          </div>
          <PipelineRow pipeline={c.pipeline} />
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 6 }}>
            {t('health.metric.ultimoPost')}: {lastPostLabel}
          </div>
        </>
      ) : (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 10 }}>
          {isReconnectState ? t('health.reconectarMsg') : t('health.empty.noneConnected')}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 11, flexWrap: 'wrap' }}>
        {isConnectState && (
          <button className="btn-primary" disabled={busy} onClick={handleConnect} style={btnStyle}>
            {t('health.cta.conectar')}
          </button>
        )}
        {isReconnectState && (
          <button className="btn-primary" disabled={busy} onClick={handleConnect} style={btnStyle}>
            {t('health.cta.reconectar')}
          </button>
        )}
        {isStaleState && (
          <button className="btn-secondary" disabled={busy} onClick={handleSync} style={btnStyle}>
            {t('health.cta.sincronizar')}
          </button>
        )}
        <Link to={`/analytics/${c.client_id}`} className="btn-primary" style={btnStyle}>
          {t('health.cta.analytics')}
        </Link>
        <Link to={`/clientes/${c.client_id}`} className="btn-secondary" style={btnStyle}>
          {t('health.cta.detalhe')}
        </Link>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  padding: '4px 10px',
  borderRadius: 8,
  textDecoration: 'none',
};

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span>
      <span
        style={{
          display: 'block',
          fontSize: '0.6rem',
          textTransform: 'uppercase',
          letterSpacing: '0.3px',
          color: 'var(--text-muted)',
        }}
      >
        {label}
      </span>
      {children}
    </span>
  );
}
