import { useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export interface RascunhoBannerProps {
  count: number;
  entityKind: 'fluxo' | 'post';
  busy?: boolean;
  onReset: () => void;
  onDismiss: () => void;
}

export function RascunhoBanner({
  count,
  entityKind,
  busy,
  onReset,
  onDismiss,
}: RascunhoBannerProps) {
  const { t } = useTranslation('workflows');
  const [confirming, setConfirming] = useState(false);
  const isPost = entityKind === 'post';
  const headline = isPost
    ? t('rascunhoBanner.headlinePost')
    : t('rascunhoBanner.headline', { count });
  const detail = isPost ? t('rascunhoBanner.detailPost') : t('rascunhoBanner.detailFlow');
  const confirmTitle = isPost
    ? t('rascunhoBanner.confirmTitlePost')
    : t('rascunhoBanner.confirmTitle', { count });
  const singular = isPost || count === 1;
  const confirmBody = singular
    ? t('rascunhoBanner.confirmBodySingular')
    : t('rascunhoBanner.confirmBodyPlural');

  return (
    <>
      <div className="rascunho-banner" role="status">
        <div className="rascunho-banner__text">
          <strong>{headline}</strong>
          <span>{detail}</span>
        </div>
        <button
          type="button"
          className="rascunho-banner__action"
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          {isPost ? t('rascunhoBanner.backToDraft') : t('rascunhoBanner.allBackToDraft')}
        </button>
        <button
          type="button"
          className="rascunho-banner__close"
          aria-label={t('rascunhoBanner.dismiss')}
          disabled={busy}
          onClick={onDismiss}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{confirmBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirming(false);
                onReset();
              }}
            >
              {t('rascunhoBanner.backToDraft')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
