import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import {
  getClientes,
  updateCliente,
  getWorkspaceBranding,
  updateWorkspaceBranding,
  type Cliente,
} from '@/store';

const CLIENTES_QUERY_KEY = ['seus-clientes-report'];
const BRANDING_QUERY_KEY = ['seus-clientes-branding'];

const SAVE_ERROR_MESSAGE = 'Não foi possível salvar. Tente novamente.';

export const STATUS_TAG: Record<Exclude<Cliente['status'], 'ativo'>, string> = {
  pausado: '(pausado)',
  encerrado: '(encerrado)',
};

/**
 * State and saves of "Seus clientes" (see SeusClientesSection for the rules). Shared
 * by the desktop section and the phone sub-screen, so both write through the same
 * optimistic mutations and the same reactivation confirm.
 *
 * `canEditClients` (`clientes:editar`) is the real authorization limit for these
 * writes: `clientes`/`workspaces` have tenant-only RLS (Task 14, external review round
 * 3, P1).
 */
export function useSeusClientes() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [confirmReactivateId, setConfirmReactivateId] = useState<number | null>(null);
  const { can } = useAuth();
  const canEditClients = can('clientes', 'editar') === true;

  const { data: clientes, isLoading: clientesLoading } = useQuery({
    queryKey: CLIENTES_QUERY_KEY,
    queryFn: getClientes,
  });
  const { data: branding, isLoading: brandingLoading } = useQuery({
    queryKey: BRANDING_QUERY_KEY,
    queryFn: getWorkspaceBranding,
  });

  const saveMaster = useMutation({
    mutationFn: (enabled: boolean) => updateWorkspaceBranding({ send_report_email: enabled }),
    onMutate: async (enabled) => {
      // Optimistic flip so the switch responds instantly instead of waiting
      // on the round trip; cancelQueries first so an in-flight refetch can't
      // clobber this optimistic write with stale data.
      await qc.cancelQueries({ queryKey: BRANDING_QUERY_KEY });
      const prev =
        qc.getQueryData<Awaited<ReturnType<typeof getWorkspaceBranding>>>(BRANDING_QUERY_KEY);
      qc.setQueryData<Awaited<ReturnType<typeof getWorkspaceBranding>>>(
        BRANDING_QUERY_KEY,
        (old) => (old ? { ...old, send_report_email: enabled } : old),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(BRANDING_QUERY_KEY, ctx.prev);
      toast.error(SAVE_ERROR_MESSAGE);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: BRANDING_QUERY_KEY });
      // Configuração > Relatórios lê o mesmo workspaces.send_report_email por
      // outra chave: invalida para não ficar até 30s defasada entre telas.
      qc.invalidateQueries({ queryKey: ['workspace-branding'] });
    },
  });

  const saveMasterEvent = useMutation({
    mutationFn: (enabled: boolean) =>
      updateWorkspaceBranding({ send_client_event_emails: enabled }),
    onMutate: async (enabled) => {
      await qc.cancelQueries({ queryKey: BRANDING_QUERY_KEY });
      const prev =
        qc.getQueryData<Awaited<ReturnType<typeof getWorkspaceBranding>>>(BRANDING_QUERY_KEY);
      qc.setQueryData<Awaited<ReturnType<typeof getWorkspaceBranding>>>(
        BRANDING_QUERY_KEY,
        (old) => (old ? { ...old, send_client_event_emails: enabled } : old),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(BRANDING_QUERY_KEY, ctx.prev);
      toast.error(SAVE_ERROR_MESSAGE);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: BRANDING_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ['workspace-branding'] });
    },
  });

  const saveCliente = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      updateCliente(id, { send_report_email: enabled }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: CLIENTES_QUERY_KEY });
      const prev = qc.getQueryData<Cliente[]>(CLIENTES_QUERY_KEY);
      qc.setQueryData<Cliente[]>(CLIENTES_QUERY_KEY, (old) =>
        old?.map((c) => (c.id === v.id ? { ...c, send_report_email: v.enabled } : c)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(CLIENTES_QUERY_KEY, ctx.prev);
      toast.error(SAVE_ERROR_MESSAGE);
    },
    onSettled: (_data, _error, v) => {
      qc.invalidateQueries({ queryKey: CLIENTES_QUERY_KEY });
      // A aba Relatórios do cliente lê o mesmo clientes.send_report_email por
      // outra chave: invalida para não ficar até 30s defasada entre telas.
      qc.invalidateQueries({ queryKey: ['cliente', v.id] });
    },
  });

  const saveClienteEvent = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: number;
      patch: Partial<Pick<Cliente, 'send_event_email' | 'event_email_unsub_at'>>;
    }) => updateCliente(id, patch),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: CLIENTES_QUERY_KEY });
      const prev = qc.getQueryData<Cliente[]>(CLIENTES_QUERY_KEY);
      qc.setQueryData<Cliente[]>(CLIENTES_QUERY_KEY, (old) =>
        old?.map((c) => (c.id === v.id ? { ...c, ...v.patch } : c)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(CLIENTES_QUERY_KEY, ctx.prev);
      toast.error(SAVE_ERROR_MESSAGE);
    },
    onSettled: (_data, _error, v) => {
      qc.invalidateQueries({ queryKey: CLIENTES_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ['cliente', v.id] });
    },
  });

  const masterEnabled = branding?.send_report_email ?? false;
  const masterEventEnabled = branding?.send_client_event_emails ?? false;
  const query = search.trim().toLowerCase();
  const filtered = (clientes ?? []).filter((c) => c.nome.toLowerCase().includes(query));
  const confirmCliente = (clientes ?? []).find((c) => c.id === confirmReactivateId) ?? null;

  const handleConfirmReactivate = () => {
    if (confirmReactivateId == null) return;
    saveClienteEvent.mutate({
      id: confirmReactivateId,
      patch: { send_event_email: true, event_email_unsub_at: null },
    });
    setConfirmReactivateId(null);
  };

  /** Per-client report switch. */
  const changeClienteReport = (cliente: Cliente, enabled: boolean) => {
    if (cliente.id == null) return;
    saveCliente.mutate({ id: cliente.id, enabled });
  };

  /** Per-client pendências switch: a client who unsubscribed goes through the
   * reactivation confirm instead of a direct toggle. */
  const changeClienteEvent = (cliente: Cliente, enabled: boolean) => {
    if (cliente.id == null || !canEditClients) return;
    if (cliente.event_email_unsub_at) {
      setConfirmReactivateId(cliente.id);
      return;
    }
    saveClienteEvent.mutate({ id: cliente.id, patch: { send_event_email: enabled } });
  };

  return {
    loading: clientesLoading || brandingLoading,
    canEditClients,
    masterEnabled,
    masterEventEnabled,
    search,
    setSearch,
    filtered,
    confirmReactivateId,
    setConfirmReactivateId,
    confirmCliente,
    handleConfirmReactivate,
    saveMaster: saveMaster.mutate,
    saveMasterEvent: saveMasterEvent.mutate,
    changeClienteReport,
    changeClienteEvent,
  };
}
