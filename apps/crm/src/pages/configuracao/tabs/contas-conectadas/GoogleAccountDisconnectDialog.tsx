import { useRef } from 'react';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
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
import {
  disconnectGoogleAccount,
  GOOGLE_ACCOUNTS_QUERY_KEY,
  GOOGLE_DATA_QUERY_PREFIXES,
  type GoogleAccount,
} from '../../../../services/google';
import { useLinkedItemLabel } from './GoogleAccountCard';

/**
 * Everything an account disconnect can change: the account list, every client's Google
 * summary, the portfolios, the unit picker and every per-client YouTube / GMN analytics query.
 */
export function invalidateAfterGoogleAccountDisconnect(queryClient: QueryClient) {
  for (const key of [
    GOOGLE_ACCOUNTS_QUERY_KEY,
    ['googleSummary'],
    ['youtube-portfolio'],
    ['gbp-portfolio'],
    ['gbpLocationOptions'],
  ]) {
    void queryClient.invalidateQueries({ queryKey: [...key] });
  }
  void queryClient.invalidateQueries({
    predicate: (query) => {
      const head = query.queryKey[0];
      return typeof head === 'string' && GOOGLE_DATA_QUERY_PREFIXES.includes(head);
    },
  });
}

function errorCode(err: unknown): string | undefined {
  return (err as { code?: string } | null)?.code;
}

export interface GoogleAccountDisconnectDialogProps {
  /**
   * The account to disconnect. Kept by the parent after closing, so the content does not
   * blank out during the close animation.
   */
  account: GoogleAccount | null;
  open: boolean;
  onClose: () => void;
}

/**
 * "Desconectar {{email}}?": lists every channel and unit the disconnect unlinks, what happens
 * to their data, and the note about other workspaces. Stays open while the request runs and
 * after a conflict (so the user can retry); a 404 means it was already gone and closes it.
 */
export function GoogleAccountDisconnectDialog({
  account,
  open,
  onClose,
}: GoogleAccountDisconnectDialogProps) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const label = useLinkedItemLabel();
  // The card that opened the dialog unmounts once the list refetches without it, so after a
  // finished disconnect focus goes to the page heading instead of falling back to <body>.
  const finished = useRef(false);

  const disconnect = useMutation({
    mutationFn: (connectionId: string) => disconnectGoogleAccount(connectionId),
    onSuccess: () => {
      finished.current = true;
      onClose();
      toast.success(t('connectedAccounts.success'));
      invalidateAfterGoogleAccountDisconnect(queryClient);
    },
    onError: (err) => {
      switch (errorCode(err)) {
        case 'not_found':
          // Already gone (another tab, a concurrent unlink, the orphan sweep): done.
          finished.current = true;
          onClose();
          toast.success(t('connectedAccounts.alreadyDisconnected'));
          void queryClient.invalidateQueries({ queryKey: [...GOOGLE_ACCOUNTS_QUERY_KEY] });
          return;
        case 'conflict':
          // Nothing was committed: keep the dialog open for a retry.
          toast.error(t('connectedAccounts.errors.conflict'));
          return;
        case 'forbidden':
          toast.error(t('connectedAccounts.errors.forbidden'));
          return;
        case 'client_scope_restricted':
          toast.error(t('connectedAccounts.errors.clientScope'));
          return;
        case 'rate_limited':
          toast.error(t('connectedAccounts.errors.rateLimited'));
          return;
        default:
          toast.error(t('connectedAccounts.errors.generic'));
      }
    },
  });

  const pending = disconnect.isPending;
  const youtube = account?.youtube ?? [];
  const gbp = account?.gbp ?? [];
  const nothingLinked = youtube.length === 0 && gbp.length === 0;

  return (
    <AlertDialog
      open={open && account !== null}
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          if (!finished.current) return;
          finished.current = false;
          const target = document.querySelector<HTMLElement>('[data-connected-accounts-focus]');
          if (target) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="break-all">
            {t('connectedAccounts.dialog.title', { email: account?.email ?? '' })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('connectedAccounts.dialog.unlinks')}</AlertDialogDescription>
        </AlertDialogHeader>

        {nothingLinked ? (
          <p className="m-0 text-sm">{t('connectedAccounts.dialog.nothingLinked')}</p>
        ) : (
          <div
            className="max-h-[240px] overflow-y-auto rounded-md border p-3 text-sm"
            data-testid="disconnect-unlink-list"
          >
            {youtube.length > 0 && (
              <div>
                <p className="m-0 text-xs font-semibold text-muted-foreground">
                  {t('connectedAccounts.dialog.youtubeGroup')}
                </p>
                <ul className="m-0 mb-2 mt-1 list-disc pl-5">
                  {youtube.map((ch) => (
                    <li key={ch.channelId}>{label(ch.title, ch.clientName)}</li>
                  ))}
                </ul>
              </div>
            )}
            {gbp.length > 0 && (
              <div>
                <p className="m-0 text-xs font-semibold text-muted-foreground">
                  {t('connectedAccounts.dialog.gbpGroup')}
                </p>
                <ul className="m-0 mt-1 list-disc pl-5">
                  {gbp.map((unit) => (
                    <li key={unit.id}>{label(unit.title, unit.clientName)}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <ul className="m-0 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {youtube.length > 0 && <li>{t('connectedAccounts.dialog.youtubeData')}</li>}
          {gbp.length > 0 && <li>{t('connectedAccounts.dialog.gbpHistory')}</li>}
          <li>{t('connectedAccounts.dialog.revoke')}</li>
        </ul>

        <p
          className="m-0 rounded-md bg-muted px-3 py-2 text-sm"
          data-testid="disconnect-other-workspaces-note"
        >
          {t('connectedAccounts.dialog.otherWorkspaces')}
        </p>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t('connectedAccounts.dialog.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || !account}
            aria-busy={pending || undefined}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => {
              // Keep the dialog open until the request settles (onSuccess / not_found close it).
              e.preventDefault();
              if (account && !pending) disconnect.mutate(account.id);
            }}
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('connectedAccounts.dialog.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
