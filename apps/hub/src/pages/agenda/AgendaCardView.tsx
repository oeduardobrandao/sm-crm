import { useEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { useTranslation } from 'react-i18next';
import {
  CalendarClock,
  Check,
  ChevronDown,
  Clock,
  Download,
  ExternalLink,
  Loader2,
  MapPin,
  MoreHorizontal,
  Video,
  X,
} from 'lucide-react';
import { StatusPill, type PillTone } from '../../components/StatusPill';
import { sanitizeExternalUrl } from '../../lib/security';
import type { AgendaItemBase, ConviteItem, HubAgendaItem } from '../../types';
import { formatarSugestao, linkGoogleAgenda, quando, type Quando } from './formatar';

/** The `t` of useTranslation('hubAgenda'), narrowed to the call shape used here. */
export type T = (key: string, fallback: string, opts?: Record<string, unknown>) => string;

export function localeDe(language: string): string {
  return language === 'en' ? 'en-US' : 'pt-BR';
}

/** "qui., 9 de out. · 14:00 às 15:00 (America/Manaus)", or without the day under a day heading. */
export function textoQuando(q: Quando, t: T, comDia: boolean): string {
  let texto: string;
  if (q.diaInteiro) {
    texto = q.diaFim
      ? t('quando.diaInteiroPeriodo', '{{inicio}} a {{fim}} · Dia inteiro', {
          inicio: q.dia,
          fim: q.diaFim,
        })
      : comDia
        ? t('quando.diaInteiroDia', '{{dia}} · Dia inteiro', { dia: q.dia })
        : t('quando.diaInteiro', 'Dia inteiro');
  } else if (q.diaFim) {
    texto = t('quando.horarioPeriodo', '{{dia}}, {{inicio}} até {{diaFim}}, {{fim}}', {
      dia: q.dia,
      inicio: q.horaInicio,
      diaFim: q.diaFim,
      fim: q.horaFim,
    });
  } else {
    const horas = t('quando.horario', '{{inicio}} às {{fim}}', {
      inicio: q.horaInicio,
      fim: q.horaFim,
    });
    texto = comDia ? `${q.dia} · ${horas}` : horas;
  }
  return q.fuso ? `${texto} (${q.fuso})` : texto;
}

/** Overrides for the answer badge (the invite page says "Você confirmou", the Hub "Confirmado"). */
export interface AgendaCardRotulos {
  seloSim?: string;
  seloNao?: string;
  seloAguardando?: string;
  seloSemResposta?: string;
}

export function selo(
  item: Pick<AgendaItemBase, 'resposta'>,
  encerrado: boolean,
  t: T,
  rotulos: AgendaCardRotulos = {},
): { tone: PillTone; texto: string } {
  if (item.resposta === 'sim')
    return { tone: 'accent', texto: rotulos.seloSim ?? t('selo.sim', 'Confirmado') };
  if (item.resposta === 'nao')
    return { tone: 'danger', texto: rotulos.seloNao ?? t('selo.nao', 'Você recusou') };
  return encerrado
    ? {
        tone: 'neutral',
        texto: rotulos.seloSemResposta ?? t('selo.semResposta', 'Sem resposta'),
      }
    : {
        tone: 'neutral',
        texto: rotulos.seloAguardando ?? t('selo.aguardando', 'Aguardando sua resposta'),
      };
}

const MENU_ITEM =
  'flex w-full items-center gap-2.5 rounded-[4px] px-2.5 py-2 text-left text-[13px] leading-snug hover:bg-[var(--hub-soft)] focus-visible:bg-[var(--hub-soft)] focus-visible:outline-none';

export interface AgendaCardViewProps {
  item: HubAgendaItem | ConviteItem;
  /** Snapshot of "now" from the page, so every card agrees on past/future. */
  agora: number;
  highlighted?: boolean;
  rotulos?: AgendaCardRotulos;
  /** Rejects with an Error whose message is shown under the card. */
  onResponder: (resposta: 'sim' | 'nao', inicioVisto: string) => Promise<void>;
  /** Absent: no "Pedir para remarcar" (the guest invite page). */
  onRemarcar?: () => void;
  /** Absent: the pending request has no "Cancelar pedido". */
  onCancelarRemarcacao?: (remarcacaoId: number) => Promise<void>;
  icsUrl: string;
  desabilitado?: boolean;
}

type Pendente = 'sim' | 'nao' | 'cancelar' | null;

/**
 * One occurrence card, presentation only: no api, no query cache, no Hub context.
 * The Hub (`AgendaCard`) and the guest invite page wire their own mutations in.
 */
export function AgendaCardView({
  item,
  agora,
  highlighted = false,
  rotulos,
  onResponder,
  onRemarcar,
  onCancelarRemarcacao,
  icsUrl,
  desabilitado = false,
}: AgendaCardViewProps) {
  const { t, i18n } = useTranslation('hubAgenda');
  const locale = localeDe(i18n.language);
  const ref = useRef<HTMLElement>(null);
  const [descricaoAberta, setDescricaoAberta] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const [pendente, setPendente] = useState<Pendente>(null);
  const [erro, setErro] = useState<string | null>(null);

  const encerrado = Date.parse(item.fim) <= agora;
  const comecou = Date.parse(item.inicio) <= agora;
  const pedido = 'remarcacao' in item ? item.remarcacao : null;
  const podeRemarcar = !!onRemarcar && !comecou && !pedido;
  const s = selo(item, encerrado, t, rotulos);
  const linkReuniao = item.link_reuniao ? sanitizeExternalUrl(item.link_reuniao) : '#';

  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }, [highlighted]);

  async function executar(tipo: Exclude<Pendente, null>, acao: () => Promise<void>) {
    setErro(null);
    setPendente(tipo);
    try {
      await acao();
    } catch (e) {
      setErro(
        (e as Error | undefined)?.message ||
          t('erros.generico', 'Não foi possível salvar. Tente novamente.'),
      );
    } finally {
      setPendente(null);
    }
  }

  const ocupado = pendente !== null || desabilitado;

  return (
    <article
      ref={ref}
      id={`ocorrencia-${item.ocorrencia_id}`}
      data-testid={`agenda-card-${item.ocorrencia_id}`}
      data-highlighted={highlighted ? 'true' : undefined}
      aria-label={item.titulo}
      className="hub-card p-4 sm:p-5 scroll-mt-24"
      style={
        highlighted ? { outline: '2px solid var(--hub-acc)', outlineOffset: '2px' } : undefined
      }
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-[15.5px] leading-snug tracking-tight hub-txt break-words">
            {item.titulo}
          </h3>
          <p className="flex items-start gap-1.5 text-[13px] hub-tx2 mt-1">
            <Clock size={14} className="mt-[3px] shrink-0" aria-hidden="true" />
            <span>{textoQuando(quando(item, locale), t, false)}</span>
          </p>
          {item.local && (
            <p className="flex items-start gap-1.5 text-[13px] hub-tx2 mt-1">
              <MapPin size={14} className="mt-[3px] shrink-0" aria-hidden="true" />
              <span className="break-words">{item.local}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <StatusPill tone={s.tone}>{s.texto}</StatusPill>
          <Popover.Root open={menuAberto} onOpenChange={setMenuAberto}>
            <Popover.Trigger asChild>
              <button
                type="button"
                aria-label={t('menu.abrir', 'Mais opções')}
                className="hub-icon-btn w-8 h-8 rounded-full flex items-center justify-center hub-tx3"
              >
                <MoreHorizontal size={17} />
              </button>
            </Popover.Trigger>
            <Popover.Portal
              container={
                typeof document !== 'undefined'
                  ? (document.querySelector<HTMLElement>('.hub-root') ?? document.body)
                  : undefined
              }
            >
              <Popover.Content
                align="end"
                sideOffset={6}
                collisionPadding={12}
                className="z-[9100] w-[240px] max-w-[calc(100vw-24px)] rounded-[4px] border p-1 focus:outline-none"
                style={{
                  background: 'var(--hub-card)',
                  color: 'var(--hub-txt)',
                  borderColor: 'var(--hub-bd2)',
                  boxShadow:
                    '0 12px 32px -12px rgba(28, 25, 23, 0.25), 0 2px 6px rgba(28, 25, 23, 0.08)',
                }}
              >
                <div role="group" aria-label={t('menu.abrir', 'Mais opções')}>
                  {podeRemarcar && (
                    <button
                      type="button"
                      className={MENU_ITEM}
                      onClick={() => {
                        setMenuAberto(false);
                        onRemarcar?.();
                      }}
                    >
                      <CalendarClock size={15} className="hub-tx3 shrink-0" aria-hidden="true" />
                      {t('menu.remarcar', 'Pedir para remarcar')}
                    </button>
                  )}
                  <a
                    className={MENU_ITEM}
                    href={linkGoogleAgenda(item, t('google.linkReuniao', 'Link da reunião'))}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMenuAberto(false)}
                  >
                    <ExternalLink size={15} className="hub-tx3 shrink-0" aria-hidden="true" />
                    {t('menu.google', 'Adicionar ao Google Agenda')}
                  </a>
                  <a
                    className={MENU_ITEM}
                    href={icsUrl}
                    download
                    onClick={() => setMenuAberto(false)}
                  >
                    <Download size={15} className="hub-tx3 shrink-0" aria-hidden="true" />
                    {t('menu.ics', 'Baixar .ics')}
                  </a>
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
      </div>

      {item.descricao && (
        <div className="mt-2.5">
          <button
            type="button"
            aria-expanded={descricaoAberta}
            onClick={() => setDescricaoAberta((v) => !v)}
            className="flex items-center gap-1 text-[12.5px] font-semibold hub-tx2"
          >
            {descricaoAberta
              ? t('card.ocultarDescricao', 'Ocultar descrição')
              : t('card.verDescricao', 'Ver descrição')}
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={`transition-transform ${descricaoAberta ? 'rotate-180' : ''}`}
            />
          </button>
          {descricaoAberta && (
            <p className="mt-1.5 text-[13.5px] leading-relaxed hub-tx2 whitespace-pre-line break-words">
              {item.descricao}
            </p>
          )}
        </div>
      )}

      {pedido && (
        <div className="mt-3 rounded-lg hub-bg-soft px-3.5 py-3 text-[13px] hub-tx2">
          <p>
            {t(
              'pedido.pendente',
              'Você pediu para remarcar para {{quando}}. Aguardando a equipe.',
              { quando: formatarSugestao(pedido.inicio_sugerido, item, locale) },
            )}
          </p>
          {pedido.mensagem && (
            <p className="mt-1 italic hub-tx3 break-words">“{pedido.mensagem}”</p>
          )}
          {onCancelarRemarcacao && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => void executar('cancelar', () => onCancelarRemarcacao(pedido.id))}
              className="mt-2 text-[12.5px] font-semibold underline hub-txt disabled:opacity-50"
            >
              {t('pedido.cancelar', 'Cancelar pedido')}
            </button>
          )}
        </div>
      )}

      {erro && (
        <p role="alert" className="mt-3 text-[13px] font-medium text-red-600">
          {erro}
        </p>
      )}

      {!encerrado && (
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={item.resposta === 'sim'}
            disabled={ocupado || item.resposta === 'sim'}
            onClick={() => void executar('sim', () => onResponder('sim', item.inicio))}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-[var(--hub-r-ctl)] text-[13px] font-semibold transition-colors disabled:cursor-default ${
              item.resposta === 'nao' ? 'hub-btn-secondary' : 'hub-btn-primary'
            } ${ocupado ? 'opacity-60' : ''}`}
          >
            {pendente === 'sim' ? (
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            ) : (
              <Check size={14} aria-hidden="true" />
            )}
            {t('acoes.confirmar', 'Confirmar')}
          </button>
          <button
            type="button"
            aria-pressed={item.resposta === 'nao'}
            disabled={ocupado || item.resposta === 'nao'}
            onClick={() => void executar('nao', () => onResponder('nao', item.inicio))}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-[var(--hub-r-ctl)] text-[13px] font-semibold transition-colors disabled:cursor-default ${
              item.resposta === 'nao' ? 'hub-btn-primary' : 'hub-btn-secondary'
            } ${ocupado ? 'opacity-60' : ''}`}
          >
            {pendente === 'nao' ? (
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            ) : (
              <X size={14} aria-hidden="true" />
            )}
            {t('acoes.naoVou', 'Não vou')}
          </button>
          {item.link_reuniao && linkReuniao !== '#' && (
            <a
              href={linkReuniao}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-[var(--hub-r-ctl)] text-[13px] font-semibold hub-btn-secondary sm:ml-auto"
            >
              <Video size={14} aria-hidden="true" />
              {t('acoes.entrar', 'Entrar na reunião')}
            </a>
          )}
        </div>
      )}
    </article>
  );
}
