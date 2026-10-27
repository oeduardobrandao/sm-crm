import type { ReactNode } from 'react';
import { format, parseISO, type Locale } from 'date-fns';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useDateFnsLocale } from '@mesaas/i18n';
import { Columns3, Link2, Loader2, MoreHorizontal, RotateCcw, Send, Undo2 } from 'lucide-react';
import { ClienteFoto } from '@/components/ClienteFoto';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { Cliente } from '@/store';
import type { LinhaEditorial } from '@/store/linhaEditorial';
import { LinhaStatusBadge } from './LinhaStatusBadge';
import { mesLabel } from './linhaLogic';

interface LinhaHeaderProps {
  linha: LinhaEditorial;
  cliente: Cliente;
  fotos: string[];
  /** Rows in the linha: "Enviar ao cliente" needs at least one. */
  totalItens: number;
  /** Full Hub link, or null while the client has no usable Hub token. */
  hubUrl: string | null;
  /** The "Colunas" popover (Task 9); defaults to a plain button wired to `onColunas`. */
  colunasSlot?: ReactNode;
  onColunas?: () => void;
  onEnviar: () => void;
  onRecolher: () => void;
  onCopiarHub: (url: string) => void;
  enviando: boolean;
  recolhendo: boolean;
}

/** Subtitle: client, last send and where the linha stands. */
function subtitulo(
  linha: LinhaEditorial,
  cliente: Cliente,
  t: TFunction<'linha'>,
  locale: Locale,
): string {
  const dia = (iso: string) => format(parseISO(iso), t('shared.dayMonthFormat'), { locale });
  const partes = [cliente.nome];
  if (linha.enviada_at) partes.push(t('header.enviadaEm', { data: dia(linha.enviada_at) }));
  else partes.push(t('header.naoEnviada'));
  if (linha.status === 'enviada') partes.push(t('header.aguardando'));
  else if (linha.status === 'ajustes') partes.push(t('header.clientePediuAjustes'));
  else if (linha.status === 'aprovada' && linha.decidida_at)
    partes.push(t('header.aprovadaEm', { data: dia(linha.decidida_at) }));
  return partes.join(' · ');
}

export function LinhaHeader({
  linha,
  cliente,
  fotos,
  totalItens,
  hubUrl,
  colunasSlot,
  onColunas,
  onEnviar,
  onRecolher,
  onCopiarHub,
  enviando,
  recolhendo,
}: LinhaHeaderProps) {
  const { t } = useTranslation('linha');
  const dateLocale = useDateFnsLocale();
  const { status } = linha;
  const podeEnviar = totalItens > 0 && !enviando;

  const colunas = colunasSlot ?? (
    <button type="button" className="linha-btn" onClick={onColunas}>
      <Columns3 className="h-4 w-4" />
      {t('shared.colunas')}
    </button>
  );

  const hubBtn = (
    <button
      type="button"
      className="linha-btn"
      disabled={!hubUrl}
      onClick={() => hubUrl && onCopiarHub(hubUrl)}
    >
      <Link2 className="h-4 w-4" />
      {t('header.linkHub')}
    </button>
  );

  return (
    <header className="linha-header">
      <ClienteFoto
        srcs={fotos}
        className="linha-avatar linha-avatar--lg"
        fallback={
          <span className="linha-avatar linha-avatar--lg" style={{ background: cliente.cor }}>
            {cliente.sigla}
          </span>
        }
      />
      <div className="linha-header__text">
        <h2 className="linha-header__title">
          {t('header.titulo', { mes: mesLabel(linha.periodo) })}
        </h2>
        <p className="linha-header__sub">{subtitulo(linha, cliente, t, dateLocale)}</p>
      </div>
      <LinhaStatusBadge status={status} />
      <div className="linha-header__actions">
        {colunas}
        {(status === 'rascunho' || status === 'ajustes') && (
          <button
            type="button"
            className="linha-btn linha-btn--primary"
            disabled={!podeEnviar}
            onClick={onEnviar}
          >
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {t('shared.enviarAoCliente')}
          </button>
        )}
        {status === 'enviada' && (
          <>
            {hubUrl ? (
              hubBtn
            ) : (
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0} className="linha-tip-wrap">
                      {hubBtn}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t('header.gereLink')}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <button type="button" className="linha-btn" disabled={recolhendo} onClick={onRecolher}>
              {recolhendo ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Undo2 className="h-4 w-4" />
              )}
              {t('header.recolher')}
            </button>
          </>
        )}
        {status === 'aprovada' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="linha-icon-btn" aria-label={t('header.maisAcoes')}>
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!podeEnviar} onSelect={onEnviar}>
                <RotateCcw className="mr-2 h-4 w-4" />
                {t('header.enviarDeNovo')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
