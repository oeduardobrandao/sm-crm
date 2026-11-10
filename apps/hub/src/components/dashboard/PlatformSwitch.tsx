import { useTranslation } from 'react-i18next';
import { PlatformIcon } from '@mesaas/report-blocks/PlatformIcon';
import type { DashboardPlatform } from '../../types';

const PLATFORMS: DashboardPlatform[] = ['instagram', 'tiktok'];

export function PlatformSwitch({
  value,
  onChange,
}: {
  value: DashboardPlatform;
  onChange: (p: DashboardPlatform) => void;
}) {
  const { t } = useTranslation('hubHome');
  return (
    <div
      role="group"
      aria-label={t('dashboard.platformLabel', 'Plataforma')}
      className="flex rounded-lg hub-bg-soft p-0.5 gap-0.5"
    >
      {PLATFORMS.map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={p === value}
          onClick={() => p !== value && onChange(p)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-md transition-colors ${
            p === value ? 'hub-btn-primary' : 'hub-tab-btn hub-tx3'
          }`}
        >
          <PlatformIcon platform={p} size={14} />
          {t(`accounts.platform.${p}`, p === 'instagram' ? 'Instagram' : 'TikTok')}
        </button>
      ))}
    </div>
  );
}
