import { Link as LinkIcon } from 'lucide-react';
import { toast } from 'sonner';
import { buildHubPostLink } from '@/lib/hubLinks';

export function CopyPostLinkButton({ hubUrl, postId }: { hubUrl?: string; postId: number }) {
  if (!hubUrl) return null;
  async function copy() {
    try {
      await navigator.clipboard.writeText(buildHubPostLink(hubUrl!, postId));
      toast.success('Link copiado!');
    } catch {
      toast.error('Não foi possível copiar o link.');
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      title="Copiar link da postagem"
      aria-label="Copiar link da postagem"
      className="drawer-delete-btn"
    >
      <LinkIcon className="h-3.5 w-3.5" />
    </button>
  );
}
