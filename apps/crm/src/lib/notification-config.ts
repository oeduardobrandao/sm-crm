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
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  PackageCheck,
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
import i18n from 'i18next';
import { getDateFnsLocale } from '@mesaas/i18n';
import type { NotificationType } from '../store';
import { STATUS_LABELS } from '../pages/entregas/postLabels';
import { formatStorageBytes } from '../components/usage/usage-meter-state';
import { stripMentionTokens } from '../components/mentions/mentionTokens';

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

/** Texts live in the `notifications` namespace and are resolved at call time, so a language
 * switch shows up the next time the list renders. */
const tr = (key: string, opts?: Record<string, unknown>): string =>
  i18n.t(`notifications:${key}`, opts) as string;

const s = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.length > 0 ? v : fallback;

const QUOTE_MAX = 60;

/** Collapses whitespace and cuts a long quoted passage so the card title stays short. */
function shortQuote(raw: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim();
  return flat.length > QUOTE_MAX ? `${flat.slice(0, QUOTE_MAX).trimEnd()}…` : flat;
}

/** post_discussion card. One card per (user, post) while unread. The metadata shape and the
 * grouping rules live in the spec, section "Notificações"
 * (docs/superpowers/specs/2026-10-22-discussao-do-post-design.md). */
function postDiscussionDisplay(m: Record<string, unknown>): NotificationDisplay {
  const author = s(m.author_name, tr('fallback.someone'));
  // Distinct names other than the latest author, so the count is right whether or not the
  // trigger keeps the latest author inside `authors`.
  const others = Array.isArray(m.authors)
    ? new Set(
        m.authors.filter((a): a is string => typeof a === 'string' && a.length > 0 && a !== author),
      ).size
    : 0;
  const count = typeof m.count === 'number' && Number.isFinite(m.count) ? m.count : 1;
  const quoted = typeof m.quoted_text === 'string' ? shortQuote(m.quoted_text) : '';
  const anchored = s(m.thread_field, 'geral') !== 'geral' && quoted.length > 0;

  const who = others > 0 ? tr('discussion.andOthers', { author, count: others }) : author;
  const title = anchored
    ? tr(others > 0 ? 'discussion.anchoredMany' : 'discussion.anchoredOne', { who, quote: quoted })
    : tr(others > 0 ? 'discussion.generalMany' : 'discussion.generalOne', {
        who,
        post: s(m.post_titulo, tr('fallback.aPost')),
      });

  // An anchored title names the passage, not the post, so the body carries the post title.
  const postTitle = anchored ? s(m.post_titulo, '') : '';
  const rawPreview = stripMentionTokens(s(m.preview, ''));
  const preview = postTitle ? (rawPreview ? `${postTitle}: ${rawPreview}` : postTitle) : rawPreview;
  const countLabel = count > 1 ? tr('discussion.messages', { count }) : '';
  return {
    icon: MessagesSquare,
    tone: 'teal',
    title,
    body: [preview, countLabel].filter(Boolean).join(' · '),
  };
}

/** task_comment card. One card per (user, task) while unread: the RPC upserts it, bumping
 * `count` (docs/superpowers/specs/2026-10-28-tarefas-kpis-comentarios-historico-design.md). */
function taskCommentDisplay(m: Record<string, unknown>): NotificationDisplay {
  const count = typeof m.count === 'number' && Number.isFinite(m.count) ? m.count : 1;
  const task = s(m.task_title, tr('fallback.aTask'));
  // The title names the task, so the body names who wrote (the RPC keeps the latest author).
  const author = s(m.author_name, '');
  const preview = stripMentionTokens(s(m.preview, ''));
  return {
    icon: MessageCircle,
    tone: 'teal',
    title:
      count > 1
        ? tr('titles.taskCommentMany', { count, task })
        : tr('titles.taskCommentOne', { task }),
    body: author && preview ? `${author}: ${preview}` : author || preview,
  };
}

