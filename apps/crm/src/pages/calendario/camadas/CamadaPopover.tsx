import { useId, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Building2, Clock, Flag, Layers, Tag, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { formatFinancialBRL, type FinancialAccess } from '@/lib/financialAccess';
import { parseDateOnly } from '../../tarefas/tarefasLogic';
import {
  PLATFORM_LABELS,
  PUBLISH_STATE_CLASS,
  PUBLISH_STATE_LABELS,
} from '../../entregas/postLabels';
import { ancoraVirtual } from '../agenda/EventoPopover';
import { NICHE_CALENDARS } from '../nicheCalendars/registry';
import { IconeDaCamada } from './icones';
import { corDaCamada, tituloDaCamada } from './toCamadaEventInput';
import { pagamentoDoItem, type PagamentoAConfirmar } from './useConfirmarPagamento';
import { CAMADA_ROTULO, type CamadaItem } from './tipos';

export interface CamadaPopoverProps {
  item: CamadaItem;
  /** Clicked chip, or the tab container as a fallback. */
  anchor: HTMLElement;
  onClose: () => void;
  /** Hands a receivable/payment to useConfirmarPagamento (its AlertDialog). */
  onConfirmar: (p: PagamentoAConfirmar) => void;
  canSeeFinancials: FinancialAccess | undefined;
}

// ---- Formatting ---------------------------------------------------------------------

const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Quarta, 7 de outubro de 2026". */
function diaComSemana(d: Date): string {
  const semana = format(d, 'EEEE', { locale: ptBR }).replace('-feira', '');
  return `${maiuscula(semana)}, ${format(d, "d 'de' MMMM 'de' yyyy", { locale: ptBR })}`;
}

/** "Faltam 3 dias", "Vence hoje", "Estourado há 2 dias". */
export function situacaoDoPrazo(diasRestantes: number, estourado: boolean): string {
  if (estourado) {
    const n = Math.abs(diasRestantes);
    return `Estourado há ${n} ${n === 1 ? 'dia' : 'dias'}`;
  }
  if (diasRestantes === 0) return 'Vence hoje';
  return diasRestantes === 1 ? 'Falta 1 dia' : `Faltam ${diasRestantes} dias`;
}

const TIPO_COMEMORATIVA: Record<string, string> = {
  br: 'Brasil',
  world: 'Mundial',
  prof: 'Profissões',
  week: 'Semana',
  month: 'Mês temático',
};

/** Tag labels of every niche plus the base ones ("br", "world", "prof"). */
function rotulosDasTags(): Record<string, string> {
  const r: Record<string, string> = {
    br: 'Brasil',
    world: 'Mundial',
    prof: 'Profissional',
    week: 'Semana',
    month: 'Mês',
  };
  for (const n of NICHE_CALENDARS) Object.assign(r, n.filterLabels);
  return r;
}

/** Subtitle under the title: when the item happens. */
function quando(item: CamadaItem): string {
  if (item.camada === 'posts') {
    const d = new Date(item.inicio);
    return `${diaComSemana(d)} · ${format(d, 'HH:mm')}`;
  }
  const d = parseDateOnly(item.dia);
  if (item.camada === 'comemorativas') {
    if (item.mesInteiro) {
      return maiuscula(format(d, "MMMM 'de' yyyy", { locale: ptBR }));
    }
    return item.ate ? `${diaComSemana(d)} até ${item.ate}` : diaComSemana(d);
  }
  if (item.camada === 'prazos') return `Prazo: ${diaComSemana(d)}`;
  return diaComSemana(d);
}

function Linha({ icone, children }: { icone: ReactNode; children: ReactNode }) {
  return (
    <div
      className="flex items-start gap-3 text-[13px] leading-[18px]"
      style={{ color: 'var(--text-main)' }}
    >
      <span
        className="mt-px flex shrink-0"
        style={{ color: 'var(--text-light)' }}
        aria-hidden="true"
      >
        {icone}
      </span>
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  );
}

const ICONE = { size: 18, strokeWidth: 1.75 } as const;

// ---- Popover ------------------------------------------------------------------------

/** Detail of a read-only layer item, with the action that leads to its screen. */
export function CamadaPopover({
  item,
  anchor,
  onClose,
  onConfirmar,
  canSeeFinancials,
}: CamadaPopoverProps) {
  const tituloId = useId();
  const navigate = useNavigate();
  const virtualRef = useMemo(() => ({ current: ancoraVirtual(anchor) }), [anchor]);
  const cor = corDaCamada(item);

  function ir(destino: string) {
    onClose();
    navigate(destino);
  }

  const titulo =
    item.camada === 'recebimentos' || item.camada === 'pagamentos'
      ? CAMADA_ROTULO[item.camada]
      : item.camada === 'prazos'
        ? item.prazo.etapaNome
        : item.camada === 'datas'
          ? item.titulo
          : item.camada === 'comemorativas'
            ? item.nome
            : tituloDaCamada(item);

  let corpo: ReactNode = null;
  let acao: ReactNode = null;

  switch (item.camada) {
    case 'posts': {
      const p = item.post;
      corpo = (
        <>
          {p.cliente_nome && <Linha icone={<Building2 {...ICONE} />}>{p.cliente_nome}</Linha>}
          <Linha icone={<Layers {...ICONE} />}>{PLATFORM_LABELS[p.platform] ?? p.platform}</Linha>
          <div>
            <span className={`post-status-chip ${PUBLISH_STATE_CLASS[item.estado]}`}>
              {PUBLISH_STATE_LABELS[item.estado]}
            </span>
          </div>
        </>
      );
      acao = (
        <Button
          type="button"
          size="sm"
          className="mb-0"
          onClick={() =>
            ir(
              p.workflow_id != null
                ? `/entregas?drawer=${p.workflow_id}&post=${p.id}`
                : `/entregas?post=${p.id}`,
            )
          }
        >
          Abrir post
        </Button>
      );
      break;
    }
    case 'prazos': {
      const pz = item.prazo;
      corpo = (
        <>
          <Linha icone={<Layers {...ICONE} />}>{`Entrega: ${pz.workflowTitle}`}</Linha>
          {pz.clienteId !== null && (
            <Linha icone={<Building2 {...ICONE} />}>{`Cliente: ${pz.clienteNome}`}</Linha>
          )}
          <Linha icone={<Clock {...ICONE} />}>
            <span
              className="font-semibold"
              style={{ color: pz.estourado ? 'var(--danger-text)' : 'var(--text-main)' }}
            >
              {situacaoDoPrazo(pz.diasRestantes, pz.estourado)}
            </span>
          </Linha>
        </>
      );
      acao = (
        <Button
          type="button"
          size="sm"
          className="mb-0"
          onClick={() => ir(`/entregas?drawer=${pz.workflowId}`)}
        >
          Abrir entrega
        </Button>
      );
      break;
    }
    case 'recebimentos':
    case 'pagamentos':
      corpo = (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {item.itens.map((i) => (
            <li
              key={i.referencia}
              className="flex items-center gap-3 rounded-[10px] border px-3 py-2 text-[13px]"
              style={{ borderColor: 'var(--border-color)' }}
            >
              <div className="min-w-0 flex-1">
                <div
                  className="truncate font-medium"
                  style={
                    i.pago ? { textDecoration: 'line-through', color: 'var(--text-muted)' } : {}
                  }
                >
                  {i.nome}
                </div>
                <div style={{ color: 'var(--text-muted)' }}>
                  {formatFinancialBRL(i.valor, canSeeFinancials ?? 'unknown')}
                </div>
                {i.ajustado && (
                  <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                    {`Dia ${i.diaConfigurado}, ajustado para o último dia do mês`}
                  </div>
                )}
              </div>
              {i.pago ? (
                <span className="badge badge-success badge--sm">Pago</span>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mb-0"
                  aria-label={`Confirmar ${i.nome}`}
                  onClick={() => {
                    onClose();
                    onConfirmar(pagamentoDoItem(i));
                  }}
                >
                  Confirmar
                </Button>
              )}
            </li>
          ))}
        </ul>
      );
      break;
    case 'datas':
      corpo = item.cliente.nome ? (
        <Linha icone={<Building2 {...ICONE} />}>{item.cliente.nome}</Linha>
      ) : null;
      acao = (
        <Button
          type="button"
          size="sm"
          className="mb-0"
          onClick={() => ir(`/clientes/${item.cliente.id}`)}
        >
          Abrir cliente
        </Button>
      );
      break;
    case 'comemorativas': {
      const rotulos = rotulosDasTags();
      const tags = item.tags.filter((t) => t !== item.tipo);
      corpo = (
        <>
          <Linha icone={<Flag {...ICONE} />}>{TIPO_COMEMORATIVA[item.tipo] ?? item.tipo}</Linha>
          {tags.length > 0 && (
            <Linha icone={<Tag {...ICONE} />}>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span key={t} className="badge badge-neutral badge--sm">
                    {rotulos[t] ?? t}
                  </span>
                ))}
              </div>
            </Linha>
          )}
        </>
      );
      break;
    }
  }

  return (
    <Popover open onOpenChange={(aberto) => !aberto && onClose()}>
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        collisionPadding={16}
        aria-labelledby={tituloId}
        className="flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-4 overflow-y-auto p-5"
        style={{
          background: 'var(--card-bg)',
          borderColor: 'var(--border-color)',
          borderRadius: 12,
          color: 'var(--text-main)',
          boxShadow: 'var(--shadow-popover, 0 12px 32px rgba(0, 0, 0, 0.16))',
          maxHeight: 'min(560px, var(--radix-popover-content-available-height, 560px))',
        }}
      >
        <div className="-mr-1.5 -mt-1.5 flex items-start gap-3">
          <span
            className="agenda-camada-swatch agenda-camada-swatch--lg mt-1"
            style={{ borderColor: cor, color: cor }}
            aria-hidden="true"
          >
            <IconeDaCamada item={item} size={14} strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <div
              className="text-[11px] font-semibold uppercase tracking-[0.06em]"
              style={{ color: 'var(--text-light)' }}
            >
              {CAMADA_ROTULO[item.camada]}
            </div>
            <h2
              id={tituloId}
              className="m-0 break-words text-[18px] font-semibold leading-tight"
              style={{ fontFamily: 'var(--font-heading)' }}
            >
              {titulo}
            </h2>
            <div className="mt-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
              {quando(item)}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mb-0 h-9 w-9 shrink-0 rounded-lg"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Fechar"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        {corpo}
        {acao && <div className="flex justify-end">{acao}</div>}
      </PopoverContent>
    </Popover>
  );
}
