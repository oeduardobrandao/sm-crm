import { useTranslation } from 'react-i18next';
import { Lock, Paperclip } from 'lucide-react';
import type { PostReferencesState } from '../../../hooks/usePostReferences';
import { MAX_REFERENCES_PER_POST } from '../../../services/postReferences';
import type { HubPost } from '../../../types';
import type { ReferenceItem } from '../../../types/postReferences';
import { ReferencePicker } from './ReferencePicker';
import { ReferenceRow, UploadRow } from './ReferenceRow';

interface PostReferencesPanelProps {
  post: HubPost;
  refs: PostReferencesState;
  onOpen: (item: ReferenceItem) => void;
  onOverlayChange?: (open: boolean) => void;
}

/** The Referências tab: rows, uploads in flight, and (while enviado_cliente) the add controls. */
export function PostReferencesPanel({
  post,
  refs,
  onOpen,
  onOverlayChange,
}: PostReferencesPanelProps) {
  const { t } = useTranslation('hubPosts');
  const { data, isLoading, canAdd, items, uploads } = refs;

  if (!data) {
    return (
      <p className="text-[13px] hub-tx3">
        {isLoading
          ? t('references.loading', 'Carregando referências...')
          : t('references.loadError', 'Não foi possível carregar as referências.')}
      </p>
    );
  }

  const inFlight = uploads.filter((u) => u.status === 'uploading').length;
  const atCap = items.length + inFlight >= MAX_REFERENCES_PER_POST;
  const empty = items.length === 0 && uploads.length === 0;

  return (
    <div className="space-y-4">
      {!canAdd && (
        <p className="flex items-start gap-2 rounded-lg hub-bg-soft px-3 py-2.5 text-[12.5px] hub-tx2">
          <Lock size={14} aria-hidden="true" className="mt-[2px] shrink-0 hub-tx3" />
          {post.status === 'postado'
            ? t(
                'references.readOnlyPublished',
                'Post publicado. As referências ficam aqui para consulta.',
              )
            : t('references.readOnly', 'As referências ficam aqui para consulta.')}
        </p>
      )}
      {canAdd && empty && (
        <div className="rounded-lg border border-dashed hub-border px-4 py-6 text-center space-y-1">
          <Paperclip size={20} aria-hidden="true" className="mx-auto hub-tx3" />
          <p className="text-[13.5px] font-semibold hub-txt">
            {t('references.emptyTitle', 'Nenhuma referência ainda')}
          </p>
          <p className="text-[12.5px] hub-tx2">
            {t(
              'references.emptyBody',
              'Envie fotos, vídeos, PDFs ou links que ajudem a equipe a ajustar este post.',
            )}
          </p>
        </div>
      )}
      {uploads.length > 0 && (
        <ul
          aria-label={t('references.uploadsLabel', 'Envios em andamento')}
          className="divide-y divide-[var(--hub-bd)]"
        >
          {uploads.map((entry) => (
            <UploadRow
              key={entry.localId}
              entry={entry}
              onCancel={refs.cancelUpload}
              onRetry={refs.retryUpload}
            />
          ))}
        </ul>
      )}
      {items.length > 0 && (
        <ul
          aria-label={t('references.listLabel', 'Referências do post')}
          className="divide-y divide-[var(--hub-bd)]"
        >
          {items.map((item) => (
            <ReferenceRow
              key={item.id}
              item={item}
              fresh={refs.freshIds.includes(item.id)}
              onOpen={onOpen}
              onSaveNote={refs.updateNote}
              onRemove={refs.remove}
            />
          ))}
        </ul>
      )}
      {canAdd && (
        <div className="space-y-2">
          <ReferencePicker
            refs={refs}
            variant="panel"
            disabled={atCap}
            onOverlayChange={onOverlayChange}
          />
          <p className="text-[12px] hub-tx3">
            {t(
              'references.hint',
              '{{n}} de 10 por post. Fotos e PDFs até 25 MB, vídeos até 200 MB.',
              { n: items.length },
            )}
          </p>
        </div>
      )}
    </div>
  );
}
