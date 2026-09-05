import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { watchForNewVersion } from '@mesaas/app-lifecycle';

/**
 * Notice for a tab left open across a deploy. The Hub has no toast system, so this
 * is a fixed pill above the content. It is mounted outside HubShell on purpose:
 * `.hub-fade-up` becomes the containing block for `position: fixed` descendants,
 * and the theme variables are written to `:root`, so it still picks up the client's
 * brand colours from out here.
 */
export function NewVersionBanner() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const watcher = watchForNewVersion({ onNewVersion: () => setVisible(true) });
    return watcher.stop;
  }, []);

  if (!visible) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 z-30 flex justify-center px-4"
      style={{
        bottom: 'calc(16px + env(safe-area-inset-bottom))',
        fontFamily: 'var(--hub-font-sans)',
      }}
    >
      <div
        className="flex items-center gap-3 rounded-xl border px-4 py-2.5"
        style={{
          background: 'var(--hub-card)',
          borderColor: 'var(--hub-bd)',
          color: 'var(--hub-txt)',
          boxShadow: '0 10px 30px -12px rgba(0,0,0,.35)',
        }}
      >
        <span className="text-sm">{t('hub.newVersion')}</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg px-3 py-1.5 text-sm font-medium"
          style={{ background: 'var(--hub-acc)', color: 'var(--hub-acc-fg)' }}
        >
          {t('hub.refresh')}
        </button>
      </div>
    </div>
  );
}
