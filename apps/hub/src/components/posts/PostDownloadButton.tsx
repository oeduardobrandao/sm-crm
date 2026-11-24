import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { HubPost } from '../../types';
import { downloadGeralContent, downloadableMedia } from '../../lib/geralDownload';

/**
 * "Baixar" in the post header, next to "Compartilhar": any post, any status or destination,
 * as long as it still has media. Same download as the approved Geral footer (share sheet on
 * iPhone/iPad, a file or a zip elsewhere); the feedback goes in a toast because the header has
 * no room for a line of text.
 */
export function PostDownloadButton({ post, className }: { post: HubPost; className?: string }) {
  const { t } = useTranslation('hubPosts');
  const [busy, setBusy] = useState(false);
  const count = downloadableMedia(post).length;

  async function download() {
    setBusy(true);
    try {
      if ((await downloadGeralContent(post)) === 'pending') {
        toast(t('download.readyToSave', 'Pronto. Toque em Baixar de novo para salvar no celular.'));
      }
    } catch {
      toast.error(t('download.failed', 'Não foi possível baixar agora. Tente de novo.'));
    } finally {
      setBusy(false);
    }
  }

  if (count === 0) return null;

  return (
    <button
      type="button"
      onClick={download}
      disabled={busy}
      aria-label={t('download.ariaLabel', 'Baixar mídia da postagem')}
      className={`inline-flex items-center gap-1 text-[12px] hub-tx3 hub-link-muted transition-colors disabled:opacity-60 ${className ?? ''}`}
    >
      {busy ? (
        <Loader2 size={13} className="animate-spin" aria-hidden="true" />
      ) : (
        <Download size={13} aria-hidden="true" />
      )}
      {t('download.label', 'Baixar')}
    </button>
  );
}
