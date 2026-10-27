import { useMemo, useState } from 'react';
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
import type { LinhaItem, LinhaStatus } from '@/store/linhaEditorial';
import { formatBreakdown } from './linhaLogic';

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
  const { t } = useTranslation('linha');
  const [pendente, setPendente] = useState<Acao | null>(null);

  // Lower-case breakdown names ("6 reels · 2 imagens").
  const breakdown = useMemo(() => {
    const ids = new Set(selected);
    return formatBreakdown(itens.filter((i) => ids.has(i.id))).map(({ tipo, n }) =>
      t(`selectionBar.tipoContagem.${tipo}`, { count: n }),
    );
  }, [itens, selected, t]);

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
        aria-label={t('selectionBar.acoes')}
        data-testid="linha-selection-bar"
      >
        <span className="drawer-selection-bar-count">
          {t('selectionBar.selecionados', { count: n })}
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
            {t('selectionBar.criarFluxo')}
          </button>
          <button type="button" className="drawer-selection-bar-btn" onClick={() => pedir('posts')}>
            {t('selectionBar.criarPosts')}
          </button>
          <button
            type="button"
            className="drawer-selection-bar-btn drawer-selection-bar-btn--ghost"
            onClick={onLimpar}
          >
            {t('ui.clear')}
          </button>
        </div>
      </div>
      <AlertDialog open={pendente != null} onOpenChange={(open) => !open && setPendente(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('selectionBar.naoAprovadaTitulo')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('selectionBar.naoAprovadaDescricao')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const acao = pendente;
                setPendente(null);
                if (acao) run(acao);
              }}
            >
              {t('selectionBar.criarMesmoAssim')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
