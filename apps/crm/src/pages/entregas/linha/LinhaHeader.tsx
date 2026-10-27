import type { ReactNode } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
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

function dia(iso: string): string {
  return format(parseISO(iso), "d 'de' MMM", { locale: ptBR });
}

/** Subtitle: client, last send and where the linha stands. */
function subtitulo(linha: LinhaEditorial, cliente: Cliente): string {
  const partes = [cliente.nome];
  if (linha.enviada_at) partes.push(`Enviada em ${dia(linha.enviada_at)}`);
  else partes.push('Ainda não enviada');
  if (linha.status === 'enviada') partes.push('Aguardando o cliente');
  else if (linha.status === 'ajustes') partes.push('O cliente pediu ajustes');
  else if (linha.status === 'aprovada' && linha.decidida_at)
    partes.push(`Aprovada em ${dia(linha.decidida_at)}`);
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
  const { status } = linha;
  const podeEnviar = totalItens > 0 && !enviando;

  const colunas = colunasSlot ?? (
    <button type="button" className="linha-btn" onClick={onColunas}>
      <Columns3 className="h-4 w-4" />
      Colunas
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
      Link do Hub
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
        <h2 className="linha-header__title">Linha editorial de {mesLabel(linha.periodo)}</h2>
        <p className="linha-header__sub">{subtitulo(linha, cliente)}</p>
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
            Enviar ao cliente
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
                  <TooltipContent>Gere o link do Hub na página do cliente.</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <button type="button" className="linha-btn" disabled={recolhendo} onClick={onRecolher}>
              {recolhendo ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Undo2 className="h-4 w-4" />
              )}
              Recolher
            </button>
          </>
        )}
        {status === 'aprovada' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="linha-icon-btn" aria-label="Mais ações">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!podeEnviar} onSelect={onEnviar}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Enviar de novo
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
