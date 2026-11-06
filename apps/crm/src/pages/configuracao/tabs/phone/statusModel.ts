import type {
  CustomStatusBehavesAs,
  PostStatusAutomation,
  PostStatusDefinition,
  WorkflowPost,
  createPostStatusAutomation,
} from '../../../../store';
import { i18n } from '@mesaas/i18n';
import { STATUS_LABELS, POST_STATUS_ORDER } from '../../../entregas/postLabels';

/**
 * Options, labels and payload builders of the Status de posts tab, shared by the
 * desktop forms (StatusTab) and the phone screen (StatusPhone), so both build the
 * same rows and send the same payloads.
 */

export const BEHAVES_AS_OPTIONS: CustomStatusBehavesAs[] = [
  'rascunho',
  'revisao_interna',
  'aprovado_interno',
  'enviado_cliente',
  'aprovado_cliente',
  'correcao_cliente',
];

export const PRESET_COLORS = [
  '#94a3b8',
  '#7c5cff',
  '#0ea5b7',
  '#3b82f6',
  '#22c55e',
  '#eab308',
  '#f97316',
  '#ef4444',
  '#ec4899',
];

export type StatusCreatePayload = {
  nome: string;
  cor: string;
  icone: string | null;
  behaves_as: CustomStatusBehavesAs;
};

export type AutomationCreatePayload = Parameters<typeof createPostStatusAutomation>[0];

/** 'canonical:<status>' | 'custom:<uuid>' — local select encoding. */
export type TriggerValue = string;

export function triggerPatch(value: TriggerValue) {
  return value.startsWith('custom:')
    ? { trigger_status: null, trigger_custom_status_id: value.slice('custom:'.length) }
    : {
        trigger_status: value.slice('canonical:'.length) as WorkflowPost['status'],
        trigger_custom_status_id: null,
      };
}

/** Every canonical status in board order, each followed by its custom statuses. */
export function triggerOptions(
  defs: PostStatusDefinition[],
): { value: TriggerValue; label: string }[] {
  return POST_STATUS_ORDER.flatMap((status) => [
    { value: `canonical:${status}`, label: STATUS_LABELS[status] },
    ...defs
      .filter((d) => d.behaves_as === status)
      .map((d) => ({ value: `custom:${d.id}`, label: `· ${d.nome}` })),
  ]);
}

export type AutomationAction = 'notify' | 'assign_responsavel';
export type NotifyTarget = 'responsavel' | 'roles' | 'member';

/** `label` is a getter resolved through i18n on every read, so it follows the UI language. */
function option<V extends string>(value: V, key: string): { value: V; label: string } {
  return {
    value,
    get label() {
      return i18n.t(key);
    },
  };
}

export const ACTION_OPTIONS: { value: AutomationAction; label: string }[] = [
  option<AutomationAction>('notify', 'settingsHub:statusModel.action.notify'),
  option<AutomationAction>(
    'assign_responsavel',
    'settingsHub:statusModel.action.assignResponsavel',
  ),
];

export const NOTIFY_TARGET_OPTIONS: { value: NotifyTarget; label: string }[] = [
  option<NotifyTarget>('responsavel', 'settingsHub:statusModel.target.responsavel'),
  option<NotifyTarget>('roles', 'settingsHub:statusModel.target.roles'),
  option<NotifyTarget>('member', 'settingsHub:statusModel.target.member'),
];

export function automationNeedsMembro(action: AutomationAction, target: NotifyTarget): boolean {
  return action === 'assign_responsavel' || target === 'member';
}

/**
 * The create payload of the "Nova automação" form, or the validation message to show
 * (a member is required for "Atribuir responsável" and "Membro específico").
 */
export function buildAutomationPayload(input: {
  trigger: TriggerValue;
  action: AutomationAction;
  notifyTarget: NotifyTarget;
  membroId: number | '';
}): { payload: AutomationCreatePayload } | { error: string } {
  const { trigger, action, notifyTarget, membroId } = input;
  if (automationNeedsMembro(action, notifyTarget) && membroId === '') {
    return { error: i18n.t('settingsHub:statusModel.chooseMember') };
  }
  const config =
    action === 'assign_responsavel'
      ? { membro_id: membroId as number }
      : notifyTarget === 'member'
        ? { target: 'member' as const, membro_id: membroId as number }
        : notifyTarget === 'roles'
          ? { target: 'roles' as const, roles: ['owner', 'admin'] }
          : { target: 'responsavel' as const };
  return { payload: { ...triggerPatch(trigger), action_type: action, config } };
}

export function automationTriggerLabel(
  a: PostStatusAutomation,
  defs: PostStatusDefinition[],
): string {
  if (a.trigger_custom_status_id) {
    const def = defs.find((d) => d.id === a.trigger_custom_status_id);
    return def ? `· ${def.nome}` : i18n.t('settingsHub:statusModel.removedStatus');
  }
  return a.trigger_status ? STATUS_LABELS[a.trigger_status] : '';
}

export function automationActionLabel(
  a: PostStatusAutomation,
  membros: { id?: number; nome: string }[],
): string {
  if (a.action_type === 'assign_responsavel') {
    const membroId = 'membro_id' in a.config ? a.config.membro_id : null;
    const membro = membros.find((m) => m.id === membroId);
    return i18n.t('settingsHub:statusModel.assignTo', {
      name: membro?.nome ?? i18n.t('settingsHub:statusModel.removedMember'),
    });
  }
  const cfg = a.config as { target?: string; membro_id?: number };
  if (cfg.target === 'member') {
    const membro = membros.find((m) => m.id === cfg.membro_id);
    return i18n.t('settingsHub:statusModel.notifyMember', {
      name: membro?.nome ?? i18n.t('settingsHub:statusModel.removedMember'),
    });
  }
  if (cfg.target === 'roles') return i18n.t('settingsHub:statusModel.notifyRoles');
  return i18n.t('settingsHub:statusModel.notifyResponsavel');
}
