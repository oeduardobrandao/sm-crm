import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, MoreHorizontal } from 'lucide-react';
import { ActionSheet, type ActionSheetAction } from '@/components/mobile';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { IgComment } from '../../../services/instagramComments';

const QUOTE_MAX = 140;

/** "@usuario: texto", cut at 140 characters (code points, so an emoji is never split). */
export function commentQuote(c: IgComment, unknownUser: string): string {
  const name = (c.username || '').replace(/^@/, '');
  const full = `${name ? `@${name}` : unknownUser}: ${c.text}`;
  const chars = Array.from(full);
  return chars.length > QUOTE_MAX ? `${chars.slice(0, QUOTE_MAX).join('')}…` : full;
}

/**
 * The "⋯" of a comment row: hide or show (never for the account's own comments) and
 * delete behind a confirmation. Desktop opens a dropdown; `compact` (the phone post sheet)
 * opens an action sheet. The confirmation stays open while the delete runs.
 */
export function CommentActions({
  comment,
  compact,
  disabled,
  onHide,
  onDelete,
}: {
  comment: IgComment;
  compact: boolean;
  disabled: boolean;
  onHide(hidden: boolean): void;
  onDelete(): Promise<void>;
}) {
  const { t } = useTranslation('analyticsComments');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  // A successful delete removes this row (and this component) while the dialog is open.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const hidden = comment.hidden === true;
  const canHide = !comment.from_owner;

  const confirmDelete = async () => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      deletingRef.current = false;
      if (mounted.current) {
        setDeleting(false);
        setConfirmOpen(false);
      }
    }
  };

  const sheetActions: ActionSheetAction[] = [
    ...(canHide
      ? [
          {
            label: t(hidden ? 'moderation.show' : 'moderation.hide'),
            onSelect: () => onHide(!hidden),
          },
        ]
      : []),
    { label: t('moderation.delete'), destructive: true, onSelect: () => setConfirmOpen(true) },
  ];

  const trigger = (
    <button
      type="button"
      className="igc-comment__more"
      aria-label={t('moderation.actions')}
      disabled={disabled}
      onClick={compact ? () => setSheetOpen(true) : undefined}
    >
      <MoreHorizontal aria-hidden="true" size={16} />
    </button>
  );

  return (
    <>
      {compact ? (
        <>
          {trigger}
          <ActionSheet
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            title={t('moderation.actions')}
            hideTitle
            actions={sheetActions}
            cancelLabel={t('moderation.cancel')}
          />
        </>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canHide && (
              <>
                <DropdownMenuItem onSelect={() => onHide(!hidden)}>
                  {t(hidden ? 'moderation.show' : 'moderation.hide')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem className="igc-menu__danger" onSelect={() => setConfirmOpen(true)}>
              {t('moderation.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!deletingRef.current) setConfirmOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('moderation.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('moderation.confirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <blockquote className="igc-confirm__quote">
            {commentQuote(comment, t('post.unknownUser'))}
          </blockquote>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('moderation.cancel')}</AlertDialogCancel>
            <Button variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>
              {deleting && <Loader2 aria-hidden="true" size={16} className="animate-spin" />}
              {t('moderation.confirmDelete')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
