import { describe, expect, it } from 'vitest';
import {
  getErrorIdentifier,
  getPostProcessErrorToast,
  isStaleStateError,
  POST_PROCESS_ERROR_MESSAGES,
} from '../postProcessErrors';

const err = (message: string) => ({ message, code: 'P0001' });

// Every code the fase-2 table lists (docs/superpowers/plans/2026-09-10-posts-individuais-fase2-rpcs.md,
// "Códigos de erro"). If a code is added server-side it must be added here too.
const ALL_CODES = [
  'workspace_not_found',
  'permission_denied',
  'invalid_arguments',
  'post_ids_required',
  'post_not_found',
  'post_not_in_source_flow',
  'post_in_workflow',
  'post_already_in_flow',
  'post_has_active_process',
  'post_belongs_to_another_client',
  'post_changed',
  'workflow_not_found',
  'workflow_not_active',
  'workflow_changed',
  'workflow_etapas_inconsistent',
  'template_not_found',
  'template_empty',
  'template_invalid',
  'template_changed',
  'invalid_start_ordem',
  'invalid_step_overrides',
  'invalid_step_deadlines',
  'start_deadline_required',
  'step_deadline_required',
  'data_entrega_requires_approval_step',
  'active_deadline_required',
  'next_deadline_required',
  'expected_post_status_required',
  'approval_choice_required',
  'invalid_approval_choice',
  'invalid_command',
  'membro_not_found',
  'process_not_found',
  'process_changed',
  'process_not_active',
  'process_not_concluded',
  'process_already_closed',
  'step_not_found',
  'step_not_editable',
  'no_next_step',
  'no_previous_step',
  'pending_steps_remaining',
  'request_id_required',
  'request_not_found',
  'request_mismatch',
];

describe('POST_PROCESS_ERROR_MESSAGES', () => {
  it('cobre todos os códigos identificadores da tabela da fase 2', () => {
    for (const code of ALL_CODES) {
      expect(POST_PROCESS_ERROR_MESSAGES[code], code).toBeTruthy();
      expect(POST_PROCESS_ERROR_MESSAGES[code]).not.toMatch(/—/);
    }
  });
});

describe('getErrorIdentifier', () => {
  it('lê message de objetos de erro e devolve vazio para o resto', () => {
    expect(getErrorIdentifier(err('process_changed'))).toBe('process_changed');
    expect(getErrorIdentifier(new Error('post_changed'))).toBe('post_changed');
    expect(getErrorIdentifier(null)).toBe('');
    expect(getErrorIdentifier('x')).toBe('');
  });
});

describe('getPostProcessErrorToast', () => {
  it('mapeia um código conhecido', () => {
    expect(getPostProcessErrorToast(err('process_changed'), 'fallback')).toBe(
      POST_PROCESS_ERROR_MESSAGES.process_changed,
    );
  });
  it('usa a frase de entitlement para feature_disabled e plan_limit', () => {
    expect(getPostProcessErrorToast(err('feature_disabled:feature_post_processes'), 'x')).toBe(
      'O recurso "Processos individuais de produção" não está disponível no seu plano.',
    );
    expect(getPostProcessErrorToast(err('plan_limit_exceeded:max_posts_per_workflow'), 'x')).toBe(
      'Você atingiu o limite de posts por fluxo do seu plano.',
    );
  });
  it('cai no fallback para código desconhecido e para erro sem message', () => {
    expect(getPostProcessErrorToast(err('something_else'), 'Erro ao avançar etapa')).toBe(
      'Erro ao avançar etapa',
    );
    expect(getPostProcessErrorToast(undefined, 'Erro')).toBe('Erro');
  });
});

describe('isStaleStateError', () => {
  it('é verdadeiro só para os códigos de estado obsoleto', () => {
    for (const c of [
      'workflow_changed',
      'process_changed',
      'post_changed',
      'template_changed',
      'request_mismatch',
      'post_has_active_process',
      'post_in_workflow',
      'post_already_in_flow',
    ]) {
      expect(isStaleStateError(err(c)), c).toBe(true);
    }
    expect(isStaleStateError(err('permission_denied'))).toBe(false);
    expect(isStaleStateError(null)).toBe(false);
  });
});