/** pt "seg., 5 de out., 14:00" / en "Mon, Oct 5, 2:00 PM" (all-day: no time). Shown in the
 * viewer's timezone. The pattern per language lives in `notifications:eventWhen`. */
function formatEventWhen(m: Record<string, unknown>): string {
  const allDay = m.dia_inteiro === true;
  const raw = allDay ? m.data_local : m.inicio;
  const d = typeof raw === 'string' ? parseISO(raw) : null;
  if (!d || !isValid(d)) return '';
  return format(d, tr(allDay ? 'eventWhen.allDay' : 'eventWhen.timed'), {
    locale: getDateFnsLocale(),
  });
}

/** Reminder lead prefix. `minutos` = minutes before start (negative = after). */
function reminderPrefix(m: Record<string, unknown>): string {
  const min = typeof m.minutos === 'number' ? m.minutos : null;
  if (min === null) return tr('reminder.plain');
  const days = Math.ceil(min / 1440);
  if (m.dia_inteiro === true) {
    if (min <= 0) return tr('reminder.today');
    return days === 1 ? tr('reminder.tomorrow') : tr('reminder.inDays', { count: days });
  }
  if (min <= 0) return tr('reminder.now');
  if (min >= 1440)
    return days === 1 ? tr('reminder.tomorrow') : tr('reminder.inDays', { count: days });
  if (min >= 60 && min % 60 === 0) return tr('reminder.inHours', { count: min / 60 });
  return tr('reminder.inMinutes', { count: min });
}

/** "{titulo} · {data}" (date omitted when unknown). */
function eventBody(m: Record<string, unknown>): string {
  const when = formatEventWhen(m);
  const title = s(m.titulo, tr('fallback.event'));
  return when ? `${title} · ${when}` : title;
}

/** Lowercase month name of a 'YYYY-MM-DD' (or 'YYYY-MM') string in the UI language, read from
 * the text so a local timezone can never shift it. Empty when the value is not a valid month. */
function monthName(periodo: unknown): string {
  const mm = typeof periodo === 'string' ? /^\d{4}-(\d{2})/.exec(periodo) : null;
  const n = mm ? Number(mm[1]) : 0;
  if (n < 1 || n > 12) return '';
  return format(new Date(2000, n - 1, 1), 'LLLL', { locale: getDateFnsLocale() });
}

/**
 * linha_editorial_aprovada / linha_editorial_ajustes. Body = comment count (omitted for 0); for
 * ajustes, the rows with an ajuste (`itens_ajustes`, spec §13.3) when there are any.
 */
function linhaEditorialDisplay(
  type: 'linha_editorial_aprovada' | 'linha_editorial_ajustes',
  m: Record<string, unknown>,
): NotificationDisplay {
  const who = s(m.cliente_nome, tr('fallback.client'));
  const mes = monthName(m.periodo);
  // Reference form (spec §14.2): the custom title in curly quotes, else the month.
  const titulo = typeof m.titulo === 'string' ? m.titulo.trim() : '';
  const ref = titulo
    ? tr('linha.refTitled', { titulo })
    : mes
      ? tr('linha.refMonth', { month: mes })
      : tr('linha.ref');
  const n = typeof m.comentarios === 'number' && Number.isFinite(m.comentarios) ? m.comentarios : 0;
  const comentarios = n > 0 ? tr('linha.comments', { count: n }) : '';
  const ajustes =
    typeof m.itens_ajustes === 'number' && Number.isFinite(m.itens_ajustes) ? m.itens_ajustes : 0;
  const body =
    type === 'linha_editorial_ajustes' && ajustes > 0
      ? tr('linha.postsWithAdjust', { count: ajustes })
      : comentarios;
  return type === 'linha_editorial_aprovada'
    ? {
        icon: CheckCircle,
        tone: 'success',
        title: tr('linha.approved', { who, ref }),
        body,
      }
    : {
        icon: AlertTriangle,
        tone: 'warning',
        title: tr('linha.adjustments', { who, ref }),
        body,
      };
}

const RSVP_KEYS = ['sim', 'nao', 'talvez'];

