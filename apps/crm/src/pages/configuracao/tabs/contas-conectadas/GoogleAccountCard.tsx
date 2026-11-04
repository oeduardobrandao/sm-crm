import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { useDateFnsLocale } from '@mesaas/i18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { GoogleAccount } from '../../../../services/google';

/** GMN units shown before the "+ N unidades" toggle. */
export const UNITS_PREVIEW = 3;

/** "{{title}} ({{client}})", or the title alone when the client name is missing. */
export function useLinkedItemLabel() {
  const { t } = useTranslation('settings');
  return (title: string | null, client: string | null) => {
    const name = title?.trim() || t('connectedAccounts.untitled');
    return client ? t('connectedAccounts.unitLine', { title: name, client }) : name;
  };
}

export function formatConnectedAt(iso: string, locale: ReturnType<typeof useDateFnsLocale>) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : format(date, 'dd/MM/yyyy', { locale });
}

export interface GoogleAccountCardProps {
  account: GoogleAccount;
  layout: 'desktop' | 'phone';
  /** `configuracoes:editar`: without it the card has no "Desconectar conta". */
  canDisconnect: boolean;
  onDisconnect: (account: GoogleAccount) => void;
}

/**
 * One Google account of the workspace in Configurações > Contas conectadas: who it is, when
 * it was connected, its status, and the YouTube channels and GMN units it feeds. Shared by
 * the desktop tab and the phone screen (`layout`), which only differ in arrangement.
 */
export function GoogleAccountCard({
  account,
  layout,
  canDisconnect,
  onDisconnect,
}: GoogleAccountCardProps) {
  const { t } = useTranslation('settings');
  const locale = useDateFnsLocale();
  const label = useLinkedItemLabel();
  const [showAllUnits, setShowAllUnits] = useState(false);
  const unitsListId = useId();
  const isPhone = layout === 'phone';

  const connectedAt = formatConnectedAt(account.connectedAt, locale);
  const initial = account.email.trim().charAt(0).toUpperCase() || '?';
  const hiddenUnits = Math.max(0, account.gbp.length - UNITS_PREVIEW);
  const shownUnits = showAllUnits ? account.gbp : account.gbp.slice(0, UNITS_PREVIEW);
  const nothingLinked = account.youtube.length === 0 && account.gbp.length === 0;

  const statusBadge =
    account.status === 'revoked' ? (
      <Badge variant="warning" size="sm">
        {t('connectedAccounts.statusRevoked')}
      </Badge>
    ) : (
      <Badge variant="success" size="sm">
        {t('connectedAccounts.statusActive')}
      </Badge>
    );

  const disconnectButton = canDisconnect && (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(
        'text-destructive hover:text-destructive',
        isPhone && 'connected-account-card__disconnect w-full',
      )}
      onClick={() => onDisconnect(account)}
    >
      {t('connectedAccounts.disconnectButton')}
    </Button>
  );

  const content = (
    <>
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-base font-semibold text-foreground"
        >
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-all text-sm font-semibold">{account.email}</span>
            {statusBadge}
          </div>
          {connectedAt && (
            <p className="m-0 mt-0.5 text-xs text-muted-foreground">
              {t('connectedAccounts.connectedAt', { date: connectedAt })}
            </p>
          )}
        </div>
        {!isPhone && disconnectButton}
      </div>

      {nothingLinked ? (
        <p className="m-0 mt-3 text-sm text-muted-foreground">{t('connectedAccounts.emptyHint')}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {account.youtube.length > 0 && (
            <div>
              <p className="m-0 text-xs font-semibold text-muted-foreground">
                {t('connectedAccounts.youtubeCount', { count: account.youtube.length })}
              </p>
              <ul className="m-0 mt-1 list-none p-0 text-sm">
                {account.youtube.map((ch) => (
                  <li key={ch.channelId} className="py-0.5">
                    {label(ch.title, ch.clientName)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {account.gbp.length > 0 && (
            <div>
              <p className="m-0 text-xs font-semibold text-muted-foreground">
                {t('connectedAccounts.gbpCount', { count: account.gbp.length })}
              </p>
              <ul id={unitsListId} className="m-0 mt-1 list-none p-0 text-sm">
                {shownUnits.map((unit) => (
                  <li key={unit.id} className="py-0.5">
                    {label(unit.title, unit.clientName)}
                  </li>
                ))}
              </ul>
              {hiddenUnits > 0 && (
                <button
                  type="button"
                  className="mt-1 border-0 bg-transparent p-0 text-sm font-medium text-foreground underline underline-offset-2"
                  aria-expanded={showAllUnits}
                  aria-controls={unitsListId}
                  onClick={() => setShowAllUnits((v) => !v)}
                >
                  {showAllUnits
                    ? t('connectedAccounts.showLess')
                    : t('connectedAccounts.moreUnits', { count: hiddenUnits })}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {isPhone && disconnectButton && <div className="mt-4">{disconnectButton}</div>}
    </>
  );

  if (isPhone) {
    return (
      <div className="connected-account-card" data-testid="google-account-card">
        {content}
      </div>
    );
  }
  return (
    <Card className="p-4 shadow-none" data-testid="google-account-card">
      {content}
    </Card>
  );
}
