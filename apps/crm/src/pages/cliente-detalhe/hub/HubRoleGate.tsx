import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/context/AuthContext';
import { RoleRestrictionNotice } from '@/components/help/RoleRestrictionNotice';
import { Spinner } from '@/components/ui/spinner';
import type { PermissionCheck } from '@/lib/permissions';

/**
 * O gate das cinco rotas do portal (`hub/acesso`, `hub/briefing`, `hub/marca`,
 * `hub/paginas`, `hub/ideias`). Este arquivo é o ÚNICO lugar que define o que
 * é "restrito" no portal — nenhuma página repete a checagem.
 *
 * Herdado do `HubClienteTab.tsx` pré-split (origin/main, Tasks 12/14), que
 * fazia esta mesma decisão uma vez para a então única aba "Hub":
 *
 * - Task 12 (permission-model rewire) moveu o gate de rota de `roles` para
 *   `permission: configuracoes:editar` em `clienteTabs.model.ts` — o mesmo
 *   par que as cinco entradas do grupo `portal` carregam hoje. Um `agent`
 *   legado nunca tem essa permissão, então o guard de `ClienteDetalhePage`
 *   já o redireciona antes destas páginas montarem.
 *
 * - Task 14: a checagem interna NÃO pode ser o `workspaceRole === 'agent'`
 *   grosseiro. Uma role CUSTOM cujo `workspaceRole` de chassi lê 'agent' mas
 *   cujas permissões (via `role_id`) concedem `configuracoes:editar` passa
 *   pelo guard de rota e chega aqui; a checagem por papel mostrava então um
 *   aviso de restrição que contradizia o guard (e o servidor), que já tinham
 *   autorizado o membro. Por isso o gate lê exatamente o mesmo
 *   `can('configuracoes', 'editar')` que o guard de rota usa.
 *
 * - Task 14, segunda rodada (review externo, hidratação): `can()` é
 *   TRI-ESTADO — `derivePermission` devolve `'unknown'` enquanto a membership
 *   não resolveu. Ler `!== true` trata `'unknown'` como um `false` explícito
 *   e piscava o aviso de restrição para TODO viewer, owner/admin incluídos,
 *   nos primeiros um ou dois renders. Agora `false` mostra o aviso,
 *   `'unknown'` mostra um spinner (sem aviso e sem conteúdo) e só `true`
 *   renderiza o portal de verdade.
 */
export function useHubPortalAccess(): PermissionCheck {
  const { can } = useAuth();
  return can('configuracoes', 'editar');
}

/**
 * "Pode buscar os dados do portal?" — verdadeiro SÓ quando o acesso resolveu
 * como `true`. `'unknown'` conta como não-liberado de propósito: enquanto a
 * membership não resolve não se sabe se este viewer pode ver o dado, e as
 * páginas usam isto em `enabled:` para não disparar `hub-token`,
 * `hub-brand-crm`, `hub-pages-crm` e `hub-portal-fill` antes da resposta.
 *
 * Existe para que as páginas desliguem as próprias queries em vez de buscar
 * o dado que o gate existe para esconder e só então descartar o resultado no
 * render — um `agent` nunca deve nem tocar no bearer token do portal.
 * `HubRoleGate` continua sendo quem define o gate; isto só lê a mesma fonte.
 */
export function useHubPortalDataEnabled(): boolean {
  return useHubPortalAccess() === true;
}

export function HubRoleGate({ children }: { children: ReactNode }) {
  const access = useHubPortalAccess();
  const { t } = useTranslation('clients');

  if (access === 'unknown') {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="md" />
      </div>
    );
  }

  if (access === false) {
    return (
      <RoleRestrictionNotice
        title={t('detail.clientHubRestrictedTitle')}
        description={t('detail.clientHubRestrictedDesc')}
      />
    );
  }

  return <>{children}</>;
}