/** "{who} confirmou/recusou/respondeu a {title}" for the client and guest RSVP cards. */
function rsvpTitle(resposta: unknown, who: string, title: string): string {
  if (resposta === 'sim') return tr('titles.rsvpConfirmed', { who, title });
  if (resposta === 'nao') return tr('titles.rsvpDeclined', { who, title });
  return tr('titles.rsvpResponded', { who, title });
}

export function getNotificationDisplay(
  type: NotificationType,
  metadata: Record<string, unknown> | null | undefined,
): NotificationDisplay {
  const m = metadata ?? {};
  const client = s(m.client_name, tr('fallback.client'));
  const post = s(m.post_title, tr('fallback.post'));
  const idea = s(m.idea_title, tr('fallback.idea'));
  const wf = s(m.workflow_title, tr('fallback.workflow'));
  const step = s(m.step_name, tr('fallback.step'));
  const question = s(m.question_text, tr('fallback.briefing'));
  const userName = s(m.user_name, tr('fallback.user'));
  const oldRole = s(m.old_role, tr('fallback.role'));
  const newRole = s(m.new_role, tr('fallback.role'));
  const clientPost = tr('bodies.clientPost', { client, post });
  const clientWf = tr('bodies.clientWorkflow', { client, workflow: wf });
  const clientStep = tr('bodies.clientStep', { client, step });

  switch (type) {
    case 'post_approved':
      return {
        icon: CheckCircle,
        tone: 'success',
        title: tr('titles.postApproved'),
        body: clientPost,
      };
    case 'post_correction':
      return {
        icon: AlertTriangle,
        tone: 'warning',
        title: tr('titles.postCorrection'),
        body: clientPost,
      };
    case 'post_message':
      return {
        icon: MessageSquare,
        tone: 'teal',
        title: tr('titles.clientMessage'),
        body: clientPost,
      };
    case 'client_message':
      return {
        icon: MessageSquare,
        tone: 'teal',
        title: tr('titles.clientMessage'),
        body: `${client}: ${s(m.comentario, '')}`,
      };
    case 'post_edit_suggestion':
      return {
        icon: FilePen,
        tone: 'warning',
        title: tr(m.updated === true ? 'titles.editSuggestionUpdated' : 'titles.editSuggestion'),
        body: clientPost,
      };
    case 'post_client_reference':
      // One sentence says it all; the RPC coalesces a burst of uploads into one row, so no
      // count. Empty body on purpose: the neighbours' "{client} — {post}" body would repeat
      // the title (and new copy carries no em dash).
      return {
        icon: Paperclip,
        tone: 'teal',
        title: tr('titles.clientReference', { client, post }),
        body: '',
      };
    case 'post_material_complete': {
      // Empty body on purpose, like post_client_reference: the sentence says it all.
      const done = typeof m.done === 'number' ? m.done : 0;
      const total = typeof m.total === 'number' ? m.total : 0;
      return {
        icon: PackageCheck,
        tone: 'success',
        title:
          m.closed_by === 'client'
            ? tr('titles.materialCompleteClosed', { client, done, total, post })
            : tr('titles.materialComplete', { client, post }),
        body: '',
      };
    }
    case 'idea_submitted':
      return {
        icon: Lightbulb,
        tone: 'primary',
        title: tr(m.tipo === 'solicitacao' ? 'titles.ideaRequest' : 'titles.idea'),
        body: tr('bodies.clientIdea', { client, idea }),
      };
    case 'briefing_answered':
      return {
        icon: ClipboardCheck,
        tone: 'success',
        title: tr('titles.briefingAnswered'),
        body: tr('bodies.clientQuestion', { client, question }),
      };
    case 'step_activated':
      return {
        icon: Play,
        tone: 'teal',
        title: tr('titles.stepActivated'),
        body: clientStep,
      };
    case 'step_completed':
      return {
        icon: CheckSquare,
        tone: 'success',
        title: tr('titles.stepCompleted'),
        body: clientWf,
      };
    case 'post_assigned':
      return {
        icon: UserPlus,
        tone: 'teal',
        title: tr('titles.postAssigned'),
        body: clientPost,
      };
    case 'post_status_automation': {
      // status_label carries the custom status nome, or the raw canonical
      // key when the rule targeted a built-in status: map the latter to
      // its localized label before display.
      const rawLabel = s(m.status_label, '');
      const statusLabel =
        (STATUS_LABELS as Record<string, string>)[rawLabel] ??
        (rawLabel || tr('fallback.newStatus'));
      return {
        icon: Bell,
        tone: 'teal',
        title: tr('titles.postStatusAutomation', { status: statusLabel }),
        body: m.client_name ? tr('bodies.clientDot', { client, post }) : post,
      };
    }
    case 'instagram_connected_by_client': {
      const igUser = s(m.ig_username, '');
      return {
        icon: Instagram,
        tone: 'success',
        title: tr('titles.instagramConnected'),
        body: igUser ? `${client} · @${igUser}` : client,
      };
    }
    case 'task_assigned': {
      const task = s(m.task_title, tr('fallback.task'));
      return {
        icon: CheckSquare,
        tone: 'teal',
        title: tr('titles.taskAssigned'),
        // Tasks may have no client; skip the prefix instead of a wrong fallback.
        body: m.client_name ? tr('bodies.clientDotTask', { client, task }) : task,
      };
    }
    case 'task_comment':
      return taskCommentDisplay(m);
    case 'workflow_completed':
      return {
        icon: Trophy,
        tone: 'primary',
        title: tr('titles.workflowCompleted'),
        body: clientWf,
      };
    case 'deadline_approaching':
      return {
        icon: Clock,
        tone: 'danger',
        title: tr('titles.deadline'),
        body: clientStep,
      };
    case 'invite_accepted':
      return {
        icon: UserCheck,
        tone: 'success',
        title: tr('titles.inviteAccepted'),
        body: tr('bodies.inviteAccepted', { user: userName }),
      };
    case 'member_role_changed':
      return {
        icon: Shield,
        tone: 'warning',
        title: tr('titles.roleChanged'),
        body: tr('bodies.roleChange', { user: userName, from: oldRole, to: newRole }),
      };
    case 'member_removed':
      return {
        icon: UserMinus,
        tone: 'danger',
        title: tr('titles.memberRemoved'),
        body: userName,
      };
    case 'mention':
      return {
        icon: AtSign,
        tone: 'primary',
        title: tr('titles.mention', { actor: s(m.actor_name, tr('fallback.someone')) }),
        body: s(m.excerpt, s(m.context_title, '')),
      };
    case 'team_message': {
      // title = nome do grupo quando existe; para DM (sem nome) ou qualquer
      // metadata incompleta, cai no nome do autor. body repete o autor só
      // quando o title NAO ja o mostra (grupo) -- numa DM o title JA e o
      // autor, entao repeti-lo no body seria redundante.
      const conversaNome = s(m.conversa_nome, '');
      const authorName = s(m.author_name, tr('fallback.team'));
      const preview = stripMentionTokens(s(m.preview, ''));
      return {
        icon: MessageCircle,
        tone: 'teal',
        title: conversaNome || authorName,
        body: conversaNome ? `${authorName}: ${preview}` : preview,
      };
    }
    case 'post_discussion':
      return postDiscussionDisplay(m);
    case 'post_publish_failed':
      return {
        icon: AlertCircle,
        tone: 'danger',
        title: tr('titles.publishFailed'),
        body: m.client_name ? tr('bodies.clientDot', { client, post }) : post,
      };
    case 'instagram_automation_failed': {
      const nome = typeof m.automation_name === 'string' ? m.automation_name : null;
      if (m.reason === 'target_never_published') {
        return {
          icon: Instagram,
          tone: 'danger',
          title: tr('titles.instagramAutomation'),
          body: `${nome ? `${nome}. ` : ''}${tr('instagramAutomation.targetNeverPublished')}`,
        };
      }
      return {
        icon: Instagram,
        tone: 'danger',
        title: tr('titles.instagramAutomation'),
        body: tr('instagramAutomation.stopped'),
      };
    }
    case 'storage_autoclean_report': {
      const filesCount = typeof m.files_count === 'number' ? m.files_count : 0;
      const bytesFreed = typeof m.bytes_freed === 'number' ? m.bytes_freed : 0;
      return {
        icon: HardDrive,
        tone: 'primary',
        title: tr('titles.storageCleanup'),
        body: tr('storage.body', { count: filesCount, size: formatStorageBytes(bytesFreed) }),
      };
    }
    case 'event_invited': {
      const actor = typeof m.ator_nome === 'string' && m.ator_nome ? m.ator_nome : null;
      return {
        icon: CalendarPlus,
        tone: 'teal',
        title: actor ? tr('titles.eventInvitedBy', { actor }) : tr('titles.eventInvited'),
        body: eventBody(m),
      };
    }
    case 'event_updated':
      return {
        icon: CalendarClock,
        tone: 'warning',
        title: tr('titles.eventUpdated', { title: s(m.titulo, tr('fallback.event')) }),
        body: formatEventWhen(m),
      };
    case 'event_cancelled': {
      const title = s(m.titulo, tr('fallback.event'));
      return {
        icon: CalendarX,
        tone: 'danger',
        title:
          m.motivo === 'removido'
            ? tr('titles.eventRemoved', { title })
            : tr('titles.eventCancelled', { title }),
        body: formatEventWhen(m),
      };
    }
    case 'event_rsvp': {
      const key = s(m.resposta, '');
      const resposta = RSVP_KEYS.includes(key) ? tr(`rsvp.${key}`) : '';
      const actor = s(m.ator_nome, tr('fallback.someone'));
      return {
        icon: CalendarCheck,
        tone: m.resposta === 'nao' ? 'warning' : 'success',
        title: resposta
          ? tr('titles.rsvpAnswered', { actor, answer: resposta })
          : tr('titles.rsvpAnsweredInvite', { actor }),
        body: eventBody(m),
      };
    }
    case 'event_client_rsvp': {
      const who = s(m.cliente_nome, tr('fallback.theClient'));
      const title = s(m.titulo, tr('fallback.event'));
      return {
        icon: CalendarCheck,
        tone: m.resposta === 'nao' ? 'warning' : 'success',
        title: rsvpTitle(m.resposta, who, title),
        body: formatEventWhen(m),
      };
    }
    case 'event_guest_rsvp': {
      const who =
        typeof m.convidado_nome === 'string' && m.convidado_nome.trim()
          ? m.convidado_nome
          : typeof m.convidado_email === 'string' && m.convidado_email
            ? m.convidado_email
            : tr('fallback.guest');
      const title = s(m.titulo, tr('fallback.event'));
      return {
        icon: CalendarCheck,
        tone: m.resposta === 'nao' ? 'warning' : 'success',
        title: rsvpTitle(m.resposta, who, title),
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
        title: tr('titles.reschedule', {
          who: s(m.cliente_nome, tr('fallback.theClient')),
          title: s(m.titulo, tr('fallback.event')),
        }),
        body: sugestao ? tr('bodies.suggestion', { when: sugestao }) : formatEventWhen(m),
      };
    }
    case 'event_reminder':
      return {
        icon: AlarmClock,
        tone: 'primary',
        title: tr('titles.reminder', {
          prefix: reminderPrefix(m),
          title: s(m.titulo, tr('fallback.event')),
        }),
        body: formatEventWhen(m),
      };
    case 'linha_editorial_aprovada':
    case 'linha_editorial_ajustes':
      return linhaEditorialDisplay(type, m);
    default:
      // Resilience: a notification type the DB allows but the UI doesn't know yet
      // (e.g. added by a migration ahead of the frontend) must never crash the list.
      return {
        icon: NOTIFICATION_FALLBACK_ICON,
        tone: 'primary',
        title: tr('titles.unknown'),
        body: '',
      };
  }
}
