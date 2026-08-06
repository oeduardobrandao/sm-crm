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
 * Detecção conservadora de navegador mobile, via user-agent. Suficiente para
 * decidir se mostramos a orientação de handoff do app do Instagram: não
 * precisa ser perfeita, só não pode disparar em desktop.
 */
export function isMobileBrowser(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

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
  const [linkCopied, setLinkCopied] = useState(false);
  const [isMobile] = useState(isMobileBrowser);

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

  // No iOS, o app do Instagram sequestra a navegação para a URL de autorização
  // e o cliente fica preso dentro do app. A recuperação documentada é voltar
  // pelo breadcrumb "◀ Chrome"/"◀ Safari" -- mas isso restaura a página em vez
  // de recarregá-la, então `starting` continuava `true`. Sem este reset, o
  // cliente que volta pelo breadcrumb encontra o botão travado em "Abrindo o
  // Instagram..." e não consegue tentar de novo, que é exatamente a
  // recuperação que a página instrui. Confirmado em iPhone real.
  useEffect(() => {
    const reset = () => {
      setStarting(false);
      setStartError(false);
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) reset();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') reset();
    };
    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

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

  const handleCopyPageLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
    } catch {
      // Sem clipboard disponível (permissão negada, navegador antigo): não há
      // muito o que fazer além de deixar o botão como estava.
    }
  }, []);

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

      {isMobile && (
        <div className="mb-4 rounded-md border border-border bg-muted/40 p-3 text-left text-sm text-muted-foreground">
          <p className="mb-1">{t('connect.mobileNoticeIntro')}</p>
          <p className="mb-1">{t('connect.mobileNoticeRecovery')}</p>
          <p className="mb-2">{t('connect.mobileNoticeDesktop')}</p>
          <Button variant="outline" size="sm" onClick={handleCopyPageLink}>
            {linkCopied ? t('connect.mobileLinkCopied') : t('connect.mobileCopyLink')}
          </Button>
        </div>
      )}

      <Button className="w-full" onClick={handleConnect} disabled={starting}>
        {starting ? t('connect.connecting') : t('connect.cta')}
      </Button>
    </>,
  );
}
