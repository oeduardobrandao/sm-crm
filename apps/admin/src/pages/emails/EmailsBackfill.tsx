import { useState } from 'react';
import { History, MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { PhoneIconButton } from '@mesaas/ios-kit';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { useIsPhone } from '../../hooks/useIsPhone';
import { runEmailBackfill } from '../../lib/api';

const CONFIRM =
  'Importar os e-mails que o Resend ainda guarda? Linhas já recebidas pelo webhook não mudam.';

/** Safety cap on pages walked in one run. */
const MAX_PAGES = 500;

interface Props {
  /** Runs after the import finishes (refetch); returns the "desde" text. */
  onDone: (inserted: number) => Promise<string | null>;
  onMessage: (message: string | null) => void;
}

/** Menu "Importar histórico do Resend": confirm dialog, then walks the cursor until done. */
export function EmailsBackfill({ onDone, onMessage }: Props) {
  const isPhone = useIsPhone();
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  async function run() {
    setConfirming(false);
    setRunning(true);
    setProgress(0);
    onMessage(null);
    let cursor: string | null = null;
    let total = 0;
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const r = await runEmailBackfill(cursor);
        total += r.inserted;
        setProgress(total);
        if (r.done) break;
        cursor = r.nextCursor;
      }
      const since = await onDone(total);
      const msg = `Importados ${total.toLocaleString('pt-BR')} e-mails${since ? `, desde ${since}` : ''}`;
      onMessage(msg);
      toast.success(msg);
    } catch {
      toast.error('Não foi possível importar o histórico.');
    } finally {
      setRunning(false);
    }
  }

  const label = running
    ? `Importando... ${progress.toLocaleString('pt-BR')} e-mails`
    : 'Importar histórico do Resend';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {isPhone ? (
            <PhoneIconButton label="Mais ações" disabled={running}>
              <MoreHorizontal size={18} aria-hidden="true" />
            </PhoneIconButton>
          ) : (
            <Button variant="outline" size="sm" disabled={running} aria-label="Mais ações">
              {running ? (
                label
              ) : (
                <>
                  <MoreHorizontal />
                  Mais
                </>
              )}
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={running} onSelect={() => setConfirming(true)}>
            <History />
            Importar histórico do Resend
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {running ? (
        <span role="status" className="text-xs text-muted-foreground">
          {label}
        </span>
      ) : null}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importar histórico do Resend</DialogTitle>
            <DialogDescription>{CONFIRM}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button onClick={run}>Importar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
