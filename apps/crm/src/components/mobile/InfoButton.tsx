import { useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BottomSheet } from './BottomSheet';
import { PhoneIconButton } from './LargeTitleHeader';

export interface InfoButtonProps {
  /** Sheet title ("Prazos", "Ajuda"). */
  title: ReactNode;
  /** The help text. Plain text or rich nodes (paragraphs, bold). */
  content: ReactNode;
  /** Accessible name of the button. Defaults to "Mais informações: {title}". */
  label?: string;
  /** Replaces the "i" glyph (HelpTooltip uses its question mark). */
  icon?: ReactNode;
  className?: string;
}

/**
 * The tap path for help that is hover-only on desktop: a small round "i" button that
 * opens a compact bottom sheet with a title and the text. The sheet mounts on the first
 * tap and stays mounted, so pages with many of these don't pay for closed sheets.
 */
export function InfoButton({ title, content, label, icon, className }: InfoButtonProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const name =
    label ?? (typeof title === 'string' ? `Mais informações: ${title}` : 'Mais informações');
  return (
    <>
      <PhoneIconButton
        label={name}
        aria-haspopup="dialog"
        className={cn('phone-kit phone-info-button', className)}
        onClick={(e) => {
          // Rows and cards often carry their own click: the "i" only opens the help.
          e.stopPropagation();
          setMounted(true);
          setOpen(true);
        }}
      >
        {icon ?? <Info aria-hidden="true" />}
      </PhoneIconButton>
      {mounted && (
        <BottomSheet
          open={open}
          onOpenChange={setOpen}
          title={title}
          detents={['fit']}
          className="phone-info-sheet"
        >
          <div className="phone-info-sheet__text">{content}</div>
        </BottomSheet>
      )}
    </>
  );
}
