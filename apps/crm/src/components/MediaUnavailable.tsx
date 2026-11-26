import { ImageOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface MediaUnavailableProps {
  /** 'compact' shows only the icon (tight spaces); 'full' adds the label. */
  size?: 'compact' | 'full';
  className?: string;
}

export function MediaUnavailable({ size = 'full', className = '' }: MediaUnavailableProps) {
  const { t } = useTranslation();
  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-1.5 bg-stone-100 text-stone-400 dark:bg-stone-800 dark:text-stone-500 ${className}`}
    >
      <ImageOff
        className={size === 'compact' ? 'h-4 w-4 opacity-60' : 'h-6 w-6 opacity-60'}
        aria-hidden="true"
      />
      {size === 'full' && <span className="text-xs font-medium">{t('mediaUnavailable')}</span>}
    </div>
  );
}
