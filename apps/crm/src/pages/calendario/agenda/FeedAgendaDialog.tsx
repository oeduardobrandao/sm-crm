import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/context/AuthContext';
import {
  desativarFeedToken,
  formatAgendaError,
  gerarFeedToken,
  obterFeedToken,
  urlFeedAgenda,
} from '@/store/agenda';

export interface FeedAgendaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Confirmacao = 'gerar' | 'desativar';

/** "Sincronizar com seu calendário": the personal secret iCal URL (spec:
 *  2026-10-06-agenda-google-ics-feed). Three states: loading, no link, link. */
export function FeedAgendaDialog({ open, onOpenChange }: FeedAgendaDialogProps) {
  const { t } = useTranslation('agenda');
  const qc = useQueryClient();
  const { profile } = useAuth();
  // Scoped to the workspace so switching never shows another workspace's link.
  const chave = ['agenda-feed-token', profile?.conta_id ?? null];
  const [confirmando, setConfirmando] = useState<Confirmacao | null>(null);

  const {
    data: token,
    isPending,
    isError,
    refetch,
  } = useQuery<string | null>({
    queryKey: chave,
    queryFn: obterFeedToken,
    enabled: open,
  });

  const gerar = useMutation({
    mutationFn: gerarFeedToken,
    onSuccess: (novo) => {
      qc.setQueryData(chave, novo);
      setConfirmando(null);
    },
    onError: (err) => {
      toast.error(formatAgendaError(err, t('feed.erroLink')));
      setConfirmando(null);
    },
  });

  const desativar = useMutation({
    mutationFn: desativarFeedToken,
    onSuccess: () => {
      qc.setQueryData(chave, null);
      setConfirmando(null);
      toast.success(t('feed.desativado'));
    },
    onError: (err) => {
      toast.error(formatAgendaError(err, t('feed.erroLink')));
      setConfirmando(null);
    },
  });

  const ocupado = gerar.isPending || desativar.isPending;
  const url = token ? urlFeedAgenda(token) : null;
  const webcal = url ? url.replace(/^https:/, 'webcal:') : null;

  const copiar = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('feed.copiado'));
    } catch {
      toast.error(t('feed.erroCopiar'));
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[520px] gap-0 p-6">
          <DialogHeader className="mb-4">
            <DialogTitle>{t('feed.titulo')}</DialogTitle>
            <DialogDescription>{t('feed.descricao')}</DialogDescription>
          </DialogHeader>

          {isPending && !isError && (
            <p className="m-0 text-[13px]" style={{ color: 'var(--text-muted)' }} role="status">
              {t('loading')}
            </p>
          )}

          {isError && (
            <div className="flex flex-col items-start gap-3">
              <p className="m-0 text-[13px]" style={{ color: 'var(--danger-text)' }}>
                {t('feed.erroCarregar')}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
                {t('shared.tentarNovamente')}
              </Button>
            </div>
          )}

          {!isPending && !isError && !url && (
            <div className="flex flex-col items-start gap-4">
              <p className="m-0 text-[13px]" style={{ color: 'var(--text-muted)' }}>
                {t('feed.vazio')}
              </p>
              <Button type="button" disabled={ocupado} onClick={() => gerar.mutate()}>
                {t('feed.gerar')}
              </Button>
            </div>
          )}

          {url && webcal && (
            // ph-no-capture: the links carry the secret token; keep it out of
            // PostHog autocapture and session replay.
            <div className="ph-no-capture flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={url}
                  aria-label={t('feed.linkLabel')}
                  className="min-w-0 flex-1 text-[13px]"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button type="button" variant="outline" onClick={() => void copiar()}>
                  <Copy aria-hidden="true" />
                  {t('feed.copiar')}
                </Button>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <a
                    href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('feed.abrirGoogle')}
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={webcal}>{t('feed.abrirApple')}</a>
                </Button>
              </div>

              <p className="m-0 text-[13px]" style={{ color: 'var(--text-muted)' }}>
                {t('feed.outlook')}
              </p>

              <div
                className="flex flex-col gap-1 border-t pt-3 text-[12px]"
                style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}
              >
                <p className="m-0">{t('feed.googleDemora')}</p>
                <p className="m-0">{t('feed.aviso')}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={ocupado}
                  onClick={() => setConfirmando('gerar')}
                >
                  {t('feed.gerarNovo')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={ocupado}
                  onClick={() => setConfirmando('desativar')}
                >
                  {t('feed.desativar')}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmando !== null}
        onOpenChange={(aberto) => !aberto && !ocupado && setConfirmando(null)}
      >
        <AlertDialogContent className="sm:max-w-[400px]">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmando === 'desativar'
                ? t('feed.confirmarDesativarTitulo')
                : t('feed.confirmarGerarTitulo')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmando === 'desativar'
                ? t('feed.confirmarDesativarTexto')
                : t('feed.confirmarGerarTexto')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={ocupado}
              onClick={() => setConfirmando(null)}
            >
              {t('actions.cancel')}
            </Button>
            <Button
              type="button"
              variant={confirmando === 'desativar' ? 'destructive' : 'default'}
              disabled={ocupado}
              onClick={() => (confirmando === 'desativar' ? desativar.mutate() : gerar.mutate())}
            >
              {confirmando === 'desativar' ? t('feed.desativar') : t('feed.gerarNovo')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
