import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Download, Loader2 } from 'lucide-react';
import type { HubPost } from '../../types';
import { downloadGeralContent, downloadableMedia } from '../../lib/geralDownload';

/**
 * "Baixar conteúdo" + "Copiar legenda" for an approved post with a Geral destination. Geral is
 * never published by Mesaas, so this is how the client takes the content elsewhere.
 */
export function GeralDownload({ post }: { post: HubPost }) {
  const { t } = useTranslation('hubPosts');
  const [busy, setBusy] = useState(false);
  // Fraction downloaded, null while unknown (see DownloadProgress).
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  // The files are downloaded but the phone refused to open the share sheet (the tap was too
  // long ago): the next tap on the same button opens it right away.
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const count = downloadableMedia(post).length;
  const caption = post.geral_caption?.trim() ?? '';

  async function download() {
    setBusy(true);
    setProgress(null);
    setFailed(false);
    try {
      setReady((await downloadGeralContent(post, setProgress)) === 'pending');
    } catch {
      setReady(false);
      setFailed(true);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(caption);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  if (count === 0 && !caption) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {count > 0 && (
          <button
            type="button"
            onClick={download}
            disabled={busy}
            aria-busy={busy}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold tabular-nums disabled:opacity-60"
            style={{ background: 'var(--hub-acc)', color: 'var(--hub-acc-fg)' }}
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            ) : (
              <Download size={14} aria-hidden="true" />
            )}
            {busy && progress !== null
              ? t('geral.downloading', 'Baixando {{percent}}%', {
                  percent: Math.round(progress * 100),
                })
              : count > 1
                ? t('geral.downloadAll', 'Baixar conteúdo ({{count}} arquivos)', { count })
                : t('geral.download', 'Baixar arquivo')}
          </button>
        )}
        {caption && (
          <button
            type="button"
            onClick={copy}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border hub-border px-3 text-[12.5px] font-semibold hub-txt"
          >
            {copied ? (
              <Check size={14} aria-hidden="true" />
            ) : (
              <Copy size={14} aria-hidden="true" />
            )}
            {copied ? t('geral.copied', 'Copiada!') : t('geral.copyCaption', 'Copiar legenda')}
          </button>
        )}
      </div>
      {ready && (
        <p role="status" className="text-[12px] hub-tx2">
          {t('geral.readyToSave', 'Pronto. Toque de novo para salvar no celular.')}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-[12px] text-rose-700 dark:text-rose-300">
          {t('geral.downloadFailed', 'Não foi possível baixar agora. Tente de novo.')}
        </p>
      )}
    </div>
  );
}
