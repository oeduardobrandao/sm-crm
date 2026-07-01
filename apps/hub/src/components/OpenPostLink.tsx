import { ExternalLink } from 'lucide-react';
import { useHub } from '../HubContext';
import { buildHubPostLink } from '../lib/hubLinks';

export function OpenPostLink({ postId, className }: { postId: number; className?: string }) {
  const { token, workspace } = useHub();
  const href = buildHubPostLink(`/${workspace}/hub/${token}`, postId);
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label="Abrir postagem em nova aba"
      className={`inline-flex items-center gap-1 text-[12px] text-stone-500 hover:text-stone-900 transition-colors ${className ?? ''}`}
    >
      <ExternalLink size={13} />
      Abrir
    </a>
  );
}
