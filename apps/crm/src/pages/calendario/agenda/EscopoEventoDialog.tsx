import { useEffect, useId, useState } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { AgendaEscopo } from '@/store/agenda';

export interface EscopoEventoDialogProps {
  open: boolean;
  acao: 'editar' | 'excluir';
  /** "Este evento" is off when a series-level field changed. */
  esteDesabilitado?: boolean;
  /** Helper under the disabled option, e.g. "Vale para toda a série: você mudou a repetição." */
  motivo?: string | null;
  /** Save in flight: buttons disabled and Esc ignored. */
  pendente?: boolean;
  onCancel: () => void;
  onConfirm: (escopo: AgendaEscopo) => void;
}

const OPCOES: { id: AgendaEscopo; label: string }[] = [
  { id: 'esta', label: 'Este evento' },
  { id: 'seguintes', label: 'Este e os seguintes' },
  { id: 'todas', label: 'Todos os eventos' },
];

/** "Este evento / Este e os seguintes / Todos os eventos" for a recurring event
 *  (spec: EscopoEventoDialog). The parent owns `open` and runs the save. */
export function EscopoEventoDialog({
  open,
  acao,
  esteDesabilitado = false,
  motivo,
  pendente = false,
  onCancel,
  onConfirm,
}: EscopoEventoDialogProps) {
  const nome = useId();
  const padrao: AgendaEscopo = esteDesabilitado ? 'seguintes' : 'esta';
  const [escopo, setEscopo] = useState<AgendaEscopo>(padrao);

  // Every opening starts from the default choice.
  useEffect(() => {
    if (open) setEscopo(padrao);
  }, [open, padrao]);

  const excluir = acao === 'excluir';

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !pendente && onCancel()}>
      <AlertDialogContent className="sm:max-w-[420px]">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {excluir ? 'Excluir evento recorrente?' : 'Editar evento recorrente'}
          </AlertDialogTitle>
          <AlertDialogDescription className="sr-only">
            Escolha a quais eventos da série a alteração se aplica.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div role="radiogroup" aria-label="Aplicar a" className="flex flex-col gap-1">
          {OPCOES.map((op) => {
            const desabilitado = op.id === 'esta' && esteDesabilitado;
            return (
              <div key={op.id}>
                <label
                  className="flex items-center gap-2.5 py-2 text-sm"
                  style={{ opacity: desabilitado ? 0.5 : 1 }}
                >
                  <input
                    type="radio"
                    name={nome}
                    value={op.id}
                    checked={escopo === op.id}
                    disabled={desabilitado || pendente}
                    onChange={() => setEscopo(op.id)}
                    className="h-[18px] w-[18px] accent-[var(--text-main)]"
                  />
                  {op.label}
                </label>
                {desabilitado && motivo && (
                  <p className="-mt-1 ml-7 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {motivo}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        {excluir && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Os participantes recebem um aviso de cancelamento.
          </p>
        )}
        <AlertDialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onCancel} disabled={pendente}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant={excluir ? 'destructive' : 'default'}
            disabled={pendente || (escopo === 'esta' && esteDesabilitado)}
            onClick={() => onConfirm(escopo)}
          >
            {excluir ? 'Excluir' : 'Salvar'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
