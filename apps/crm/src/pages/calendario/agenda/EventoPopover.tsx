import { useId, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, format } from 'date-fns';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { getDateFnsLocale, getIntlLocale, i18n } from '@mesaas/i18n';
import {
  AlignLeft,
  Bell,
  Building2,
  MapPin,
  Download,
  ExternalLink,
  MoreHorizontal,
  MoreVertical,
  Pencil,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { useVidroShell } from '@/components/layout/PageToolbarContext';
import { Textarea } from '@/components/ui/textarea';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import { useSheetActions } from '@/components/mobile/sheetActions';
import { useAuth } from '@/context/AuthContext';
import { PessoaAvatar } from '@/components/PessoaAvatar';
import {
  AGENDA_QUERY_KEY,
  ehAgendaNaoExiste,
  excluirEvento,
  formatAgendaError,
  resolverRemarcacao,
  responderEvento,
  type AgendaClienteResposta,
  type AgendaEscopo,
  type AgendaOcorrencia,
  type AgendaResposta,
} from '@/store/agenda';
import { getWorkspaceUsers } from '@/store/workspace';
import { sanitizeUrl } from '@/utils/security';
import { parseDateOnly } from '../../tarefas/tarefasLogic';
import { corDoEvento, descreverRegra, emFuso, rotuloLembrete } from './agendaLogic';
import { baixarIcsDaOcorrencia } from './baixarIcs';
import { EscopoEventoDialog } from './EscopoEventoDialog';
import { linkGoogleAgenda } from './googleAgenda';

export interface EventoPopoverProps {
  ocorrencia: AgendaOcorrencia;
  /** Clicked event chip, or the tab container as a fallback for deep links. Unused by
   *  the sheet. */
  anchor?: HTMLElement | null;
  onClose: () => void;
  /** In the sheet it runs once the sheet's history entry is gone. */
  onEditar: (o: AgendaOcorrencia) => void;
  /** `sheet`: the phone face (FAgendaEvento), a bottom sheet the parent opens and closes
   *  with `open` (kept mounted, so closing pops its history entry). */
  apresentacao?: 'popover' | 'sheet';
  open?: boolean;
}

type Resposta = Exclude<AgendaResposta, 'pendente'>;

type SubDialogo = { tipo: 'rsvp'; resposta: Resposta } | { tipo: 'excluir' };

interface Pessoa {
  id: string;
  nome: string;
  avatar_url?: string | null;
}

// ---- Formatting ---------------------------------------------------------------------

const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const minuscula = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

const fmt = (d: Date, key: string) => format(d, i18n.t(key), { locale: getDateFnsLocale() });

/** "Segunda, 5 de outubro". */
function diaComSemana(d: Date): string {
  return i18n.t('agenda:periodo.day', {
    weekday: maiuscula(i18n.t(`agenda:logic.weekday.${d.getDay()}`)),
    date: fmt(d, 'agenda:logic.dayMonthFormat'),
  });
}

const hora = (d: Date) => format(d, 'HH:mm');

/** "5 a 7 de outubro", "30 de setembro a 2 de outubro", years only across a year boundary. */
function intervaloDeDias(ini: Date, ultimo: Date): string {
  if (ini.getFullYear() !== ultimo.getFullYear()) {
    const f = 'agenda:logic.fullDateFormat';
    return i18n.t('agenda:periodo.range', { start: fmt(ini, f), end: fmt(ultimo, f) });
  }
  if (ini.getMonth() !== ultimo.getMonth()) {
    const f = 'agenda:logic.dayMonthFormat';
    return i18n.t('agenda:periodo.range', { start: fmt(ini, f), end: fmt(ultimo, f) });
  }
  return i18n.t('agenda:periodo.range', {
    start: fmt(ini, 'agenda:periodo.sameMonthStartFormat'),
    end: fmt(ultimo, 'agenda:popover.sameMonthEndFormat'),
  });
}

/** Timed events in the browser zone (like the grid); all-day ones as series dates. */
function quando(o: AgendaOcorrencia): string {
  if (o.dia_inteiro) {
    const ini = parseDateOnly(o.data_inicio_local);
    // data_fim_local is exclusive.
    const ultimo = addDays(parseDateOnly(o.data_fim_local), -1);
    if (ultimo <= ini) return `${diaComSemana(ini)} · ${i18n.t('agenda:view.allDay')}`;
    return intervaloDeDias(ini, ultimo);
  }
  const ini = new Date(o.inicio);
  const fim = new Date(o.fim);
  // An end at local midnight closes the start day ("22:00 a 00:00").
  const ultimoDia =
    fim.getHours() === 0 && fim.getMinutes() === 0 && fim > ini ? addDays(fim, -1) : fim;
  if (format(ini, 'yyyy-MM-dd') === format(ultimoDia, 'yyyy-MM-dd')) {
    return `${diaComSemana(ini)} · ${i18n.t('agenda:view.timeRange', { start: hora(ini), end: hora(fim) })}`;
  }
  // pt lowercases the second weekday mid-sentence; English weekdays stay capitalised.
  const fimDia = diaComSemana(fim);
  return i18n.t('agenda:popover.multiDay', {
    startDay: diaComSemana(ini),
    start: hora(ini),
    endDay: getIntlLocale() === 'pt-BR' ? minuscula(fimDia) : fimDia,
    end: hora(fim),
  });
}

/** "4 participantes · 2 sim, 1 não, 1 aguardando": non-zero parts only. */
function resumoParticipantes(
  c: Record<AgendaResposta, number>,
  total: number,
): {
  titulo: string;
  detalhe: string;
} {
  const partes = [
    [c.sim, 'sim'],
    [c.nao, 'nao'],
    [c.pendente, 'pendente'],
    [c.talvez, 'talvez'],
  ] as const;
  return {
    titulo: i18n.t('agenda:popover.participantes', { count: total }),
    detalhe: partes
      .filter(([n]) => n > 0)
      .map(([n, chave]) => `${n} ${i18n.t(`agenda:popover.resumo.${chave}`)}`)
      .join(', '),
  };
}

/** The rule is labelled from the series-local start (weekday, day of month). */
function resumoDaRegra(o: AgendaOcorrencia): string | null {
  if (!o.regra) return null;
  const inicio = o.dia_inteiro ? parseDateOnly(o.data_inicio_local) : emFuso(o.inicio, o.tz);
  return descreverRegra(o.regra, inicio);
}

function lembretes(o: AgendaOcorrencia): string | null {
  if (!o.lembretes?.length) return null;
  return [...o.lembretes]
    .sort((a, b) => a - b)
    .map((m, i) => {
      const r = rotuloLembrete(m, o.dia_inteiro);
      return i === 0 ? r : minuscula(r);
    })
    .join(', ');
}

/** Only absolute http(s) links become a button; sanitizeUrl gives the href. */
function linkSeguro(link: string | null): string | null {
  if (!link || !/^https?:\/\//i.test(link.trim())) return null;
  const href = sanitizeUrl(link);
  return href === '#' ? null : href;
}

const BADGE_VARIANT: Record<AgendaResposta, 'success' | 'danger' | 'warning' | 'neutral'> = {
  sim: 'success',
  nao: 'danger',
  talvez: 'warning',
  pendente: 'neutral',
};

/** RSVP badge: label resolved at render time. */
function badgeDaResposta(r: AgendaResposta): {
  label: string;
  variant: 'success' | 'danger' | 'warning' | 'neutral';
} {
  return { label: i18n.t(`agenda:popover.badge.${r}`), variant: BADGE_VARIANT[r] };
}

const clienteRespostaLabel = (r: AgendaClienteResposta) =>
  i18n.t(`agenda:popover.clienteResposta.${r}`);

/** Selo of an external guest: Confirmou / Recusou (the client's copy) or Aguardando. */
function badgeConvidado(resposta: 'sim' | 'nao' | null): {
  label: string;
  variant: 'success' | 'danger' | 'neutral';
} {
  if (resposta === 'sim') return { label: clienteRespostaLabel('sim'), variant: 'success' };
  if (resposta === 'nao') return { label: clienteRespostaLabel('nao'), variant: 'danger' };
  return { label: badgeDaResposta('pendente').label, variant: 'neutral' };
}

/** "qui., 9 de out., 14:00" (all-day: no time). Timed in the browser zone like the
 *  grid; all-day as the series-local date. */
function quandoSugerido(iso: string, o: AgendaOcorrencia): string {
  if (o.dia_inteiro) {
    return fmt(emFuso(iso, o.tz), 'agenda:popover.sugeridoDiaFormat');
  }
  return fmt(new Date(iso), 'agenda:popover.sugeridoHoraFormat');
}

/** Max length of the team's message to the client (database limit). */
const MAX_MENSAGEM_REMARCACAO = 1000;

/** The RPC says 'agenda: este pedido já foi resolvido.' when someone got there first. */
const ehPedidoResolvido = (e: unknown) =>
  /^agenda:\s*este pedido já foi resolvido/i.test(
    e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string'
      ? (e as { message: string }).message.trim()
      : '',
  );

const RESPOSTAS: Resposta[] = ['sim', 'nao', 'talvez'];

/** Floating-ui virtual element over `anchor`: its rect is read on every
 *  measure, so the popover follows scrolls and re-layouts. A detached anchor
 *  (the grid re-rendered under it) keeps the last rect instead of jumping. */
export function ancoraVirtual(anchor: HTMLElement) {
  let ultimo = anchor.getBoundingClientRect();
  return {
    getBoundingClientRect: () => {
      if (anchor.isConnected) ultimo = anchor.getBoundingClientRect();
      return ultimo;
    },
    get contextElement() {
      return anchor.isConnected ? anchor : undefined;
    },
  };
}

// ---- Pieces -------------------------------------------------------------------------

function Avatar({ pessoa }: { pessoa: Pessoa }) {
  return (
    <PessoaAvatar
      nome={pessoa.nome}
      fotoUrl={pessoa.avatar_url}
      seed={pessoa.id}
      size={28}
      className="!text-[11px]"
    />
  );
}

function Linha({
  icone,
  children,
  muted,
}: {
  icone: ReactNode;
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <div
      className="flex items-start gap-3 text-[13px] leading-[18px]"
      style={{ color: muted ? 'var(--text-muted)' : 'var(--text-main)' }}
    >
      <span
        className="mt-px flex shrink-0"
        style={{ color: 'var(--text-light)' }}
        aria-hidden="true"
      >
        {icone}
      </span>
      <div className="min-w-0 flex-1 whitespace-pre-line break-words">{children}</div>
    </div>
  );
}

const ICONE = { size: 18, strokeWidth: 1.75 } as const;

// ---- Sheet (phones) -------------------------------------------------------------------

/** Editar, Mais ações and Fechar: the body's first row, so Editar can close the sheet
 *  before the form opens (the header sits outside the sheet's actions). */
function AcoesDoSheet({
  podeEditar,
  mostrarMais,
  onEditar,
  onMais,
}: {
  podeEditar: boolean;
  mostrarMais: boolean;
  onEditar: () => void;
  onMais: () => void;
}) {
  const { t } = useTranslation('agenda');
  const { close, closeThen } = useSheetActions();
  return (
    <div className="phone-agenda-evento__acoes">
      {podeEditar && (
        <button
          type="button"
          className="phone-agenda-evento__editar"
          onClick={() => closeThen(onEditar)}
        >
          {t('actions.edit')}
        </button>
      )}
      {mostrarMais && (
        <PhoneIconButton label={t('popover.maisAcoes')} aria-haspopup="dialog" onClick={onMais}>
          <MoreHorizontal aria-hidden="true" />
        </PhoneIconButton>
      )}
      <PhoneIconButton label={t('ui.close')} onClick={close}>
        <X aria-hidden="true" />
      </PhoneIconButton>
    </div>
  );
}

interface EventoSheetProps {
  o: AgendaOcorrencia;
  open: boolean;
  onClose: () => void;
  onEditar: (o: AgendaOcorrencia) => void;
  podeEditar: boolean;
  podeResponder: boolean;
  regra: string | null;
  href: string | null;
  textoLembretes: string | null;
  clienteResposta: string | null;
  convidados: NonNullable<AgendaOcorrencia['convidados']>;
  participantes: AgendaOcorrencia['participantes'];
  porId: Map<string, Pessoa>;
  meuId: string | null;
  resumo: { titulo: string; detalhe: string };
  respostaAtual: AgendaOcorrencia['minha_resposta'];
  enviando: boolean;
  blocoRemarcacao: ReactNode;
  onMais: () => void;
  onResponder: (r: Resposta) => void;
  /** Mais ações and the confirms: they stack over the sheet, which stays open. */
  children: ReactNode;
}

/** The event detail as a bottom sheet (FAgendaEvento): same content and actions as the
 *  popover, laid out as grouped rows. */
function EventoSheet({
  o,
  open,
  onClose,
  onEditar,
  podeEditar,
  podeResponder,
  regra,
  href,
  textoLembretes,
  clienteResposta,
  convidados,
  participantes,
  porId,
  meuId,
  resumo,
  respostaAtual,
  enviando,
  blocoRemarcacao,
  onMais,
  onResponder,
  children,
}: EventoSheetProps) {
  const { t } = useTranslation('agenda');
  const mascarado = o.mascarado;
  const temDetalhes = !mascarado && (o.local || href || o.cliente_nome || textoLembretes);
  return (
    <>
      <BottomSheet
        open={open}
        onOpenChange={(aberto) => !aberto && onClose()}
        title={o.titulo}
        hideTitle
        showClose={false}
        detents={['medium', 'large']}
        className="phone-agenda-evento-sheet"
      >
        <div className="phone-agenda-evento">
          <AcoesDoSheet
            podeEditar={podeEditar}
            mostrarMais={!mascarado || podeEditar}
            onEditar={() => onEditar(o)}
            onMais={onMais}
          />
          <div className="phone-agenda-evento__topo">
            <span
              className="phone-agenda-evento__cor"
              style={{ background: corDoEvento(o) }}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="phone-agenda-evento__titulo" aria-hidden="true">
                {o.titulo}
              </p>
              <p className="phone-agenda-evento__quando">{quando(o)}</p>
              {regra && <p className="phone-agenda-evento__quando">{regra}</p>}
            </div>
          </div>

          {temDetalhes && (
            <GroupedList aria-label={t('popover.detalhes')}>
              {o.local && <Cell icon={<MapPin aria-hidden="true" />} label={o.local} />}
              {href && (
                <li className="phone-cell">
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="phone-cell__main"
                  >
                    <span className="phone-cell__icon" aria-hidden="true">
                      <Video />
                    </span>
                    <span className="phone-cell__body">
                      <span className="phone-cell__text">
                        <span className="phone-cell__label">{t('popover.entrarReuniao')}</span>
                      </span>
                    </span>
                  </a>
                </li>
              )}
              {o.cliente_nome && (
                <Cell
                  icon={<Building2 aria-hidden="true" />}
                  label={
                    clienteResposta
                      ? `${t('popover.cliente', { nome: o.cliente_nome })} · ${clienteResposta}`
                      : t('popover.cliente', { nome: o.cliente_nome })
                  }
                />
              )}
              {textoLembretes && <Cell icon={<Bell aria-hidden="true" />} label={textoLembretes} />}
            </GroupedList>
          )}
          {blocoRemarcacao && <div className="phone-agenda-evento__bloco">{blocoRemarcacao}</div>}
          {!mascarado && o.descricao && (
            <p className="phone-agenda-evento__descricao">{o.descricao}</p>
          )}

          {!mascarado && participantes.length > 0 && (
            <GroupedList header={`${resumo.titulo} · ${resumo.detalhe}`} headerAs="h3">
              {participantes.map((p) => {
                const pessoa = porId.get(p.user_id) ?? {
                  id: p.user_id,
                  nome: t('shared.pessoaEquipe'),
                };
                const badge = badgeDaResposta(p.resposta ?? 'pendente');
                const papel =
                  p.user_id === o.organizador_id ? ` · ${t('popover.organizador')}` : '';
                const nome =
                  p.user_id === meuId ? t('sidebar.voce', { nome: pessoa.nome }) : pessoa.nome;
                return (
                  <Cell
                    key={p.user_id}
                    icon={<Avatar pessoa={pessoa} />}
                    label={`${nome}${papel}`}
                    accessory={
                      <Badge variant={badge.variant} size="sm">
                        {badge.label}
                      </Badge>
                    }
                  />
                );
              })}
            </GroupedList>
          )}

          {convidados.length > 0 && (
            <GroupedList header={t('popover.convidados')} headerAs="h3">
              {convidados.map((c) => {
                const badge = badgeConvidado(c.resposta);
                return (
                  <Cell
                    key={c.id}
                    label={c.nome || c.email}
                    subtitle={c.nome ? c.email : undefined}
                    accessory={
                      <Badge variant={badge.variant} size="sm">
                        {badge.label}
                      </Badge>
                    }
                  />
                );
              })}
            </GroupedList>
          )}

          {podeResponder && (
            <div className="phone-agenda-evento__rsvp">
              <span>{t('popover.vaiParticipar')}</span>
              <div
                role="group"
                aria-label={t('popover.suaResposta')}
                className="phone-agenda-evento__respostas"
              >
                {RESPOSTAS.map((r) => {
                  const ativa = respostaAtual === r;
                  return (
                    <button
                      key={r}
                      type="button"
                      className="phone-agenda-evento__resposta"
                      aria-pressed={ativa}
                      disabled={enviando}
                      onClick={() => onResponder(r)}
                    >
                      {t(`popover.badge.${r}`)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </BottomSheet>
      {children}
    </>
  );
}

// ---- Popover ------------------------------------------------------------------------

/** Event detail (spec: EventoPopover). Positioned at the anchor's current rect;
 *  closes on Esc and outside click. Sub-dialogs (RSVP scope, delete) hide the
 *  popover while open and bring it back on cancel. */
export function EventoPopover({
  ocorrencia: o,
  anchor,
  onClose,
  onEditar,
  apresentacao = 'popover',
  open = true,
}: EventoPopoverProps) {
  const { t } = useTranslation('agenda');
  const qc = useQueryClient();
  const { user } = useAuth();
  const meuId = user?.id ?? null;
  const tituloId = useId();
  const [sub, setSub] = useState<SubDialogo | null>(null);
  const vidro = useVidroShell();
  const [enviando, setEnviando] = useState(false);
  const [recusando, setRecusando] = useState(false);
  const [mensagemRecusa, setMensagemRecusa] = useState('');

  const { data: roster = [] } = useQuery<Pessoa[]>({
    queryKey: ['workspace-users'],
    queryFn: getWorkspaceUsers,
  });

  const virtualRef = useMemo(() => (anchor ? { current: ancoraVirtual(anchor) } : null), [anchor]);
  const [maisAberto, setMaisAberto] = useState(false);

  const porId = useMemo(() => new Map(roster.map((p) => [p.id, p])), [roster]);

  const participantes = useMemo(() => {
    const nome = (id: string) => porId.get(id)?.nome ?? i18n.t('agenda:shared.pessoaEquipe');
    return [...o.participantes].sort((a, b) => {
      if (a.user_id === o.organizador_id) return -1;
      if (b.user_id === o.organizador_id) return 1;
      return nome(a.user_id).localeCompare(nome(b.user_id), 'pt-BR');
    });
  }, [o.participantes, o.organizador_id, porId]);

  const contagem = useMemo(() => {
    const c = { sim: 0, nao: 0, talvez: 0, pendente: 0 };
    for (const p of o.participantes) c[p.resposta ?? 'pendente'] += 1;
    return c;
  }, [o.participantes]);

  const resumo = resumoParticipantes(contagem, participantes.length);

  const invalidarAgenda = () => qc.invalidateQueries({ queryKey: [AGENDA_QUERY_KEY] });

  /** The event is gone: refresh the grid and drop the popover. Other errors
   *  (permission, validation) keep it open. */
  const fecharSeSumiu = (err: unknown) => {
    if (!ehAgendaNaoExiste(err)) return;
    void invalidarAgenda();
    setSub(null);
    onClose();
  };

  const responder = async (resposta: Resposta, escopo: 'esta' | 'todas') => {
    setEnviando(true);
    try {
      await responderEvento(o.ocorrencia_id, resposta, escopo);
      void invalidarAgenda();
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      setSub(null);
    } catch (err) {
      toast.error(formatAgendaError(err));
      fecharSeSumiu(err);
    } finally {
      setEnviando(false);
    }
  };

  const escolherResposta = (resposta: Resposta) => {
    if (o.recorrente) setSub({ tipo: 'rsvp', resposta });
    else void responder(resposta, 'todas');
  };

  const excluir = async (escopo: AgendaEscopo) => {
    setEnviando(true);
    try {
      await excluirEvento(o.ocorrencia_id, escopo);
      void invalidarAgenda();
      toast.success(t('popover.excluido'));
      setEnviando(false);
      setSub(null);
      onClose();
    } catch (err) {
      toast.error(formatAgendaError(err));
      setEnviando(false);
      fecharSeSumiu(err);
    }
  };

  const resolver = async (aceitar: boolean) => {
    const pedido = o.remarcacao_pendente;
    if (!pedido) return;
    setEnviando(true);
    try {
      await resolverRemarcacao(pedido.id, aceitar, aceitar ? undefined : mensagemRecusa);
      void invalidarAgenda();
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      toast.success(aceitar ? t('popover.remarcacaoAceita') : t('popover.remarcacaoRecusada'));
      setEnviando(false);
      // The occurrence moved (or the request is gone): this card is stale.
      onClose();
    } catch (err) {
      toast.error(formatAgendaError(err, t('popover.erroResolver')));
      setEnviando(false);
      if (ehPedidoResolvido(err)) {
        void invalidarAgenda();
        onClose();
        return;
      }
      fecharSeSumiu(err);
    }
  };

  const fecharSub = () => {
    if (!enviando) setSub(null);
  };

  const mascarado = o.mascarado;
  const podeEditar = o.pode_editar && !mascarado;
  const podeResponder = o.pode_responder && !mascarado;
  const regra = mascarado ? null : resumoDaRegra(o);
  const href = mascarado ? null : linkSeguro(o.link_reuniao);
  const textoLembretes = mascarado ? null : lembretes(o);
  const respostaAtual = o.minha_resposta;
  const clienteResposta =
    !mascarado && o.compartilhado_cliente && o.cliente_resposta
      ? clienteRespostaLabel(o.cliente_resposta)
      : null;
  // External guests, hidden on masked events (the database sends null there).
  const convidados = (!mascarado && o.convidados) || [];
  const pedidoRemarcacao = !mascarado && podeEditar ? o.remarcacao_pendente : null;

  const blocoRemarcacao = pedidoRemarcacao && (
    <div
      role="group"
      aria-label={t('popover.pedidoRemarcacao')}
      className="flex flex-col gap-2.5 rounded-[10px] border p-3.5 text-[13px] leading-[18px]"
      style={{ background: 'var(--surface-1)', borderColor: 'var(--warning)' }}
    >
      <div className="font-semibold">
        {t('popover.remarcacaoPedido', {
          cliente: o.cliente_nome || t('popover.oCliente'),
          quando: quandoSugerido(pedidoRemarcacao.inicio_sugerido, o),
        })}
      </div>
      {pedidoRemarcacao.mensagem && (
        <div className="whitespace-pre-line break-words" style={{ color: 'var(--text-muted)' }}>
          {pedidoRemarcacao.mensagem}
        </div>
      )}
      {recusando ? (
        <div className="flex flex-col gap-2">
          <Textarea
            aria-label={t('popover.mensagemCliente')}
            placeholder={t('popover.mensagemClientePlaceholder')}
            rows={3}
            maxLength={MAX_MENSAGEM_REMARCACAO}
            value={mensagemRecusa}
            onChange={(e) => setMensagemRecusa(e.target.value)}
            disabled={enviando}
            className="resize-none"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mb-0"
              disabled={enviando}
              onClick={() => {
                setRecusando(false);
                setMensagemRecusa('');
              }}
            >
              {t('actions.back')}
            </Button>
            <Button
              type="button"
              size="sm"
              className="mb-0"
              disabled={enviando}
              onClick={() => void resolver(false)}
            >
              {t('popover.enviar')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            className="mb-0"
            disabled={enviando}
            onClick={() => void resolver(true)}
          >
            {t('popover.aceitar')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mb-0"
            disabled={enviando}
            onClick={() => setRecusando(true)}
          >
            {t('popover.recusar')}
          </Button>
        </div>
      )}
    </div>
  );

  if (apresentacao === 'sheet') {
    return (
      <EventoSheet
        o={o}
        open={open}
        onClose={onClose}
        onEditar={onEditar}
        podeEditar={podeEditar}
        podeResponder={podeResponder}
        regra={regra}
        href={href}
        textoLembretes={textoLembretes}
        clienteResposta={clienteResposta}
        convidados={convidados}
        participantes={participantes}
        porId={porId}
        meuId={meuId}
        resumo={resumo}
        respostaAtual={respostaAtual}
        enviando={enviando}
        blocoRemarcacao={blocoRemarcacao}
        onMais={() => setMaisAberto(true)}
        onResponder={escolherResposta}
      >
        <ActionSheet
          open={maisAberto}
          onOpenChange={setMaisAberto}
          title={t('popover.maisAcoes')}
          hideTitle
          actions={[
            ...(mascarado
              ? []
              : [
                  {
                    label: t('popover.adicionarGoogle'),
                    icon: <ExternalLink aria-hidden="true" />,
                    immediate: true,
                    onSelect: () =>
                      window.open(linkGoogleAgenda(o), '_blank', 'noopener,noreferrer'),
                  },
                  {
                    label: t('popover.baixarIcs'),
                    icon: <Download aria-hidden="true" />,
                    immediate: true,
                    onSelect: () => void baixarIcsDaOcorrencia(o),
                  },
                ]),
            ...(podeEditar
              ? [
                  {
                    label: t('popover.excluir'),
                    icon: <Trash2 aria-hidden="true" />,
                    destructive: true,
                    onSelect: () => setSub({ tipo: 'excluir' }),
                  },
                ]
              : []),
          ]}
        />
        <PhoneConfirmSheet
          open={sub?.tipo === 'rsvp'}
          title={t('popover.responderQual')}
          onCancel={fecharSub}
          actions={
            sub?.tipo === 'rsvp'
              ? (['esta', 'todas'] as const).map((escopo) => ({
                  label: escopo === 'esta' ? t('popover.esteEvento') : t('popover.todosEventos'),
                  onSelect: () => void responder(sub.resposta, escopo).then(() => setSub(null)),
                }))
              : []
          }
        />
        <PhoneConfirmSheet
          open={sub?.tipo === 'excluir'}
          title={o.recorrente ? t('popover.excluirRecorrenteTitulo') : t('popover.excluirTitulo')}
          message={t('popover.excluirAviso')}
          onCancel={fecharSub}
          actions={(o.recorrente
            ? ([
                ['esta', 'popover.esteEvento'],
                ['seguintes', 'popover.esteESeguintes'],
                ['todas', 'popover.todosEventos'],
              ] as const)
            : ([['todas', 'popover.excluir']] as const)
          ).map(([escopo, chave]) => ({
            label: t(chave),
            destructive: true,
            onSelect: () => void excluir(escopo).then(() => setSub(null)),
          }))}
        />
      </EventoSheet>
    );
  }

  return (
    <>
      <Popover open={sub === null} onOpenChange={(aberto) => !aberto && onClose()}>
        {virtualRef && <PopoverAnchor virtualRef={virtualRef} />}
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={16}
          aria-labelledby={tituloId}
          className="flex w-[400px] max-w-[calc(100vw-32px)] flex-col gap-4 overflow-y-auto p-5"
          // Under Vidro, overlays.css paints the menu glass; these inline surface styles would beat it.
          style={{
            ...(vidro
              ? undefined
              : {
                  background: 'var(--card-bg)',
                  borderColor: 'var(--border-color)',
                  borderRadius: 12,
                }),
            color: 'var(--text-main)',
            ...(vidro
              ? undefined
              : { boxShadow: 'var(--shadow-popover, 0 12px 32px rgba(0, 0, 0, 0.16))' }),
            maxHeight: 'min(640px, var(--radix-popover-content-available-height, 640px))',
          }}
        >
          <div className="-mr-1.5 -mt-1.5 flex justify-end gap-1">
            {podeEditar && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mb-0 h-9 w-9 rounded-lg"
                style={{ color: 'var(--text-muted)' }}
                aria-label={t('popover.editarEvento')}
                onClick={() => onEditar(o)}
              >
                <Pencil aria-hidden="true" />
              </Button>
            )}
            {podeEditar && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mb-0 h-9 w-9 rounded-lg"
                style={{ color: 'var(--text-muted)' }}
                aria-label={t('popover.excluirEvento')}
                onClick={() => setSub({ tipo: 'excluir' })}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            )}
            {!mascarado && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="mb-0 h-9 w-9 rounded-lg"
                    style={{ color: 'var(--text-muted)' }}
                    aria-label={t('popover.maisAcoes')}
                  >
                    <MoreVertical aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                {/* z-index above the popover (9012): both portal to <body>, so the
                    menu's default 9011 would open behind the card it belongs to. */}
                <DropdownMenuContent align="end" className="z-[9013]">
                  <DropdownMenuItem
                    onSelect={() =>
                      window.open(linkGoogleAgenda(o), '_blank', 'noopener,noreferrer')
                    }
                  >
                    {t('popover.adicionarGoogle')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void baixarIcsDaOcorrencia(o)}>
                    {t('popover.baixarIcs')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mb-0 h-9 w-9 rounded-lg"
              style={{ color: 'var(--text-muted)' }}
              aria-label={t('ui.close')}
              onClick={onClose}
            >
              <X aria-hidden="true" />
            </Button>
          </div>

          <div className="flex items-start gap-3">
            <span
              className="mt-1.5 shrink-0 rounded"
              style={{ width: 14, height: 14, background: corDoEvento(o) }}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <h2
                id={tituloId}
                className="m-0 break-words text-[20px] font-semibold leading-tight"
                style={{ fontFamily: 'var(--font-heading)' }}
              >
                {o.titulo}
              </h2>
              <div className="mt-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
                {quando(o)}
              </div>
              {regra && (
                <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                  {regra}
                </div>
              )}
            </div>
          </div>

          {!mascarado && (
            <>
              {o.local && <Linha icone={<MapPin {...ICONE} />}>{o.local}</Linha>}
              {href && (
                <Linha icone={<Video {...ICONE} />}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline-offset-2 hover:underline"
                    style={{ color: 'var(--text-main)' }}
                  >
                    {t('popover.entrarReuniao')}
                  </a>
                </Linha>
              )}
              {o.cliente_nome && (
                <Linha icone={<Building2 {...ICONE} />}>
                  {clienteResposta
                    ? `${t('popover.cliente', { nome: o.cliente_nome })} · ${clienteResposta}`
                    : t('popover.cliente', { nome: o.cliente_nome })}
                </Linha>
              )}
              {blocoRemarcacao}
              {textoLembretes && <Linha icone={<Bell {...ICONE} />}>{textoLembretes}</Linha>}
              {o.descricao && (
                <Linha icone={<AlignLeft {...ICONE} />} muted>
                  {o.descricao}
                </Linha>
              )}

              {participantes.length > 0 && (
                <div
                  className="flex flex-col gap-2.5 border-t pt-3.5"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <div className="text-[13px] font-semibold">
                    <span>{resumo.titulo}</span>{' '}
                    <span className="font-normal" style={{ color: 'var(--text-muted)' }}>
                      {`· ${resumo.detalhe}`}
                    </span>
                  </div>
                  <ul
                    aria-label={t('popover.participantesLabel')}
                    className="m-0 flex list-none flex-col gap-2.5 p-0"
                  >
                    {participantes.map((p) => {
                      const pessoa = porId.get(p.user_id) ?? {
                        id: p.user_id,
                        nome: t('shared.pessoaEquipe'),
                      };
                      const badge = badgeDaResposta(p.resposta ?? 'pendente');
                      return (
                        <li key={p.user_id} className="flex items-center gap-2.5 text-[13px]">
                          <Avatar pessoa={pessoa} />
                          <span className="min-w-0 flex-1 truncate">
                            {p.user_id === meuId
                              ? t('sidebar.voce', { nome: pessoa.nome })
                              : pessoa.nome}
                            {p.user_id === o.organizador_id && (
                              <span style={{ color: 'var(--text-muted)' }}>
                                {` · ${t('popover.organizador')}`}
                              </span>
                            )}
                          </span>
                          <Badge variant={badge.variant} size="sm">
                            {badge.label}
                          </Badge>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {convidados.length > 0 && (
                <div
                  className="flex flex-col gap-2.5 border-t pt-3.5"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <div className="text-[13px] font-semibold">{t('popover.convidados')}</div>
                  <ul
                    aria-label={t('popover.convidados')}
                    className="m-0 flex list-none flex-col gap-2.5 p-0"
                  >
                    {convidados.map((c) => {
                      const badge = badgeConvidado(c.resposta);
                      return (
                        <li key={c.id} className="flex items-center gap-2.5 text-[13px]">
                          <span className="min-w-0 flex-1 truncate">
                            {c.nome ? (
                              <>
                                {c.nome}
                                <span style={{ color: 'var(--text-muted)' }}> · {c.email}</span>
                              </>
                            ) : (
                              c.email
                            )}
                          </span>
                          <Badge variant={badge.variant} size="sm">
                            {badge.label}
                          </Badge>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {podeResponder && (
                <div
                  className="flex flex-wrap items-center gap-2.5 border-t pt-3.5"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <span className="flex-auto text-[13px]" style={{ color: 'var(--text-muted)' }}>
                    {t('popover.vaiParticipar')}
                  </span>
                  <div role="group" aria-label={t('popover.suaResposta')} className="flex gap-1.5">
                    {RESPOSTAS.map((r) => {
                      const ativa = respostaAtual === r;
                      return (
                        <Button
                          key={r}
                          type="button"
                          size="sm"
                          variant={ativa ? 'default' : 'outline'}
                          className="mb-0 min-w-[64px]"
                          aria-pressed={ativa}
                          disabled={enviando}
                          onClick={() => escolherResposta(r)}
                        >
                          {t(`popover.badge.${r}`)}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </PopoverContent>
      </Popover>

      <AlertDialog open={sub?.tipo === 'rsvp'} onOpenChange={(aberto) => !aberto && fecharSub()}>
        <AlertDialogContent className="sm:max-w-[400px]">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('popover.responderQual')}</AlertDialogTitle>
            <AlertDialogDescription className="sr-only">
              {t('popover.responderQualDescricao')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={fecharSub} disabled={enviando}>
              {t('actions.cancel')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={enviando}
              onClick={() => sub?.tipo === 'rsvp' && void responder(sub.resposta, 'esta')}
            >
              {t('popover.esteEvento')}
            </Button>
            <Button
              type="button"
              disabled={enviando}
              onClick={() => sub?.tipo === 'rsvp' && void responder(sub.resposta, 'todas')}
            >
              {t('popover.todosEventos')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {o.recorrente ? (
        <EscopoEventoDialog
          open={sub?.tipo === 'excluir'}
          acao="excluir"
          pendente={enviando}
          onCancel={fecharSub}
          onConfirm={(escopo) => void excluir(escopo)}
        />
      ) : (
        <AlertDialog
          open={sub?.tipo === 'excluir'}
          onOpenChange={(aberto) => !aberto && fecharSub()}
        >
          <AlertDialogContent className="sm:max-w-[400px]">
            <AlertDialogHeader>
              <AlertDialogTitle>{t('popover.excluirTitulo')}</AlertDialogTitle>
              <AlertDialogDescription>{t('popover.excluirAviso')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={fecharSub} disabled={enviando}>
                {t('actions.cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={enviando}
                onClick={() => void excluir('todas')}
              >
                {t('popover.excluir')}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
