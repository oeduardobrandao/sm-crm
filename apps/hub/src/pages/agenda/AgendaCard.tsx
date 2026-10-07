import { useEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { agendaIcsUrl, cancelarRemarcacao, responderAgenda } from '../../api';
import { invalidateHubAgenda, setHubAgendaItem } from '../../queries';
import { StatusPill, type PillTone } from '../../components/StatusPill';
import { sanitizeExternalUrl } from '../../lib/security';
import type { HubAgendaItem } from '../../types';
import { formatarSugestao, linkGoogleAgenda, quando, type Quando } from './formatar';
import { RemarcarDialog } from './RemarcarDialog';

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

export function selo(
  item: HubAgendaItem,
  encerrado: boolean,
  t: T,
): { tone: PillTone; texto: string } {
  if (item.resposta === 'sim') return { tone: 'accent', texto: t('selo.sim', 'Confirmado') };
  if (item.resposta === 'nao') return { tone: 'danger', texto: t('selo.nao', 'Você recusou') };
  return encerrado
    ? { tone: 'neutral', texto: t('selo.semResposta', 'Sem resposta') }
    : { tone: 'neutral', texto: t('selo.aguardando', 'Aguardando sua resposta') };
}

const MENU_ITEM =
  'flex w-full items-center gap-2.5 rounded-[4px] px-2.5 py-2 text-left text-[13px] leading-snug hover:bg-[var(--hub-soft)] focus-visible:bg-[var(--hub-soft)] focus-visible:outline-none';

interface AgendaCardProps {
  item: HubAgendaItem;
  token: string;
  /** Snapshot of "now" from the page, so every card agrees on past/future. */
  agora: number;
  highlighted?: boolean;
}

export function AgendaCard({ item, token, agora, highlighted = false }: AgendaCardProps) {
  const { t, i18n } = useTranslation('hubAgenda');
  const locale = localeDe(i18n.language);
  const qc = useQueryClient();
  const ref = useRef<HTMLElement>(null);
  const [descricaoAberta, setDescricaoAberta] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const [remarcarAberto, setRemarcarAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const encerrado = Date.parse(item.fim) <= agora;
  const comecou = Date.parse(item.inicio) <= agora;
  const pedido = item.remarcacao;
  const podeRemarcar = !comecou && !pedido;
  const s = selo(item, encerrado, t);
  const linkReuniao = item.link_reuniao ? sanitizeExternalUrl(item.link_reuniao) : '#';

  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }, [highlighted]);

  const falha = (e: Error) => {
    setErro(e.message || t('erros.generico', 'Não foi possível salvar. Tente novamente.'));
    // Moved, ended or already resolved: show the message and reload what the client sees.
    void invalidateHubAgenda(qc, token);
  };

  const responder = useMutation({
    mutationFn: (resposta: 'sim' | 'nao') =>
      responderAgenda(token, item.ocorrencia_id, resposta, item.inicio),
    onMutate: () => setErro(null),
    onSuccess: (r) => setHubAgendaItem(qc, token, r.item),
    onError: falha,
  });

  const cancelar = useMutation({
    mutationFn: (remarcacaoId: number) => cancelarRemarcacao(token, remarcacaoId),
    onMutate: () => setErro(null),
    onSuccess: () => setHubAgendaItem(qc, token, { ...item, remarcacao: null }),
    onError: falha,
  });

  const ocupado = responder.isPending || cancelar.isPending;

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
                className="z-50 w-[240px] max-w-[calc(100vw-24px)] rounded-[4px] border p-1 focus:outline-none"
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
                        setRemarcarAberto(true);
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
                    href={agendaIcsUrl(token, item.ocorrencia_id)}
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
          <button
            type="button"
            disabled={ocupado}
            onClick={() => cancelar.mutate(pedido.id)}
            className="mt-2 text-[12.5px] font-semibold underline hub-txt disabled:opacity-50"
          >
            {t('pedido.cancelar', 'Cancelar pedido')}
          </button>
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
            onClick={() => responder.mutate('sim')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-[var(--hub-r-ctl)] text-[13px] font-semibold transition-colors disabled:cursor-default ${
              item.resposta === 'nao' ? 'hub-btn-secondary' : 'hub-btn-primary'
            } ${ocupado ? 'opacity-60' : ''}`}
          >
            {responder.isPending && responder.variables === 'sim' ? (
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
            onClick={() => responder.mutate('nao')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-[var(--hub-r-ctl)] text-[13px] font-semibold transition-colors disabled:cursor-default ${
              item.resposta === 'nao' ? 'hub-btn-primary' : 'hub-btn-secondary'
            } ${ocupado ? 'opacity-60' : ''}`}
          >
            {responder.isPending && responder.variables === 'nao' ? (
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

      {remarcarAberto && (
        <RemarcarDialog
          item={item}
          token={token}
          onClose={() => setRemarcarAberto(false)}
          onErro={() => void invalidateHubAgenda(qc, token)}
        />
      )}
    </article>
  );
}
