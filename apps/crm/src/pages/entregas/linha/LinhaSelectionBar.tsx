import { useMemo, useState } from 'react';
import type { ContentFormat } from '@mesaas/platforms';
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
import type { LinhaItem, LinhaStatus } from '@/store/linhaEditorial';
import { formatBreakdown } from './linhaLogic';

/** Lower-case breakdown names ("6 reels · 2 imagens"), singular then plural. */
const TIPO_CONTAGEM: Record<ContentFormat, [string, string]> = {
  feed: ['imagem', 'imagens'],
  carrossel: ['carrossel', 'carrosséis'],
  reels: ['reels', 'reels'],
  stories: ['stories', 'stories'],
};

export interface LinhaSelectionBarProps {
  /** Every row of the linha; the breakdown counts the selected ones. */
  itens: LinhaItem[];
  /** Selected row ids (only unconverted rows ever are). */
  selected: string[];
  linhaStatus: LinhaStatus;
  onCriarFluxo: () => void;
  onCriarPosts: () => void;
  onLimpar: () => void;
}

type Acao = 'fluxo' | 'posts';

/**
 * Floating bar over the linha's selected rows (spec 6.4), styled like the fluxo drawer's
 * `drawer-selection-bar`. Converting a linha the client has not approved asks first.
 */
export function LinhaSelectionBar({
  itens,
  selected,
  linhaStatus,
  onCriarFluxo,
  onCriarPosts,
  onLimpar,
}: LinhaSelectionBarProps) {
  const [pendente, setPendente] = useState<Acao | null>(null);

  const breakdown = useMemo(() => {
    const ids = new Set(selected);
    return formatBreakdown(itens.filter((i) => ids.has(i.id))).map(
      ({ tipo, n }) => `${n} ${TIPO_CONTAGEM[tipo][n === 1 ? 0 : 1]}`,
    );
  }, [itens, selected]);

  const run = (acao: Acao) => (acao === 'fluxo' ? onCriarFluxo() : onCriarPosts());
  const pedir = (acao: Acao) => {
    if (linhaStatus === 'aprovada') run(acao);
    else setPendente(acao);
  };

  const n = selected.length;
  return (
    <>
      <div
        className="drawer-selection-bar linha-selection-bar"
        role="toolbar"
        aria-label="Ações da seleção"
        data-testid="linha-selection-bar"
      >
        <span className="drawer-selection-bar-count">
          {n} selecionado{n === 1 ? '' : 's'}
        </span>
        {breakdown.map((b) => (
          <span key={b} className="linha-selection-bar__tipo">
            <span aria-hidden="true">&middot; </span>
            <span>{b}</span>
          </span>
        ))}
        <div className="drawer-selection-bar-actions">
          <button
            type="button"
            className="drawer-selection-bar-btn drawer-selection-bar-btn--primary"
            onClick={() => pedir('fluxo')}
          >
            Criar fluxo
          </button>
          <button type="button" className="drawer-selection-bar-btn" onClick={() => pedir('posts')}>
            Criar posts individuais
          </button>
          <button
            type="button"
            className="drawer-selection-bar-btn drawer-selection-bar-btn--ghost"
            onClick={onLimpar}
          >
            Limpar
          </button>
        </div>
      </div>
      <AlertDialog open={pendente != null} onOpenChange={(open) => !open && setPendente(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Linha não aprovada</AlertDialogTitle>
            <AlertDialogDescription>
              Esta linha ainda não foi aprovada pelo cliente. Criar mesmo assim?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const acao = pendente;
                setPendente(null);
                if (acao) run(acao);
              }}
            >
              Criar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
