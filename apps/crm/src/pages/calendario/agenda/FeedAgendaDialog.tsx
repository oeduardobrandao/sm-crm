import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';
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

const ERRO_LINK = 'Não foi possível atualizar o link. Tente novamente.';

type Confirmacao = 'gerar' | 'desativar';

/** "Sincronizar com seu calendário": the personal secret iCal URL (spec:
 *  2026-10-06-agenda-google-ics-feed). Three states: loading, no link, link. */
export function FeedAgendaDialog({ open, onOpenChange }: FeedAgendaDialogProps) {
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
      toast.error(formatAgendaError(err, ERRO_LINK));
      setConfirmando(null);
    },
  });

  const desativar = useMutation({
    mutationFn: desativarFeedToken,
    onSuccess: () => {
      qc.setQueryData(chave, null);
      setConfirmando(null);
      toast.success('Link desativado');
    },
    onError: (err) => {
      toast.error(formatAgendaError(err, ERRO_LINK));
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
      toast.success('Link copiado');
    } catch {
      toast.error('Não foi possível copiar. Selecione o link e copie manualmente.');
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[520px] gap-0 p-6">
          <DialogHeader className="mb-4">
            <DialogTitle>Sincronizar com seu calendário</DialogTitle>
            <DialogDescription>
              Veja seus eventos do Mesaas no Google Agenda, Apple ou Outlook.
            </DialogDescription>
          </DialogHeader>

          {isPending && !isError && (
            <p className="m-0 text-[13px]" style={{ color: 'var(--text-muted)' }} role="status">
              Carregando…
            </p>
          )}

          {isError && (
            <div className="flex flex-col items-start gap-3">
              <p className="m-0 text-[13px]" style={{ color: 'var(--danger-text)' }}>
                Não foi possível carregar o link.
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
                Tentar novamente
              </Button>
            </div>
          )}

          {!isPending && !isError && !url && (
            <div className="flex flex-col items-start gap-4">
              <p className="m-0 text-[13px]" style={{ color: 'var(--text-muted)' }}>
                Gere um link secreto para ver seus eventos do Mesaas no Google Agenda, Apple ou
                Outlook.
              </p>
              <Button type="button" disabled={ocupado} onClick={() => gerar.mutate()}>
                Gerar link
              </Button>
            </div>
          )}

          {url && webcal && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={url}
                  aria-label="Link do seu calendário"
                  className="min-w-0 flex-1 text-[13px]"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button type="button" variant="outline" onClick={() => void copiar()}>
                  <Copy aria-hidden="true" />
                  Copiar
                </Button>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <a
                    href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Abrir no Google Agenda
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={webcal}>Abrir no Apple Calendar</a>
                </Button>
              </div>

              <p className="m-0 text-[13px]" style={{ color: 'var(--text-muted)' }}>
                No Outlook, use Adicionar calendário &gt; Da Internet e cole o link.
              </p>

              <div
                className="flex flex-col gap-1 border-t pt-3 text-[12px]"
                style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}
              >
                <p className="m-0">
                  O Google Agenda pode levar algumas horas para mostrar mudanças.
                </p>
                <p className="m-0">
                  Quem tiver este link vê seus eventos. Se ele vazar, gere um novo.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={ocupado}
                  onClick={() => setConfirmando('gerar')}
                >
                  Gerar novo link
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={ocupado}
                  onClick={() => setConfirmando('desativar')}
                >
                  Desativar link
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
              {confirmando === 'desativar' ? 'Desativar link?' : 'Gerar novo link?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmando === 'desativar'
                ? 'Os calendários que usam este link deixam de mostrar seus eventos.'
                : 'O link atual para de funcionar.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={ocupado}
              onClick={() => setConfirmando(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant={confirmando === 'desativar' ? 'destructive' : 'default'}
              disabled={ocupado}
              onClick={() => (confirmando === 'desativar' ? desativar.mutate() : gerar.mutate())}
            >
              {confirmando === 'desativar' ? 'Desativar link' : 'Gerar novo link'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
