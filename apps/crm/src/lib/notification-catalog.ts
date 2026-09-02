import type { NotificationType } from '@/store/notifications';

export type NotificationCategory =
  'aprovacoes_hub' | 'entregas_fluxo' | 'equipe' | 'integracoes' | 'sistema';

export const CATEGORY_ORDER: NotificationCategory[] = [
  'aprovacoes_hub',
  'entregas_fluxo',
  'equipe',
  'integracoes',
  'sistema',
];

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  aprovacoes_hub: 'Aprovações e Hub',
  entregas_fluxo: 'Entregas e fluxo',
  equipe: 'Equipe',
  integracoes: 'Integrações',
  sistema: 'Sistema',
};

export interface NotificationCatalogEntry {
  category: NotificationCategory;
  label: string;
  when: string;
  recipients: string;
  emailEligible: boolean;
}

const RESP_ADMINS = 'responsável pelo item + donos e admins';
const ADMINS = 'donos e admins';

export const NOTIFICATION_CATALOG = {
  post_approved: {
    category: 'aprovacoes_hub',
    label: 'Post aprovado pelo cliente',
    when: 'o cliente aprova um post no Hub',
    recipients: RESP_ADMINS,
    emailEligible: true,
  },
  post_correction: {
    category: 'aprovacoes_hub',
    label: 'Correção solicitada',
    when: 'o cliente pede correção em um post',
    recipients: RESP_ADMINS,
    emailEligible: true,
  },
  post_message: {
    category: 'aprovacoes_hub',
    label: 'Mensagem em um post',
    when: 'o cliente comenta em um post específico',
    recipients: RESP_ADMINS,
    emailEligible: true,
  },
  post_edit_suggestion: {
    category: 'aprovacoes_hub',
    label: 'Sugestão de edição',
    when: 'o cliente sugere uma alteração de legenda no Hub',
    recipients: RESP_ADMINS,
    emailEligible: false,
  },
  idea_submitted: {
    category: 'aprovacoes_hub',
    label: 'Ideia enviada',
    when: 'o cliente envia uma ideia ou solicitação',
    recipients: ADMINS,
    emailEligible: false,
  },
  briefing_answered: {
    category: 'aprovacoes_hub',
    label: 'Briefing respondido',
    when: 'o cliente responde uma pergunta do briefing',
    recipients: ADMINS,
    emailEligible: false,
  },
  client_message: {
    category: 'aprovacoes_hub',
    label: 'Mensagem do cliente',
    when: 'o cliente escreve no feed de mensagens',
    recipients: ADMINS,
    emailEligible: true,
  },
  step_activated: {
    category: 'entregas_fluxo',
    label: 'Etapa ativada',
    when: 'uma etapa do fluxo fica ativa',
    recipients: RESP_ADMINS,
    emailEligible: false,
  },
  step_completed: {
    category: 'entregas_fluxo',
    label: 'Etapa concluída',
    when: 'uma etapa do fluxo é concluída',
    recipients: ADMINS,
    emailEligible: false,
  },
  post_assigned: {
    category: 'entregas_fluxo',
    label: 'Post atribuído a você',
    when: 'um post é atribuído a você',
    recipients: 'somente quem foi atribuído',
    emailEligible: true,
  },
  task_assigned: {
    category: 'entregas_fluxo',
    label: 'Tarefa atribuída a você',
    when: 'uma tarefa é criada para você ou reatribuída',
    recipients: 'somente quem foi atribuído',
    emailEligible: true,
  },
  workflow_completed: {
    category: 'entregas_fluxo',
    label: 'Fluxo concluído',
    when: 'um fluxo inteiro é concluído',
    recipients: ADMINS,
    emailEligible: false,
  },
  deadline_approaching: {
    category: 'entregas_fluxo',
    label: 'Prazo se aproximando',
    when: 'uma etapa ativa vence amanhã',
    recipients: RESP_ADMINS,
    emailEligible: true,
  },
  post_status_automation: {
    category: 'entregas_fluxo',
    label: 'Automação de status',
    when: 'uma regra sua de status dispara uma notificação',
    recipients: 'conforme a regra configurada',
    emailEligible: false,
  },
  invite_accepted: {
    category: 'equipe',
    label: 'Convite aceito',
    when: 'alguém entra no workspace',
    recipients: ADMINS,
    emailEligible: false,
  },
  member_role_changed: {
    category: 'equipe',
    label: 'Papel alterado',
    when: 'o papel de um membro muda',
    recipients: ADMINS,
    emailEligible: false,
  },
  member_removed: {
    category: 'equipe',
    label: 'Membro removido',
    when: 'um membro é removido do workspace',
    recipients: ADMINS,
    emailEligible: false,
  },
  mention: {
    category: 'equipe',
    label: 'Menções',
    when: 'alguém menciona você com @',
    recipients: 'somente quem foi mencionado',
    emailEligible: true,
  },
  instagram_connected_by_client: {
    category: 'integracoes',
    label: 'Instagram conectado',
    when: 'o cliente conclui a conexão pelo link que você enviou',
    recipients: 'quem criou o link',
    emailEligible: false,
  },
  post_publish_failed: {
    category: 'integracoes',
    label: 'Falha na publicação',
    when: 'um post agendado falha ao publicar',
    recipients: RESP_ADMINS,
    emailEligible: true,
  },
  instagram_automation_failed: {
    category: 'integracoes',
    label: 'Automação do Instagram com problema',
    when: 'uma automação de comentário para DM para de funcionar',
    recipients: ADMINS,
    emailEligible: false,
  },
  storage_autoclean_report: {
    category: 'sistema',
    label: 'Limpeza de armazenamento',
    when: 'a limpeza noturna remove arquivos antigos',
    recipients: ADMINS,
    emailEligible: false,
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
