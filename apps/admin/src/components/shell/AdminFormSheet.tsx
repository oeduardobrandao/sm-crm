import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { BottomSheet } from '@mesaas/ios-kit';
import { useIsPhone } from '../../hooks/useIsPhone';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { cn } from '../../lib/utils';

export interface AdminFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** id of the page's own <form>; the header submit targets it with form={formId}. */
  formId: string;
  submitLabel?: string;
  /** Disables submit and blocks every dismiss path. */
  submitting?: boolean;
  submitDisabled?: boolean;
  /** Refusable close: return false to keep the sheet open (e.g. a dirty confirm). */
  canClose?: () => boolean;
  /** Desktop width: 680 / 820 / 1000px. */
  width?: 'md' | 'lg' | 'xl';
  /** Must contain the page's single <form id={formId}>. */
  children: ReactNode;
}

const WIDTH = { md: 'max-w-[680px]', lg: 'max-w-[820px]', xl: 'max-w-[1000px]' } as const;

/**
 * Create/edit form as an iOS sheet: a centred glass sheet on desktop, a large bottom sheet on
 * phones. The page owns the single <form id={formId}>; the header submit targets it.
 */
export function AdminFormSheet({
  open,
  onOpenChange,
  title,
  description,
  formId,
  submitLabel = 'Salvar',
  submitting = false,
  submitDisabled = false,
  canClose,
  width = 'md',
  children,
}: AdminFormSheetProps) {
  const isPhone = useIsPhone();

  const requestClose = () => {
    if (submitting) return;
    if (canClose && !canClose()) return;
    onOpenChange(false);
  };
  const handleOpenChange = (next: boolean) => {
    if (next) onOpenChange(true);
    else requestClose();
  };

  const cancel = (
    <button
      type="button"
      className="phone-text-button admin-sheet-cancel"
      onClick={requestClose}
      disabled={submitting}
    >
      Cancelar
    </button>
  );
  const submit = (
    <button
      type="submit"
      form={formId}
      className="admin-sheet-submit"
      disabled={submitting || submitDisabled}
    >
      {submitting ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
      {submitLabel}
    </button>
  );

  if (isPhone) {
    return (
      <BottomSheet
        open={open}
        onOpenChange={handleOpenChange}
        title={title}
        description={description}
        headerLeading={cancel}
        headerTrailing={submit}
        repushIfStillOpen
        // Crossing 768px while open swaps this branch for the Dialog: drop the sheet's entry.
        popOnUnmount
      >
        {children}
      </BottomSheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        hideClose
        className={cn('phone-kit top-10 max-h-[calc(100dvh-80px)] translate-y-0', WIDTH[width])}
        {...(description ? {} : { 'aria-describedby': undefined })}
      >
        <div className="flex h-[54px] shrink-0 items-center justify-between gap-3 border-b border-border px-4">
          {cancel}
          <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
          {submit}
        </div>
        {description ? (
          <DialogDescription className="px-[18px] pt-3">{description}</DialogDescription>
        ) : null}
        <DialogBody className="px-[18px] py-[18px]">{children}</DialogBody>
      </DialogContent>
    </Dialog>
  );
}
