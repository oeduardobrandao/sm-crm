import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, Link2, Paperclip, Plus } from 'lucide-react';
import type { AddReferenceLinkInput, PostReferencesState } from '../../../hooks/usePostReferences';
import { REFERENCE_ACCEPT } from '../../../services/postReferences';
import type { ReferenceItem } from '../../../types/postReferences';
import { AddReferenceSheet } from './AddReferenceSheet';
import { ReferenceLinkForm } from './ReferenceLinkForm';

interface ReferencePickerProps {
  refs: PostReferencesState;
  /** panel: "Adicionar arquivo" + "Adicionar link" on md+, one sheet button on phones.
   *  composer: "Anexar referência" opening the sheet everywhere. */
  variant: 'panel' | 'composer';
  disabled?: boolean;
  /** Each reference added through this picker, as soon as it exists (the composer stages it). */
  onAdded?: (item: ReferenceItem) => void;
  /** True while the sheet or the link form is open, so the post card pauses its own keys. */
  onOverlayChange?: (open: boolean) => void;
}

const SECONDARY =
  'inline-flex items-center justify-center gap-1.5 hub-btn-secondary rounded-[4px] px-3 py-2 min-h-[44px] text-[13px] font-semibold disabled:opacity-50';

export function ReferencePicker({
  refs,
  variant,
  disabled = false,
  onAdded,
  onOverlayChange,
}: ReferencePickerProps) {
  const { t } = useTranslation('hubPosts');
  const inputRef = useRef<HTMLInputElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const overlay = sheetOpen || linkOpen;
  const onOverlayChangeRef = useRef(onOverlayChange);
  onOverlayChangeRef.current = onOverlayChange;
  // Balanced open/close reports: the sheet handing over to the link form stays "open".
  useEffect(() => {
    if (!overlay) return;
    onOverlayChangeRef.current?.(true);
    return () => onOverlayChangeRef.current?.(false);
  }, [overlay]);

  function openFilePicker() {
    setSheetOpen(false);
    // Synchronous inside the click, so the browser treats it as a user gesture.
    inputRef.current?.click();
  }

  function handleFiles(list: FileList | null) {
    const files = list ? Array.from(list) : [];
    // Reset so choosing the same file again still fires change.
    if (inputRef.current) inputRef.current.value = '';
    if (files.length > 0)
      void refs.startUploads(files, {
        onUploaded: onAdded,
        source: variant === 'composer' ? 'composer' : 'tab',
      });
  }

  async function submitLink(input: AddReferenceLinkInput) {
    const item = await refs.addLink(input);
    onAdded?.(item);
    setLinkOpen(false);
  }

  return (
    <>
      {variant === 'panel' ? (
        <>
          <div className="hidden md:flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openFilePicker}
              disabled={disabled}
              className={SECONDARY}
            >
              <ImagePlus size={15} aria-hidden="true" />
              {t('references.addFile', 'Adicionar arquivo')}
            </button>
            <button
              type="button"
              onClick={() => setLinkOpen(true)}
              disabled={disabled}
              className={SECONDARY}
            >
              <Link2 size={15} aria-hidden="true" />
              {t('references.addLink', 'Adicionar link')}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            disabled={disabled}
            className={`md:hidden w-full ${SECONDARY}`}
          >
            <Plus size={15} aria-hidden="true" />
            {t('references.addReference', 'Adicionar referência')}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 min-h-[36px] text-[12.5px] font-semibold disabled:opacity-50"
          style={{ color: 'var(--hub-acc)' }}
        >
          <Paperclip size={14} aria-hidden="true" />
          {t('references.attach', 'Anexar referência')}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={REFERENCE_ACCEPT}
        className="hidden"
        data-testid={`reference-file-input-${variant}`}
        onChange={(e) => handleFiles(e.target.files)}
      />
      <AddReferenceSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onPickFiles={openFilePicker}
        onPickLink={() => {
          setSheetOpen(false);
          setLinkOpen(true);
        }}
      />
      <ReferenceLinkForm open={linkOpen} onClose={() => setLinkOpen(false)} onSubmit={submitLink} />
    </>
  );
}
