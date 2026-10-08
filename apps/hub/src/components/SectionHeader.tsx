import type { ReactNode } from 'react';
import { pad2 } from '../pages/home/pautaHome';

export function SectionHeader({
  number,
  label,
  title,
  action,
}: {
  number: number;
  label: string;
  title: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3 mb-4">
      <div className="min-w-0">
        <div className="hub-eyebrow">
          {pad2(number)} · {label}
        </div>
        <h3 className="font-display hub-display-title text-[20px] leading-tight tracking-tight hub-txt mt-2">
          {title}
        </h3>
      </div>
      {action}
    </div>
  );
}
