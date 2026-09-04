import type { GuideProgress } from './guideStorage';

/**
 * Auto-abertura do guia (spec 2026-08-25): dono do workspace, primeira visita
 * ao dashboard, workspace sem clientes E sem fluxos, com AMBAS as queries em
 * sucesso explícito. Erro nunca conta como vazio: abrir o wizard para um
 * workspace ativo durante uma falha transitória seria pior que não abrir.
 */
export function shouldAutoOpenGuide(i: {
  authLoading: boolean;
  isOwner: boolean;
  pathname: string;
  progress: GuideProgress;
  clientes: { status: string; count: number };
  workflows: { status: string; count: number };
}): boolean {
  if (i.authLoading || !i.isOwner) return false;
  if (i.pathname !== '/dashboard') return false;
  if (i.progress.autoOpenedAt || i.progress.dismissedAt || i.progress.concludedAt) return false;
  if (i.clientes.status !== 'success' || i.workflows.status !== 'success') return false;
  return i.clientes.count === 0 && i.workflows.count === 0;
}

export type GuideAutoOpenState = 'unknown' | 'no' | 'yes';

/**
 * O que o GlobalPopupHost precisa saber do guia, sem o critério de rota de
 * shouldAutoOpenGuide: 'yes' = já está aberto ou vai abrir assim que o dono chegar
 * ao dashboard; 'no' = não vai abrir nesta sessão; 'unknown' = ainda não dá para
 * saber (auth ou sinais em pending). Erro de sinal é 'no': o guia nunca abre sobre
 * erro, então esperar seria bloquear o popup para sempre.
 */
export function guideAutoOpenState(i: {
  authLoading: boolean;
  isOwner: boolean;
  opened: boolean;
  progress: GuideProgress;
  clientes: { status: string; count: number };
  workflows: { status: string; count: number };
}): GuideAutoOpenState {
  if (i.opened) return 'yes';
  if (i.authLoading) return 'unknown';
  if (!i.isOwner) return 'no';
  if (i.progress.autoOpenedAt || i.progress.dismissedAt || i.progress.concludedAt) return 'no';
  if (i.clientes.status === 'error' || i.workflows.status === 'error') return 'no';
  if (i.clientes.status !== 'success' || i.workflows.status !== 'success') return 'unknown';
  return i.clientes.count === 0 && i.workflows.count === 0 ? 'yes' : 'no';
}
