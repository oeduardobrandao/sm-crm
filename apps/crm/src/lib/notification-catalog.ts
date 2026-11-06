import { i18n } from '@mesaas/i18n';
import type { NotificationType } from '@/store/notifications';

export type NotificationCategory =
  | 'aprovacoes_hub'
  | 'entregas_fluxo'
  | 'equipe'
  | 'agenda'
  | 'integracoes'
  | 'sistema';

export const CATEGORY_ORDER: NotificationCategory[] = [
  'aprovacoes_hub',
  'entregas_fluxo',
  'equipe',
  'agenda',
  'integracoes',
  'sistema',
];

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  aprovacoes_hub: 'Aprovações e Hub',
  entregas_fluxo: 'Entregas e fluxo',
  equipe: 'Equipe',
  agenda: 'Agenda',
  integracoes: 'Integrações',
  sistema: 'Sistema',
};

export interface NotificationCatalogEntry {
  category: NotificationCategory;
  label: string;
  when: string;
  recipients: string;
  emailEligible: boolean;
  /** Sent to the iOS app by notification-push-cron. Must equal the type array of
   * claim_notification_pushes (latest migration) and fit notification_push_prefs'
   * CHECK; notification-catalog.push-parity.test.ts reads both from disk. */
  pushEligible: boolean;
}

const RESP_ADMINS = 'responsável pelo item + donos e admins';
const ADMINS = 'donos e admins';
const PARTICIPANTES = 'Participantes do evento';
const ORGANIZADOR_OU_ADMINS = 'Organizador do evento (ou donos e admins)';

