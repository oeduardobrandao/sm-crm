import { supabase } from '../../lib/supabase';
import { isPlaceholderSlug, slugifyWorkspaceName, workspaceSlugSuffix } from './setupHelpers';

export interface WorkspaceSetupInput {
  userId: string;
  workspaceId: string;
  /** All string inputs arrive trimmed. */
  nome: string;
  empresa: string;
  telefone: string;
  marketingOptIn: boolean;
}

/**
 * Saves the post-signup step. Every write is idempotent and `profiles.empresa` (the setup gate
 * in ProtectedRoute) is written last, so a retry after a partial failure converges. Throws on
 * any required write; the `contas` mirror is best-effort.
 */
export async function saveWorkspaceSetup(input: WorkspaceSetupInput): Promise<void> {
  const { userId, workspaceId, nome, empresa, telefone, marketingOptIn } = input;

  const { data: ws, error: slugErr } = await supabase
    .from('workspaces')
    .select('slug')
    .eq('id', workspaceId)
    .maybeSingle();
  if (slugErr) throw slugErr;

  // Only the blank-company signup placeholder is rewritten: any other slug may already be in a
  // hub link sent to a client. The id suffix keeps the unique slug index safe.
  const currentSlug = (ws as { slug?: string | null } | null)?.slug;
  const newSlug = isPlaceholderSlug(currentSlug, workspaceId)
    ? `${slugifyWorkspaceName(empresa)}-${workspaceSlugSuffix(workspaceId)}`
    : undefined;

  const { error: wsErr } = await supabase
    .from('workspaces')
    .update({ name: empresa, ...(newSlug ? { slug: newSlug } : {}) })
    .eq('id', workspaceId);
  if (wsErr) throw wsErr;

  // `contas` has no policies or grants in the repo migrations (adopted from prod), so a refusal
  // here must not lock the owner out of setup. Only getWorkspaceSlug() falls back to it.
  try {
    const { error: contasErr } = await supabase
      .from('contas')
      .update({ nome: empresa, ...(newSlug ? { slug: newSlug } : {}) })
      .eq('id', workspaceId);
    if (contasErr) console.warn('[workspace-setup] contas mirror skipped:', contasErr);
  } catch (err) {
    console.warn('[workspace-setup] contas mirror skipped:', err);
  }

  const { error: profileErr } = await supabase
    .from('profiles')
    .update({ nome, telefone, marketing_opt_in: marketingOptIn, empresa })
    .eq('id', userId);
  if (profileErr) throw profileErr;
}
