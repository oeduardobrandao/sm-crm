import { ImageOff } from 'lucide-react';

export interface MediaUnavailableProps {
  /** 'compact' shows only the icon (tight spaces); 'full' adds the label. */
  size?: 'compact' | 'full';
  className?: string;
}

export function MediaUnavailable({ size = 'full', className = '' }: MediaUnavailableProps) {
  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-1.5 ${className}`}
      style={{ background: 'var(--hub-soft)', color: 'var(--hub-tx3)' }}
    >
      <ImageOff
        className={size === 'compact' ? 'h-4 w-4 opacity-60' : 'h-6 w-6 opacity-60'}
        aria-hidden="true"
      />
      {size === 'full' && <span className="text-xs font-medium">Mídia indisponível</span>}
    </div>
  );
}
