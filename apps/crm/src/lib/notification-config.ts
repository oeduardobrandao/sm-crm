import {
  AlarmClock,
  AlertCircle,
  AlertTriangle,
  AtSign,
  Bell,
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  CalendarX,
  CheckCircle,
  CheckSquare,
  ClipboardCheck,
  Clock,
  FilePen,
  HardDrive,
  Instagram,
  Lightbulb,
  MessageSquare,
  Paperclip,
  Play,
  Shield,
  Trophy,
  UserCheck,
  UserMinus,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { format, isValid, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { NotificationType } from '../store';
import { STATUS_LABELS } from '../pages/entregas/postLabels';
import { formatStorageBytes } from '../components/usage/usage-meter-state';

type Tone = 'success' | 'warning' | 'danger' | 'teal' | 'primary';

export interface NotificationDisplay {
  icon: LucideIcon;
  tone: Tone;
  title: string;
  body: string;
}

export const NOTIFICATION_TONE_COLOR: Record<Tone, string> = {
  success: '#3ecf8e',
  warning: '#f5a342',
  danger: '#f55a42',
  teal: '#42c8f5',
  primary: '#eab308',
};

export const NOTIFICATION_FALLBACK_ICON: LucideIcon = Bell;

const s = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.length > 0 ? v : fallback;

/** "seg., 5 de out., 14:00" (all-day: no time). Shown in the viewer's timezone. */
function formatEventWhen(m: Record<string, unknown>): string {
  const allDay = m.dia_inteiro === true;
  const raw = allDay ? m.data_local : m.inicio;
  const d = typeof raw === 'string' ? parseISO(raw) : null;
  if (!d || !isValid(d)) return '';
  // EEEEEE is the short weekday ("seg"); EEE would give "segunda" in the ptBR locale.
  return format(d, allDay ? "EEEEEE'.,' d 'de' MMM'.'" : "EEEEEE'.,' d 'de' MMM'.,' HH:mm", {
    locale: ptBR,
  });
}

/** Reminder lead prefix. `minutos` = minutes before start (negative = after). */
function reminderPrefix(m: Record<string, unknown>): string {
  const min = typeof m.minutos === 'number' ? m.minutos : null;
  if (min === null) return 'Lembrete';
  const days = Math.ceil(min / 1440);
  if (m.dia_inteiro === true) {
    if (min <= 0) return 'Hoje';
    return days === 1 ? 'Amanhã' : `Em ${days} dias`;
  }
  if (min <= 0) return 'Agora';
  if (min >= 1440) return days === 1 ? 'Amanhã' : `Em ${days} dias`;
  if (min >= 60 && min % 60 === 0) {
    const h = min / 60;
    return `Em ${h} ${h === 1 ? 'hora' : 'horas'}`;
  }
  return `Em ${min} ${min === 1 ? 'minuto' : 'minutos'}`;
}

/** "{titulo} · {data}" (date omitted when unknown). */
function eventBody(m: Record<string, unknown>): string {
  const when = formatEventWhen(m);
  const title = s(m.titulo, 'Evento');
  return when ? `${title} · ${when}` : title;
}

const RSVP_LABELS: Record<string, string> = { sim: 'Sim', nao: 'Não', talvez: 'Talvez' };

export function getNotificationDisplay(
  type: NotificationType,
  metadata: Record<string, unknown> | null | undefined,
): NotificationDisplay {
  const m = metadata ?? {};
  const client = s(m.client_name, 'Cliente');
  const post = s(m.post_title, 'Post');
  const idea = s(m.idea_title, 'Ideia');
  const wf = s(m.workflow_title, 'Workflow');
  const step = s(m.step_name, 'Etapa');
  const question = s(m.question_text, 'Briefing');
  const userName = s(m.user_name, 'Usuário');
  const oldRole = s(m.old_role, '—');
  const newRole = s(m.new_role, '—');

  switch (type) {
    case 'post_approved':
      return {
        icon: CheckCircle,
        tone: 'success',
        title: 'Post aprovado',
        body: `${client} — ${post}`,
      };
    case 'post_correction':
      return {
        icon: AlertTriangle,
        tone: 'warning',
        title: 'Correção solicitada',
        body: `${client} — ${post}`,
      };
    case 'post_message':
      return {
        icon: MessageSquare,
        tone: 'teal',
        title: 'Nova mensagem do cliente',
        body: `${client} — ${post}`,
      };
    case 'client_message':
      return {
        icon: MessageSquare,
        tone: 'teal',
        title: 'Nova mensagem do cliente',
        body: `${client}: ${s(m.comentario, '')}`,
      };
    case 'post_edit_suggestion':
      return {
        icon: FilePen,
        tone: 'warning',
        title:
          m.updated === true ? 'Sugestão de edição atualizada' : 'Sugestão de edição do cliente',
        body: `${client} — ${post}`,
      };
    case 'post_client_reference':
      // One sentence says it all; the RPC coalesces a burst of uploads into one row, so no
      // count. Empty body on purpose: the neighbours' "{client} — {post}" body would repeat
      // the title (and new copy carries no em dash).
      return {
        icon: Paperclip,
        tone: 'teal',
        title: `${client} enviou referências em ${post}`,
        body: '',
      };
    case 'idea_submitted':
      return {
        icon: Lightbulb,
        tone: 'primary',
        title: m.tipo === 'solicitacao' ? 'Nova solicitação do cliente' : 'Nova ideia do cliente',
        body: `${client} — ${idea}`,
      };
    case 'briefing_answered':
      return {
        icon: ClipboardCheck,
        tone: 'success',
        title: 'Briefing respondido',
        body: `${client} — ${question}`,
      };
    case 'step_activated':
      return {
        icon: Play,
        tone: 'teal',
        title: 'Nova etapa ativada para você',
        body: `${client} — Etapa "${step}"`,
      };
    case 'step_completed':
      return {
        icon: CheckSquare,
        tone: 'success',
        title: 'Etapa concluída',
        body: `${client} — ${wf}`,
      };
    case 'post_assigned':
      return {
        icon: UserPlus,
        tone: 'teal',
        title: 'Post atribuído a você',
        body: `${client} — ${post}`,
      };
    case 'post_status_automation': {
      // status_label carries the custom status nome, or the raw canonical
      // key when the rule targeted a built-in status — map the latter to
      // its PT label before display.
      const rawLabel = s(m.status_label, '');
      const statusLabel =
        (STATUS_LABELS as Record<string, string>)[rawLabel] ?? (rawLabel || 'novo status');
      return {
        icon: Bell,
        tone: 'teal',
        title: `Post entrou em ${statusLabel}`,
        body: m.client_name ? `${client} · ${post}` : post,
      };
    }
    case 'instagram_connected_by_client': {
      const igUser = s(m.ig_username, '');
      return {
        icon: Instagram,
        tone: 'success',
        title: 'Instagram conectado pelo cliente',
        body: igUser ? `${client} · @${igUser}` : client,
      };
    }
    case 'task_assigned':
      return {
        icon: CheckSquare,
        tone: 'teal',
        title: 'Tarefa atribuída a você',
        // Tasks may have no client; skip the prefix instead of a wrong fallback.
        body: m.client_name
          ? `${client} · ${s(m.task_title, 'Tarefa')}`
          : s(m.task_title, 'Tarefa'),
      };
    case 'workflow_completed':
      return {
        icon: Trophy,
        tone: 'primary',
        title: 'Workflow concluído',
        body: `${client} — ${wf}`,
      };
    case 'deadline_approaching':
      return {
        icon: Clock,
        tone: 'danger',
        title: 'Prazo amanhã',
        body: `${client} — Etapa "${step}"`,
      };
    case 'invite_accepted':
      return {
        icon: UserCheck,
        tone: 'success',
        title: 'Convite aceito',
        body: `${userName} entrou no workspace`,
      };
    case 'member_role_changed':
      return {
        icon: Shield,
        tone: 'warning',
        title: 'Cargo alterado',
        body: `${userName}: ${oldRole} → ${newRole}`,
      };
    case 'member_removed':
      return { icon: UserMinus, tone: 'danger', title: 'Membro removido', body: userName };
    case 'mention':
      return {
        icon: AtSign,
        tone: 'primary',
        title: `${s(m.actor_name, 'Alguém')} mencionou você`,
        body: s(m.excerpt, s(m.context_title, '')),
      };
    case 'post_publish_failed':
      return {
        icon: AlertCircle,
        tone: 'danger',
        title: 'Falha na publicação',
        body: m.client_name ? `${client} · ${post}` : post,
      };
    case 'instagram_automation_failed': {
      const nome = typeof m.automation_name === 'string' ? m.automation_name : null;
      if (m.reason === 'target_never_published') {
        return {
          icon: Instagram,
          tone: 'danger',
          title: 'Automação do Instagram com problema',
          body: `${nome ? `${nome}. ` : ''}O post alvo foi marcado como postado sem passar pelo app, então não existe mídia para monitorar. Escolha o post publicado.`,
        };
      }
      return {
        icon: Instagram,
        tone: 'danger',
        title: 'Automação do Instagram com problema',
        body: 'Uma automação de comentários parou de enviar. Reconecte o Instagram do cliente para reativar.',
      };
    }
    case 'storage_autoclean_report': {
      const filesCount = typeof m.files_count === 'number' ? m.files_count : 0;
      const bytesFreed = typeof m.bytes_freed === 'number' ? m.bytes_freed : 0;
      return {
        icon: HardDrive,
        tone: 'primary',
        title: 'Limpeza de armazenamento',
        body: `${filesCount} ${filesCount === 1 ? 'arquivo removido' : 'arquivos removidos'} · ${formatStorageBytes(bytesFreed)} liberados`,
      };
    }
    case 'event_invited': {
      const actor = typeof m.ator_nome === 'string' && m.ator_nome ? m.ator_nome : null;
      return {
        icon: CalendarPlus,
        tone: 'teal',
        title: actor ? `${actor} convidou você` : 'Novo convite',
        body: eventBody(m),
      };
    }
    case 'event_updated':
      return {
        icon: CalendarClock,
        tone: 'warning',
        title: `Evento alterado: ${s(m.titulo, 'Evento')}`,
        body: formatEventWhen(m),
      };
    case 'event_cancelled':
      return {
        icon: CalendarX,
        tone: 'danger',
        title:
          m.motivo === 'removido'
            ? `Você foi removido de ${s(m.titulo, 'Evento')}`
            : `Evento cancelado: ${s(m.titulo, 'Evento')}`,
        body: formatEventWhen(m),
      };
    case 'event_rsvp': {
      const resposta = RSVP_LABELS[s(m.resposta, '')];
      const actor = s(m.ator_nome, 'Alguém');
      return {
        icon: CalendarCheck,
        tone: m.resposta === 'nao' ? 'warning' : 'success',
        title: resposta ? `${actor} respondeu: ${resposta}` : `${actor} respondeu ao convite`,
        body: eventBody(m),
      };
    }
    case 'event_client_rsvp': {
      const cliente = s(m.cliente_nome, 'O cliente');
      const titulo = s(m.titulo, 'Evento');
      const verbo = m.resposta === 'sim' ? 'confirmou' : m.resposta === 'nao' ? 'recusou' : null;
      return {
        icon: CalendarCheck,
        tone: m.resposta === 'nao' ? 'warning' : 'success',
        title: verbo ? `${cliente} ${verbo} ${titulo}` : `${cliente} respondeu a ${titulo}`,
        body: formatEventWhen(m),
      };
    }
    case 'event_guest_rsvp': {
      const quem =
        typeof m.convidado_nome === 'string' && m.convidado_nome.trim()
          ? m.convidado_nome
          : typeof m.convidado_email === 'string' && m.convidado_email
            ? m.convidado_email
            : 'Um convidado';
      const titulo = s(m.titulo, 'Evento');
      const verbo = m.resposta === 'sim' ? 'confirmou' : m.resposta === 'nao' ? 'recusou' : null;
      return {
        icon: CalendarCheck,
        tone: m.resposta === 'nao' ? 'warning' : 'success',
        title: verbo ? `${quem} ${verbo} ${titulo}` : `${quem} respondeu a ${titulo}`,
        body: formatEventWhen(m),
      };
    }
    case 'event_reschedule_requested': {
      // All-day suggestions are local midnight: show the date only.
      const sugestao = formatEventWhen({
        inicio: m.inicio_sugerido,
        dia_inteiro: m.dia_inteiro,
        data_local: m.inicio_sugerido,
      });
      return {
        icon: CalendarClock,
        tone: 'warning',
        title: `${s(m.cliente_nome, 'O cliente')} pediu para remarcar ${s(m.titulo, 'Evento')}`,
        body: sugestao ? `Sugestão: ${sugestao}` : formatEventWhen(m),
      };
    }
    case 'event_reminder':
      return {
        icon: AlarmClock,
        tone: 'primary',
        title: `${reminderPrefix(m)}: ${s(m.titulo, 'Evento')}`,
        body: formatEventWhen(m),
      };
    default:
      // Resilience: a notification type the DB allows but the UI doesn't know yet
      // (e.g. added by a migration ahead of the frontend) must never crash the list.
      return { icon: NOTIFICATION_FALLBACK_ICON, tone: 'primary', title: 'Notificação', body: '' };
  }
}
