import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Instagram, CircleAlert, CircleCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { resolveIgError } from '../../lib/instagram-oauth-errors';
import {
  getPublicConnectInfo,
  startPublicConnect,
  type PublicConnectInfo,
} from '../../services/connectLink';

/**
 * Página pública do link de conexão. Sem login, alcançável por qualquer pessoa
 * que tenha a URL. Não mostre aqui nada além do nome da agência e do nome do
 * cliente: é tudo o que o endpoint público devolve, de propósito.
 */
export default function ConectarPage() {
  const { token } = useParams<{ token: string }>();
  const { t } = useTranslation('clients');

  const [info, setInfo] = useState<PublicConnectInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(false);

  const [searchParams] = useSearchParams();
  const igConnected = searchParams.get('ig_connected');
  const igErrorAction = resolveIgError(searchParams.get('ig_error'));

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setLoading(false);
      return;
    }
    getPublicConnectInfo(token)
      .then((res) => {
        if (!cancelled) setInfo(res);
      })
      .catch(() => {
        if (!cancelled) {
          setInfo({
            status: 'not_found',
            cliente_name: '',
            workspace_name: '',
            connected_username: null,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleConnect = useCallback(async () => {
    if (!token) return;
    setStarting(true);
    setStartError(false);
    try {
      const url = await startPublicConnect(token);
      window.location.assign(url);
    } catch {
      setStartError(true);
      setStarting(false);
    }
  }, [token]);

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center shadow-sm">
        {children}
      </div>
    </div>
  );

  if (loading) return shell(<Spinner size="lg" />);

  if (igConnected) {
    return shell(
      <>
        <CircleCheck className="mx-auto mb-4 h-10 w-10 text-[var(--success)]" />
        <h1 className="mb-2 text-xl font-semibold">{t('connect.successTitle')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('connect.successBody', { username: info?.connected_username ?? '' })}
        </p>
      </>,
    );
  }

  const status = info?.status ?? 'not_found';

  if (status !== 'live') {
    const byStatus: Record<string, { title: string; body: string }> = {
      revoked: { title: 'connect.revokedTitle', body: 'connect.revokedBody' },
      expired: { title: 'connect.expiredTitle', body: 'connect.expiredBody' },
      unavailable: { title: 'connect.unavailableTitle', body: 'connect.unavailableBody' },
      not_found: { title: 'connect.invalidTitle', body: 'connect.invalidBody' },
    };
    const copy = byStatus[status] ?? byStatus.not_found;
    return shell(
      <>
        <CircleAlert className="mx-auto mb-4 h-10 w-10 text-[var(--warning)]" />
        <h1 className="mb-2 text-xl font-semibold">{t(copy.title)}</h1>
        <p className="text-sm text-muted-foreground">{t(copy.body)}</p>
      </>,
    );
  }

  if (info?.connected_username) {
    return shell(
      <>
        <CircleCheck className="mx-auto mb-4 h-10 w-10 text-[var(--success)]" />
        <h1 className="mb-2 text-xl font-semibold">{t('connect.alreadyTitle')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('connect.alreadyBody', { username: info.connected_username })}
        </p>
      </>,
    );
  }

  return shell(
    <>
      <Instagram className="mx-auto mb-4 h-10 w-10 text-[var(--primary-color)]" />
      <h1 className="mb-3 text-xl font-semibold">{t('connect.title')}</h1>
      <p className="mb-3 text-sm">
        {t('connect.intro', {
          agency: info?.workspace_name ?? '',
          client: info?.cliente_name ?? '',
        })}
      </p>
      <p className="mb-6 text-sm text-muted-foreground">{t('connect.explain')}</p>

      {igErrorAction?.kind === 'toast' && (
        <p className="mb-4 text-sm text-[var(--danger-text)]">{t(igErrorAction.i18nKey)}</p>
      )}
      {igErrorAction?.kind === 'off_meta' && (
        <p className="mb-4 text-sm text-[var(--danger-text)]">{t('detail.igOffMetaIntro')}</p>
      )}
      {startError && (
        <p className="mb-4 text-sm text-[var(--danger-text)]">{t('connect.startError')}</p>
      )}

      <Button className="w-full" onClick={handleConnect} disabled={starting}>
        {starting ? t('connect.connecting') : t('connect.cta')}
      </Button>
    </>,
  );
}
