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
