import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { setConsent, type ConsentCategory } from '@/lib/consent';
import { useConsent } from '@/lib/useConsent';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Category to pre-enable (a blocked chat click asks for `support`). */
  focus?: ConsentCategory;
  /** Radix close-autofocus hook: lets the owner hand focus back to whatever opened the dialog. */
  onCloseAutoFocus?: (event: Event) => void;
}

// Mounted only while the dialog is open (inside DialogContent), so the switches always start from
// the stored choice instead of leaking state from a previous open.
function PreferencesForm({ focus, onClose }: { focus?: ConsentCategory; onClose: () => void }) {
  const { t } = useTranslation();
  const consent = useConsent();
  const [analytics, setAnalytics] = useState(consent?.analytics === true);
  const [support, setSupport] = useState(focus === 'support' ? true : consent?.support === true);

  const save = () => {
    setConsent({ analytics, support });
    onClose();
  };

  return (
    <>
      <div className="space-y-4">
        <div className="rounded-lg border p-3">
          <p className="text-sm font-medium">{t('cookies.dialog.essentialTitle')}</p>
          <p className="text-sm text-muted-foreground">
            {t('cookies.dialog.essentialDescription')}
          </p>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div>
            <Label htmlFor="cookie-analytics" className="text-sm font-medium">
              {t('cookies.dialog.analyticsTitle')}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t('cookies.dialog.analyticsDescription')}
            </p>
          </div>
          <Switch id="cookie-analytics" checked={analytics} onCheckedChange={setAnalytics} />
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div>
            <Label htmlFor="cookie-support" className="text-sm font-medium">
              {t('cookies.dialog.supportTitle')}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t('cookies.dialog.supportDescription')}
            </p>
            {focus === 'support' && (
              <p className="mt-1 text-sm font-medium">{t('cookies.dialog.supportNeeded')}</p>
            )}
          </div>
          <Switch id="cookie-support" checked={support} onCheckedChange={setSupport} />
        </div>

        <p className="text-xs text-muted-foreground">{t('cookies.dialog.revokeNote')}</p>
      </div>
      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onClose}>
          {t('cookies.dialog.cancel')}
        </Button>
        <Button onClick={save}>{t('cookies.dialog.save')}</Button>
      </DialogFooter>
    </>
  );
}

export function CookiePreferencesDialog({ open, onOpenChange, focus, onCloseAutoFocus }: Props) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-y-auto" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t('cookies.dialog.title')}</DialogTitle>
          <DialogDescription>{t('cookies.dialog.description')}</DialogDescription>
        </DialogHeader>
        <PreferencesForm focus={focus} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
