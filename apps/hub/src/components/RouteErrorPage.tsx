import { useTranslation } from 'react-i18next';

/**
 * Router-level error boundary. The usual way to land here is a lazy route chunk that
 * no longer exists after a deploy; `installDeployRecovery()` reloads automatically for
 * that, so reaching this screen means the reload already happened or the failure was
 * something else. Renders outside HubShell, so it gets the fallback theme values from
 * index.html rather than the client's brand colours.
 */
export function RouteErrorPage() {
  const { t } = useTranslation();

  return (
    <div className="hub-root min-h-screen flex flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="font-display text-2xl font-medium hub-txt">{t('hub.somethingWentWrong')}</p>
      <p className="text-sm hub-tx2">{t('hub.reloadToRetry')}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-2 rounded-lg px-4 py-2.5 text-sm font-medium"
        style={{ background: 'var(--hub-acc)', color: 'var(--hub-acc-fg)' }}
      >
        {t('hub.reloadPage')}
      </button>
    </div>
  );
}
