import { useState } from 'react';
import { Check, Link as LinkIcon } from 'lucide-react';
import { useHub } from '../HubContext';
import { buildHubPostLink } from '../lib/hubLinks';

export function SharePostButton({ postId, className }: { postId: number; className?: string }) {
  const { token, workspace } = useHub();
  const [copied, setCopied] = useState(false);

  async function copy() {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const url = buildHubPostLink(`${origin}/${workspace}/hub/${token}`, postId);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copiar link da postagem"
      className={`inline-flex items-center gap-1 text-[12px] text-stone-500 hover:text-stone-900 transition-colors ${className ?? ''}`}
    >
      {copied ? <Check size={13} /> : <LinkIcon size={13} />}
      {copied ? 'Copiado!' : 'Compartilhar'}
    </button>
  );
}
