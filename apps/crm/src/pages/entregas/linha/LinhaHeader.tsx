import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { format, parseISO, type Locale } from 'date-fns';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useDateFnsLocale } from '@mesaas/i18n';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
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
import { linhaTitulo } from './linhaLogic';

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
  /** Saves the custom title: trimmed, null brings back the derived one (spec §14.3). */
  onRenomear: (titulo: string | null) => void;
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

/**
 * The header title (spec §14.3): a button that swaps in an input. Enter or blur saves, Escape
 * cancels; the value is trimmed and empty saves null. An unchanged value saves nothing.
 */
function LinhaTitulo({
  linha,
  onRenomear,
}: {
  linha: LinhaEditorial;
  onRenomear: (titulo: string | null) => void;
}) {
  const { t } = useTranslation('linha');
  const atual = linha.titulo?.trim() || null;
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState('');
  // Enter and Escape close the input, and the blur that follows must not save again.
  const fechado = useRef(false);

  useUnsavedWork(editando && (rascunho.trim() || null) !== atual);

  const abrir = () => {
    fechado.current = false;
    setRascunho(atual ?? '');
    setEditando(true);
  };

  const fechar = (salvar: boolean) => {
    if (fechado.current) return;
    fechado.current = true;
    setEditando(false);
    if (!salvar) return;
    const novo = rascunho.trim() || null;
    if (novo !== atual) onRenomear(novo);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      fechar(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      fechar(false);
    }
  };

  return (
    <h2 className="linha-header__title">
      {editando ? (
        <input
          className="linha-header__title-input"
          aria-label={t('header.tituloInput')}
          maxLength={120}
          autoFocus
          value={rascunho}
          placeholder={linhaTitulo({ periodo: linha.periodo })}
          onChange={(e) => setRascunho(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => fechar(true)}
        />
      ) : (
        <button
          type="button"
          className="linha-header__title-btn"
          title={t('header.renomear')}
          onClick={abrir}
        >
          {linhaTitulo(linha)}
        </button>
      )}
    </h2>
  );
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
  onRenomear,
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
        <LinhaTitulo linha={linha} onRenomear={onRenomear} />
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
