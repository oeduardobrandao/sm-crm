import { useId, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  AlignLeft,
  Bell,
  Building2,
  MapPin,
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
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/context/AuthContext';
import { avatarColorClass } from '@/lib/avatarColor';
import { getInitials } from '@/lib/initials';
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
import { WEEKDAY_NAMES } from '../../tarefas/recorrenciaLogic';
import { parseDateOnly } from '../../tarefas/tarefasLogic';
import { corDoEvento, descreverRegra, emFuso, rotuloLembrete } from './agendaLogic';
import { baixarIcsDaOcorrencia } from './baixarIcs';
import { EscopoEventoDialog } from './EscopoEventoDialog';
import { linkGoogleAgenda } from './googleAgenda';

export interface EventoPopoverProps {
  ocorrencia: AgendaOcorrencia;
  /** Clicked event chip, or the tab container as a fallback for deep links. */
  anchor: HTMLElement;
  onClose: () => void;
  onEditar: (o: AgendaOcorrencia) => void;
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

/** "Segunda, 5 de outubro". */
function diaComSemana(d: Date): string {
  return `${maiuscula(WEEKDAY_NAMES[d.getDay()])}, ${format(d, "d 'de' MMMM", { locale: ptBR })}`;
}

const hora = (d: Date) => format(d, 'HH:mm');

/** "5 a 7 de outubro", "30 de setembro a 2 de outubro", years only across a year boundary. */
function intervaloDeDias(ini: Date, ultimo: Date): string {
  if (ini.getFullYear() !== ultimo.getFullYear()) {
    const f = "d 'de' MMMM 'de' yyyy";
    return `${format(ini, f, { locale: ptBR })} a ${format(ultimo, f, { locale: ptBR })}`;
  }
  if (ini.getMonth() !== ultimo.getMonth()) {
    const f = "d 'de' MMMM";
    return `${format(ini, f, { locale: ptBR })} a ${format(ultimo, f, { locale: ptBR })}`;
  }
  return `${ini.getDate()} a ${format(ultimo, "d 'de' MMMM", { locale: ptBR })}`;
}

/** Timed events in the browser zone (like the grid); all-day ones as series dates. */
function quando(o: AgendaOcorrencia): string {
  if (o.dia_inteiro) {
    const ini = parseDateOnly(o.data_inicio_local);
    // data_fim_local is exclusive.
    const ultimo = addDays(parseDateOnly(o.data_fim_local), -1);
    if (ultimo <= ini) return `${diaComSemana(ini)} · Dia inteiro`;
    return intervaloDeDias(ini, ultimo);
  }
  const ini = new Date(o.inicio);
  const fim = new Date(o.fim);
  // An end at local midnight closes the start day ("22:00 a 00:00").
  const ultimoDia =
    fim.getHours() === 0 && fim.getMinutes() === 0 && fim > ini ? addDays(fim, -1) : fim;
  if (format(ini, 'yyyy-MM-dd') === format(ultimoDia, 'yyyy-MM-dd')) {
    return `${diaComSemana(ini)} · ${hora(ini)} a ${hora(fim)}`;
  }
  return `${diaComSemana(ini)} · ${hora(ini)} a ${minuscula(diaComSemana(fim))} · ${hora(fim)}`;
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
    [c.nao, 'não'],
    [c.pendente, 'aguardando'],
    [c.talvez, 'talvez'],
  ] as const;
  return {
    titulo: `${total} ${total === 1 ? 'participante' : 'participantes'}`,
    detalhe: partes
      .filter(([n]) => n > 0)
      .map(([n, rotulo]) => `${n} ${rotulo}`)
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

const BADGE: Record<
  AgendaResposta,
  { label: string; variant: 'success' | 'danger' | 'warning' | 'neutral' }
> = {
  sim: { label: 'Sim', variant: 'success' },
  nao: { label: 'Não', variant: 'danger' },
  talvez: { label: 'Talvez', variant: 'warning' },
  pendente: { label: 'Aguardando', variant: 'neutral' },
};

const CLIENTE_RESPOSTA_LABEL: Record<AgendaClienteResposta, string> = {
  sim: 'Confirmou',
  nao: 'Recusou',
  aguardando: 'Aguardando resposta',
};

/** Selo of an external guest: Confirmou / Recusou (the client's copy) or Aguardando. */
function badgeConvidado(resposta: 'sim' | 'nao' | null): {
  label: string;
  variant: 'success' | 'danger' | 'neutral';
} {
  if (resposta === 'sim') return { label: CLIENTE_RESPOSTA_LABEL.sim, variant: 'success' };
  if (resposta === 'nao') return { label: CLIENTE_RESPOSTA_LABEL.nao, variant: 'danger' };
  return { label: BADGE.pendente.label, variant: 'neutral' };
}

/** "qui., 9 de out., 14:00" (all-day: no time). Timed in the browser zone like the
 *  grid; all-day as the series-local date. */
function quandoSugerido(iso: string, o: AgendaOcorrencia): string {
  if (o.dia_inteiro) {
    return format(emFuso(iso, o.tz), "EEEEEE'.,' d 'de' MMM'.'", { locale: ptBR });
  }
  return format(new Date(iso), "EEEEEE'.,' d 'de' MMM'.,' HH:mm", { locale: ptBR });
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

const RESPOSTAS: { id: Resposta; label: string }[] = [
  { id: 'sim', label: 'Sim' },
  { id: 'nao', label: 'Não' },
  { id: 'talvez', label: 'Talvez' },
];

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

const AVATAR = { width: 28, height: 28, fontSize: 11, flexShrink: 0 } as const;

function Avatar({ pessoa }: { pessoa: Pessoa }) {
  if (pessoa.avatar_url) {
    return (
      <img
        src={pessoa.avatar_url}
        alt=""
        className="avatar"
        style={{ ...AVATAR, objectFit: 'cover' }}
      />
    );
  }
  return (
    <span className={`avatar ${avatarColorClass(pessoa.id)}`} style={AVATAR} aria-hidden="true">
      {getInitials(pessoa.nome)}
    </span>
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

// ---- Popover ------------------------------------------------------------------------

/** Event detail (spec: EventoPopover). Positioned at the anchor's current rect;
 *  closes on Esc and outside click. Sub-dialogs (RSVP scope, delete) hide the
 *  popover while open and bring it back on cancel. */
export function EventoPopover({ ocorrencia: o, anchor, onClose, onEditar }: EventoPopoverProps) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const meuId = user?.id ?? null;
  const tituloId = useId();
  const [sub, setSub] = useState<SubDialogo | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [recusando, setRecusando] = useState(false);
  const [mensagemRecusa, setMensagemRecusa] = useState('');

  const { data: roster = [] } = useQuery<Pessoa[]>({
    queryKey: ['workspace-users'],
    queryFn: getWorkspaceUsers,
  });

  const virtualRef = useMemo(() => ({ current: ancoraVirtual(anchor) }), [anchor]);

  const porId = useMemo(() => new Map(roster.map((p) => [p.id, p])), [roster]);

  const participantes = useMemo(() => {
    const nome = (id: string) => porId.get(id)?.nome ?? 'Pessoa da equipe';
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
      toast.success('Evento excluído');
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
      toast.success(aceitar ? 'Remarcação aceita' : 'Remarcação recusada');
      setEnviando(false);
      // The occurrence moved (or the request is gone): this card is stale.
      onClose();
    } catch (err) {
      toast.error(formatAgendaError(err, 'Não foi possível resolver o pedido. Tente novamente.'));
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
      ? CLIENTE_RESPOSTA_LABEL[o.cliente_resposta]
      : null;
  // External guests, hidden on masked events (the database sends null there).
  const convidados = (!mascarado && o.convidados) || [];
  const pedidoRemarcacao = !mascarado && podeEditar ? o.remarcacao_pendente : null;

  return (
    <>
      <Popover open={sub === null} onOpenChange={(aberto) => !aberto && onClose()}>
        <PopoverAnchor virtualRef={virtualRef} />
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={16}
          aria-labelledby={tituloId}
          className="flex w-[400px] max-w-[calc(100vw-32px)] flex-col gap-4 overflow-y-auto p-5"
          style={{
            background: 'var(--card-bg)',
            borderColor: 'var(--border-color)',
            borderRadius: 12,
            color: 'var(--text-main)',
            boxShadow: 'var(--shadow-popover, 0 12px 32px rgba(0, 0, 0, 0.16))',
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
                aria-label="Editar evento"
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
                aria-label="Excluir evento"
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
                    aria-label="Mais ações"
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
                    Adicionar ao Google Agenda
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void baixarIcsDaOcorrencia(o)}>
                    Baixar .ics
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
              aria-label="Fechar"
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
                    Entrar na reunião
                  </a>
                </Linha>
              )}
              {o.cliente_nome && (
                <Linha icone={<Building2 {...ICONE} />}>
                  {clienteResposta
                    ? `Cliente: ${o.cliente_nome} · ${clienteResposta}`
                    : `Cliente: ${o.cliente_nome}`}
                </Linha>
              )}
              {pedidoRemarcacao && (
                <div
                  role="group"
                  aria-label="Pedido de remarcação"
                  className="flex flex-col gap-2.5 rounded-[10px] border p-3.5 text-[13px] leading-[18px]"
                  style={{ background: 'var(--surface-1)', borderColor: 'var(--warning)' }}
                >
                  <div className="font-semibold">
                    {`${o.cliente_nome || 'O cliente'} pediu para remarcar para ${quandoSugerido(pedidoRemarcacao.inicio_sugerido, o)}`}
                  </div>
                  {pedidoRemarcacao.mensagem && (
                    <div
                      className="whitespace-pre-line break-words"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {pedidoRemarcacao.mensagem}
                    </div>
                  )}
                  {recusando ? (
                    <div className="flex flex-col gap-2">
                      <Textarea
                        aria-label="Mensagem para o cliente"
                        placeholder="Mensagem para o cliente (opcional)"
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
                          Voltar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="mb-0"
                          disabled={enviando}
                          onClick={() => void resolver(false)}
                        >
                          Enviar
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
                        Aceitar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mb-0"
                        disabled={enviando}
                        onClick={() => setRecusando(true)}
                      >
                        Recusar
                      </Button>
                    </div>
                  )}
                </div>
              )}
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
                    aria-label="Participantes"
                    className="m-0 flex list-none flex-col gap-2.5 p-0"
                  >
                    {participantes.map((p) => {
                      const pessoa = porId.get(p.user_id) ?? {
                        id: p.user_id,
                        nome: 'Pessoa da equipe',
                      };
                      const badge = BADGE[p.resposta ?? 'pendente'];
                      return (
                        <li key={p.user_id} className="flex items-center gap-2.5 text-[13px]">
                          <Avatar pessoa={pessoa} />
                          <span className="min-w-0 flex-1 truncate">
                            {pessoa.nome}
                            {p.user_id === meuId && ' (você)'}
                            {p.user_id === o.organizador_id && (
                              <span style={{ color: 'var(--text-muted)' }}> · organizador</span>
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
                  <div className="text-[13px] font-semibold">Convidados</div>
                  <ul aria-label="Convidados" className="m-0 flex list-none flex-col gap-2.5 p-0">
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
                    Vai participar?
                  </span>
                  <div role="group" aria-label="Sua resposta" className="flex gap-1.5">
                    {RESPOSTAS.map((r) => {
                      const ativa = respostaAtual === r.id;
                      return (
                        <Button
                          key={r.id}
                          type="button"
                          size="sm"
                          variant={ativa ? 'default' : 'outline'}
                          className="mb-0 min-w-[64px]"
                          aria-pressed={ativa}
                          disabled={enviando}
                          onClick={() => escolherResposta(r.id)}
                        >
                          {r.label}
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
            <AlertDialogTitle>Responder a qual evento?</AlertDialogTitle>
            <AlertDialogDescription className="sr-only">
              Escolha se a resposta vale só para este evento ou para todos os eventos da série.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={fecharSub} disabled={enviando}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={enviando}
              onClick={() => sub?.tipo === 'rsvp' && void responder(sub.resposta, 'esta')}
            >
              Este evento
            </Button>
            <Button
              type="button"
              disabled={enviando}
              onClick={() => sub?.tipo === 'rsvp' && void responder(sub.resposta, 'todas')}
            >
              Todos os eventos
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
              <AlertDialogTitle>Excluir evento?</AlertDialogTitle>
              <AlertDialogDescription>
                Os participantes recebem um aviso de cancelamento.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={fecharSub} disabled={enviando}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={enviando}
                onClick={() => void excluir('todas')}
              >
                Excluir
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
