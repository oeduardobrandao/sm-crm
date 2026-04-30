import {
  AlertTriangle, Bell, CheckCircle, CheckSquare, ClipboardCheck, Clock,
  Lightbulb, MessageSquare, Play, Shield, Trophy, UserCheck, UserMinus, UserPlus,
  type LucideIcon,
} from 'lucide-react';
import type { NotificationType } from '../store';

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
  danger:  '#f55a42',
  teal:    '#42c8f5',
  primary: '#eab308',
};

export const NOTIFICATION_FALLBACK_ICON: LucideIcon = Bell;

const s = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.length > 0 ? v : fallback;

export function getNotificationDisplay(
  type: NotificationType,
  metadata: Record<string, unknown> | null | undefined,
): NotificationDisplay {
  const m = metadata ?? {};
  const client    = s(m.client_name, 'Cliente');
  const post      = s(m.post_title, 'Post');
  const idea      = s(m.idea_title, 'Ideia');
  const wf        = s(m.workflow_title, 'Workflow');
  const step      = s(m.step_name, 'Etapa');
  const question  = s(m.question_text, 'Briefing');
  const userName  = s(m.user_name, 'Usuário');
  const oldRole   = s(m.old_role, '—');
  const newRole   = s(m.new_role, '—');

  switch (type) {
    case 'post_approved':
      return { icon: CheckCircle, tone: 'success', title: 'Post aprovado', body: `${client} — ${post}` };
    case 'post_correction':
      return { icon: AlertTriangle, tone: 'warning', title: 'Correção solicitada', body: `${client} — ${post}` };
    case 'post_message':
      return { icon: MessageSquare, tone: 'teal', title: 'Nova mensagem do cliente', body: `${client} — ${post}` };
    case 'idea_submitted':
      return { icon: Lightbulb, tone: 'primary', title: 'Nova ideia do cliente', body: `${client} — ${idea}` };
    case 'briefing_answered':
      return { icon: ClipboardCheck, tone: 'success', title: 'Briefing respondido', body: `${client} — ${question}` };
    case 'step_activated':
      return { icon: Play, tone: 'teal', title: 'Nova etapa ativada para você', body: `${client} — Etapa "${step}"` };
    case 'step_completed':
      return { icon: CheckSquare, tone: 'success', title: 'Etapa concluída', body: `${client} — ${wf}` };
    case 'post_assigned':
      return { icon: UserPlus, tone: 'teal', title: 'Post atribuído a você', body: `${client} — ${post}` };
    case 'workflow_completed':
      return { icon: Trophy, tone: 'primary', title: 'Workflow concluído', body: `${client} — ${wf}` };
    case 'deadline_approaching':
      return { icon: Clock, tone: 'danger', title: 'Prazo amanhã', body: `${client} — Etapa "${step}"` };
    case 'invite_accepted':
      return { icon: UserCheck, tone: 'success', title: 'Convite aceito', body: `${userName} entrou no workspace` };
    case 'member_role_changed':
      return { icon: Shield, tone: 'warning', title: 'Cargo alterado', body: `${userName}: ${oldRole} → ${newRole}` };
    case 'member_removed':
      return { icon: UserMinus, tone: 'danger', title: 'Membro removido', body: userName };
  }
}
