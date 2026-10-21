import { Copy } from 'lucide-react';
import { copyAppLink } from '@/lib/copyAppLink';

/** Icon button that copies an absolute CRM deep link (e.g. a fluxo or post drawer). */
export function CopyLinkButton({
  path,
  label,
  className = 'drawer-delete-btn',
}: {
  path: string;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => copyAppLink(path)}
      title={label}
      aria-label={label}
      className={className}
    >
      <Copy className="h-3.5 w-3.5" />
    </button>
  );
}
