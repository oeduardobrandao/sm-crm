import { toast } from 'sonner';

/**
 * Shown when a deploy lands while the tab is open. Persistent on purpose: the tab is
 * running code the server no longer serves, so the notice should not time out.
 */
export function showNewVersionToast() {
  toast('Nova versão disponível', {
    id: 'new-version',
    description: 'Atualize para continuar com a versão mais recente.',
    duration: Infinity,
    action: {
      label: 'Atualizar',
      onClick: () => window.location.reload(),
    },
  });
}
