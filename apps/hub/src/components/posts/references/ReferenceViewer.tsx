import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { sanitizeExternalUrl } from '../../../lib/security';
import type { ReferenceItem } from '../../../types/postReferences';
import { HubDialog } from '../../ui/HubDialog';
import { referenceTitle } from './referenceFormat';

/**
 * Image or video preview. A nested HubDialog (portalled into .hub-root, not inside the
 * transformed .hub-fade-up page), so Escape closes only this layer.
 */
export function ReferenceViewer({ item, onClose }: { item: ReferenceItem; onClose: () => void }) {
  const { t } = useTranslation('hubPosts');
  const [failed, setFailed] = useState(false);
  const title = referenceTitle(item) || t('references.tab', 'Referências');
  return (
    <HubDialog open onRequestClose={onClose} title={title}>
      <div className="relative flex flex-col items-center gap-3 max-w-[92vw] max-h-[94dvh] px-3">
        <button
          type="button"
          onClick={onClose}
          aria-label={t('references.viewer.close', 'Fechar visualização')}
          className="self-end w-10 h-10 rounded-full bg-white/20 text-white flex items-center justify-center ring-1 ring-white/20 hover:bg-white/30"
        >
          <X size={18} aria-hidden="true" />
        </button>
        {failed ? (
          <div className="hub-bg-card rounded-lg p-5 text-center space-y-2 max-w-[360px]">
            <p role="alert" className="text-[13px] hub-txt">
              {t(
                'references.viewer.playError',
                'Não foi possível reproduzir aqui. Baixe o arquivo.',
              )}
            </p>
            <a
              href={sanitizeExternalUrl(item.url)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] font-semibold"
              style={{ color: 'var(--hub-acc)' }}
            >
              {t('references.viewer.openOriginal', 'Abrir o arquivo')}
            </a>
          </div>
        ) : item.file_kind === 'video' ? (
          <video
            src={item.url ?? undefined}
            poster={item.thumbnail_url ?? undefined}
            controls
            playsInline
            preload="metadata"
            onError={() => setFailed(true)}
            className="max-w-[92vw] max-h-[80dvh] rounded bg-black"
          />
        ) : (
          <img
            src={item.url ?? ''}
            alt={title}
            onError={() => setFailed(true)}
            className="max-w-[92vw] max-h-[80dvh] object-contain rounded"
          />
        )}
        {item.note && (
          <p className="max-w-[560px] text-center text-[13px] text-white/90 whitespace-pre-wrap">
            {item.note}
          </p>
        )}
      </div>
    </HubDialog>
  );
}
