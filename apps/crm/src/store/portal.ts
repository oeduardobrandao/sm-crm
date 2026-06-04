import { supabase, getContaId } from './core';

export interface PortalApproval {
  id: number;
  workflow_etapa_id: number;
  action: 'aprovado' | 'correcao' | 'mensagem';
  comentario: string | null;
  created_at: string;
  is_workspace_user?: boolean;
}

export async function createPortalToken(workflowId: number): Promise<string> {
  const conta_id = await getContaId();
  // Check if token already exists
  const { data: existing } = await supabase
    .from('portal_tokens')
    .select('token')
    .eq('workflow_id', workflowId)
    .maybeSingle();
  if (existing) return existing.token;
  // Create new token
  const { data, error } = await supabase
    .from('portal_tokens')
    .insert({ workflow_id: workflowId, conta_id })
    .select('token')
    .single();
  if (error) throw error;
  return data.token;
}

export async function getPortalToken(workflowId: number): Promise<string | null> {
  const { data } = await supabase
    .from('portal_tokens')
    .select('token')
    .eq('workflow_id', workflowId)
    .maybeSingle();
  return data?.token || null;
}

export async function getPortalApprovals(etapaIds: number[]): Promise<PortalApproval[]> {
  if (etapaIds.length === 0) return [];
  const { data, error } = await supabase
    .from('portal_approvals')
    .select('id, workflow_etapa_id, action, comentario, created_at, is_workspace_user')
    .in('workflow_etapa_id', etapaIds)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function replyToPortalApproval(
  workflowId: number,
  etapaId: number,
  comentario: string,
): Promise<void> {
  const token = await getPortalToken(workflowId);
  if (!token) throw new Error('Workflow must be shared before replying.');

  const { error } = await supabase.from('portal_approvals').insert({
    workflow_etapa_id: etapaId,
    token,
    action: 'mensagem',
    comentario,
    is_workspace_user: true,
  });
  if (error) throw error;
}