export const NOTIFICATION_CATALOG = {
  post_approved: {
    category: 'aprovacoes_hub',
    label: 'Post aprovado pelo cliente',
    when: 'o cliente aprova um post no Hub',
    recipients: RESP_ADMINS,
    emailEligible: true,
    pushEligible: true,
  },
  post_correction: {
    category: 'aprovacoes_hub',
    label: 'Correção solicitada',
    when: 'o cliente pede correção em um post',
    recipients: RESP_ADMINS,
    emailEligible: true,
    pushEligible: true,
  },
  post_message: {
    category: 'aprovacoes_hub',
    label: 'Mensagem em um post',
    when: 'o cliente comenta em um post específico',
    recipients: RESP_ADMINS,
    emailEligible: true,
    pushEligible: true,
  },
  post_edit_suggestion: {
    category: 'aprovacoes_hub',
    label: 'Sugestão de edição',
    when: 'o cliente sugere ou atualiza uma alteração de texto ou legenda no Hub',
    recipients: RESP_ADMINS,
    emailEligible: false,
    pushEligible: true,
  },
  post_client_reference: {
    category: 'aprovacoes_hub',
    label: 'Referências do cliente',
    when: 'o cliente anexa fotos, vídeos, PDFs ou links a um post no Hub',
    recipients: RESP_ADMINS,
    emailEligible: false,
    pushEligible: true,
  },
  post_material_complete: {
    category: 'aprovacoes_hub',
    label: 'Material do cliente',
    when: 'o cliente termina de enviar o material pedido de um post no Hub',
    recipients: RESP_ADMINS,
    emailEligible: false,
  },
  idea_submitted: {
    category: 'aprovacoes_hub',
    label: 'Ideia enviada',
    when: 'o cliente envia uma ideia ou solicitação',
    recipients: ADMINS,
    emailEligible: false,
    pushEligible: true,
  },
  briefing_answered: {
    category: 'aprovacoes_hub',
    label: 'Briefing respondido',
    when: 'o cliente responde uma pergunta do briefing',
    recipients: ADMINS,
    emailEligible: false,
    pushEligible: true,
  },
  client_message: {
    category: 'aprovacoes_hub',
    label: 'Mensagem do cliente',
    when: 'o cliente escreve no feed de mensagens',
    recipients: ADMINS,
    emailEligible: true,
    pushEligible: true,
  },
  linha_editorial_aprovada: {
    category: 'aprovacoes_hub',
    label: 'Linha editorial aprovada',
    when: 'o cliente aprova a linha editorial do mês no Hub',
    recipients: RESP_ADMINS,
    emailEligible: true,
    pushEligible: true,
  },
  linha_editorial_ajustes: {
    category: 'aprovacoes_hub',
    label: 'Ajustes na linha editorial',
    when: 'o cliente pede ajustes na linha editorial do mês no Hub',
    recipients: RESP_ADMINS,
    emailEligible: true,
    pushEligible: true,
  },
  step_activated: {
    category: 'entregas_fluxo',
    label: 'Etapa ativada',
    when: 'uma etapa do fluxo fica ativa',
    recipients: RESP_ADMINS,
    emailEligible: false,
    pushEligible: false,
  },
  step_completed: {
    category: 'entregas_fluxo',
    label: 'Etapa concluída',
    when: 'uma etapa do fluxo é concluída',
    recipients: ADMINS,
    emailEligible: false,
    pushEligible: false,
  },
  post_assigned: {
    category: 'entregas_fluxo',
    label: 'Post atribuído a você',
    when: 'um post é atribuído a você',
    recipients: 'somente quem foi atribuído',
    emailEligible: true,
    pushEligible: true,
  },
  task_assigned: {
    category: 'entregas_fluxo',
    label: 'Tarefa atribuída a você',
    when: 'uma tarefa é criada para você ou reatribuída',
    recipients: 'somente quem foi atribuído',
    emailEligible: true,
    pushEligible: true,
  },
  task_comment: {
    category: 'entregas_fluxo',
    label: 'Comentário em uma tarefa',
    when: 'alguém comenta em uma tarefa da qual você participa',
    recipients:
      'responsável, quem criou e quem já comentou, exceto quem escreveu e quem foi mencionado',
    emailEligible: false,
    pushEligible: false,
  },
  workflow_completed: {
    category: 'entregas_fluxo',
    label: 'Fluxo concluído',
    when: 'um fluxo inteiro é concluído',
    recipients: ADMINS,
    emailEligible: false,
    pushEligible: false,
  },
  deadline_approaching: {
    category: 'entregas_fluxo',
    label: 'Prazo se aproximando',
    when: 'uma etapa ativa vence amanhã',
    recipients: RESP_ADMINS,
    emailEligible: true,
    pushEligible: true,
  },
  post_status_automation: {
    category: 'entregas_fluxo',
    label: 'Automação de status',
    when: 'uma regra sua de status dispara uma notificação',
    recipients: 'conforme a regra configurada',
    emailEligible: false,
    pushEligible: false,
  },
  invite_accepted: {
    category: 'equipe',
    label: 'Convite aceito',
    when: 'alguém entra no workspace',
    recipients: ADMINS,
    emailEligible: false,
    pushEligible: false,
  },
  member_role_changed: {
    category: 'equipe',
    label: 'Papel alterado',
    when: 'o papel de um membro muda',
    recipients: ADMINS,
    emailEligible: false,
    pushEligible: false,
  },
  member_removed: {
    category: 'equipe',
    label: 'Membro removido',
    when: 'um membro é removido do workspace',
    recipients: ADMINS,
    emailEligible: false,
    pushEligible: false,
  },
  mention: {
    category: 'equipe',
    label: 'Menções',
    when: 'alguém menciona você com @',
    recipients: 'somente quem foi mencionado',
    emailEligible: true,
    pushEligible: true,
  },
  event_invited: {
    category: 'agenda',
    label: 'Convites para eventos',
    when: 'alguém adiciona você a um evento',
    recipients: PARTICIPANTES,
    emailEligible: true,
    pushEligible: true,
  },
  event_updated: {
    category: 'agenda',
    label: 'Eventos alterados',
    when: 'muda o horário, o local ou a repetição de um evento seu',
    recipients: PARTICIPANTES,
    emailEligible: true,
    pushEligible: true,
  },
  event_cancelled: {
    category: 'agenda',
    label: 'Eventos cancelados',
    when: 'um evento seu é cancelado ou você é removido dele',
    recipients: PARTICIPANTES,
    emailEligible: true,
    pushEligible: true,
  },
  event_rsvp: {
    category: 'agenda',
    label: 'Respostas aos seus convites',
    when: 'um participante responde a um evento que você organizou',
    recipients: 'Organizador do evento',
    emailEligible: false,
    pushEligible: false,
  },
  event_client_rsvp: {
    category: 'agenda',
    label: 'Cliente respondeu a um evento',
    when: 'o cliente confirma ou recusa um evento compartilhado com ele',
    recipients: ORGANIZADOR_OU_ADMINS,
    emailEligible: true,
    pushEligible: true,
  },
  event_guest_rsvp: {
    category: 'agenda',
    label: 'Convidado externo respondeu a um evento',
    when: 'um convidado externo confirma ou recusa um evento seu',
    recipients: ORGANIZADOR_OU_ADMINS,
    emailEligible: true,
    pushEligible: true,
  },
  event_reschedule_requested: {
    category: 'agenda',
    label: 'Cliente pediu para remarcar',
    when: 'o cliente pede para remarcar um evento compartilhado com ele',
    recipients: ORGANIZADOR_OU_ADMINS,
    emailEligible: true,
    pushEligible: true,
  },
  event_reminder: {
    category: 'agenda',
    label: 'Lembretes de eventos',
    when: 'no horário dos lembretes que você definiu',
    recipients: PARTICIPANTES,
    emailEligible: true,
    pushEligible: true,
  },
  team_message: {
    category: 'equipe',
    label: 'Mensagem no chat da equipe',
    when: 'alguém envia uma mensagem em uma conversa do chat de equipe da qual você participa',
    recipients: 'participantes da conversa, exceto quem enviou',
    emailEligible: false,
    pushEligible: false,
  },
  post_discussion: {
    category: 'equipe',
    label: 'Mensagem na discussão de um post',
    when: 'alguém escreve na discussão de um post que você segue',
    recipients: 'quem escreveu, foi mencionado ou é responsável pelo post e segue a discussão',
    emailEligible: false,
    pushEligible: false,
  },
  instagram_connected_by_client: {
    category: 'integracoes',
    label: 'Instagram conectado',
    when: 'o cliente conclui a conexão pelo link que você enviou',
    recipients: 'quem criou o link',
    emailEligible: false,
    pushEligible: false,
  },
  post_publish_failed: {
    category: 'integracoes',
    label: 'Falha na publicação',
    when: 'um post agendado falha ao publicar',
    recipients: RESP_ADMINS,
    emailEligible: true,
    pushEligible: true,
  },
  instagram_automation_failed: {
    category: 'integracoes',
    label: 'Automação do Instagram com problema',
    when: 'uma automação de comentário para DM para de funcionar',
    recipients: ADMINS,
    emailEligible: false,
    pushEligible: false,
  },
  storage_autoclean_report: {
    category: 'sistema',
    label: 'Limpeza de armazenamento',
    when: 'a limpeza noturna remove arquivos antigos',
    recipients: ADMINS,
    emailEligible: false,
    pushEligible: false,
  },
} as const satisfies Record<NotificationType, NotificationCatalogEntry>;

