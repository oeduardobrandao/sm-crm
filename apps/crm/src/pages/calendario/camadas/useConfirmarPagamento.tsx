import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
import { formatFinancialBRL, type FinancialAccess } from '@/lib/financialAccess';
import { addTransacao } from '../../../store';
import type { CamadaPagamento } from './tipos';

/** A scheduled receivable or team payment about to be marked paid. */
export interface PagamentoAConfirmar {
  refId: string;
  desc: string;
  val: number;
  cat: string;
  tipo: 'entrada' | 'saida';
}

/** The payload the "Calendário" tab builds for a client or team payment. */
export function pagamentoDoItem(item: CamadaPagamento): PagamentoAConfirmar {
  return item.alvo.tipo === 'cliente'
    ? {
        refId: item.referencia,
        desc: item.nome,
        val: item.valor,
        cat: 'Mensalidade Cliente',
        tipo: 'entrada',
      }
    : {
        refId: item.referencia,
        desc: `Pagto. ${item.nome}`,
        val: item.valor,
        cat: 'Pagamento Equipe',
        tipo: 'saida',
      };
}

/**
 * Confirm flow of a scheduled payment, shared by the "Calendário" tab and the
 * Agenda's financial layers: an AlertDialog, then `addTransacao` with the
 * `referencia_agendamento` that marks the month as paid. Render `dialog`.
 */
export function useConfirmarPagamento(canSeeFinancials: FinancialAccess): {
  pedirConfirmacao: (p: PagamentoAConfirmar) => void;
  dialog: ReactNode;
} {
  const qc = useQueryClient();
  const [confirmPayload, setConfirmPayload] = useState<PagamentoAConfirmar | null>(null);

  const handleConfirmExecute = async () => {
    if (!confirmPayload) return;
    const { refId, desc, val, cat, tipo } = confirmPayload;
    try {
      await addTransacao({
        descricao: desc,
        detalhe: 'Baixa efetuada pelo Calendário',
        categoria: cat,
        valor: val,
        data: new Date().toISOString().split('T')[0],
        tipo,
        status: 'pago',
        referencia_agendamento: refId,
      });
      toast.success('Pagamento confirmado!');
      qc.invalidateQueries({ queryKey: ['transacoes'] });
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro');
    } finally {
      setConfirmPayload(null);
    }
  };

  const dialog = (
    <AlertDialog
      open={confirmPayload !== null}
      onOpenChange={(open) => {
        if (!open) setConfirmPayload(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirmar Agendamento</AlertDialogTitle>
          <AlertDialogDescription>
            {confirmPayload &&
              `Confirmar o recebimento/pagamento agendado de ${confirmPayload.desc} (${formatFinancialBRL(confirmPayload.val, canSeeFinancials)})?`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirmExecute}>Confirmar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { pedirConfirmacao: setConfirmPayload, dialog };
}
