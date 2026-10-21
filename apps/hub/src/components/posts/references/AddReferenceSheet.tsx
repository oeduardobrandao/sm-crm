import { useTranslation } from 'react-i18next';
import { ImagePlus, Link2 } from 'lucide-react';
import { HubDialog } from '../../ui/HubDialog';

interface AddReferenceSheetProps {
  open: boolean;
  onClose: () => void;
  onPickFiles: () => void;
  onPickLink: () => void;
}

const OPTION =
  'w-full flex items-center gap-3 rounded-lg px-3 py-3 min-h-[52px] text-left text-[15px] font-semibold hub-txt hover:bg-[var(--hub-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hub-acc)]';

/** Phone bottom sheet (centered card on md+, same as RemarcarDialog): file or link. */
export function AddReferenceSheet({
  open,
  onClose,
  onPickFiles,
  onPickLink,
}: AddReferenceSheetProps) {
  const { t } = useTranslation('hubPosts');
  if (!open) return null;
  return (
    <HubDialog
      open
      onRequestClose={onClose}
      title={t('references.sheetTitle', 'Adicionar referência')}
    >
      <div className="hub-bg-card w-full self-end md:self-center md:w-[min(400px,calc(100vw-3rem))] rounded-t-2xl md:rounded-xl shadow-2xl p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-1">
        <div
          aria-hidden="true"
          className="mx-auto mb-2 h-1 w-10 rounded-full hub-bg-soft md:hidden"
        />
        <button type="button" onClick={onPickFiles} className={OPTION}>
          <ImagePlus size={20} aria-hidden="true" className="hub-tx2" />
          {t('references.sheetFile', 'Foto, vídeo ou PDF')}
        </button>
        <button type="button" onClick={onPickLink} className={OPTION}>
          <Link2 size={20} aria-hidden="true" className="hub-tx2" />
          {t('references.sheetLink', 'Link')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-lg px-3 py-3 min-h-[48px] text-[14px] font-semibold hub-tx2 hover:bg-[var(--hub-soft)]"
        >
          {t('references.cancel', 'Cancelar')}
        </button>
      </div>
    </HubDialog>
  );
}