/** Tipos que podem virar e-mail, derivados das entradas emailEligible do catálogo. */
export type NotificationEmailType = {
  [K in NotificationType]: (typeof NOTIFICATION_CATALOG)[K]['emailEligible'] extends true
    ? K
    : never;
}[NotificationType];

export function isEmailEligibleType(type: NotificationType): type is NotificationEmailType {
  return NOTIFICATION_CATALOG[type].emailEligible;
}

/** Os tipos emailEligible, na ordem do catálogo. */
export const EMAIL_ELIGIBLE_TYPES: NotificationEmailType[] = (
  Object.keys(NOTIFICATION_CATALOG) as NotificationType[]
).filter(isEmailEligibleType);

/** Tipos que podem virar push no app, derivados das entradas pushEligible do catálogo. */
export type NotificationPushType = {
  [K in NotificationType]: (typeof NOTIFICATION_CATALOG)[K]['pushEligible'] extends true
    ? K
    : never;
}[NotificationType];

/** Takes any string (a pref row, a push payload): unknown types are not eligible. */
export function isPushEligibleType(type: string): type is NotificationPushType {
  return (
    Object.prototype.hasOwnProperty.call(NOTIFICATION_CATALOG, type) &&
    NOTIFICATION_CATALOG[type as NotificationType].pushEligible
  );
}

/** i18next key segment for a type: `.` and `:` are key/namespace separators. */
const catalogKey = (type: string) => type.replace(/[.:]/g, '_');

/** Category header in the current UI language (CATEGORY_LABELS keeps the pt copy). */
export function categoryLabel(category: NotificationCategory): string {
  return i18n.t(`settings:catalog.category.${catalogKey(category)}`, {
    defaultValue: CATEGORY_LABELS[category],
  });
}

/** label / when / recipients of a catalog type in the current UI language, resolved at
 * call time (NOTIFICATION_CATALOG keeps the pt copy). */
export function catalogText(type: NotificationType): {
  label: string;
  when: string;
  recipients: string;
} {
  const entry: NotificationCatalogEntry = NOTIFICATION_CATALOG[type];
  const base = `settings:catalog.types.${catalogKey(type)}`;
  return {
    label: i18n.t(`${base}.label`, { defaultValue: entry.label }),
    when: i18n.t(`${base}.when`, { defaultValue: entry.when }),
    recipients: i18n.t(`${base}.recipients`, { defaultValue: entry.recipients }),
  };
}
