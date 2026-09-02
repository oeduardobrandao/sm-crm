import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
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

/** "Seus clientes": matriz do relatório mensal por cliente, com um interruptor
 * geral (workspaces.send_report_email) e um por cliente (clientes.send_report_email).
 * Só existe a coluna "Relatório mensal" nesta fase — "Pendências do Hub" chega
 * na Fase 2. Renderizada só para owner/admin: o gate fica em NotificacoesTab. */
export default function SeusClientesSection() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');

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
    onSuccess: () => qc.invalidateQueries({ queryKey: BRANDING_QUERY_KEY }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: CLIENTES_QUERY_KEY }),
  });

  if (clientesLoading || brandingLoading) {
    return (
      <div className="card animate-up flex justify-center p-8">
        <Spinner />
      </div>
    );
  }

  const masterEnabled = branding?.send_report_email ?? false;
  const query = search.trim().toLowerCase();
  const filtered = (clientes ?? []).filter((c) => c.nome.toLowerCase().includes(query));

  return (
    <div className="card animate-up">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Seus clientes</h2>
        <p className="text-sm text-[color:var(--text-muted)]">
          O relatório mensal de cada cliente, um por um. O geral liga ou desliga todo mundo de uma
          vez.
        </p>
      </div>

      <div className="grid grid-cols-[1fr_170px] items-start gap-2 pb-2">
        <span />
        <div className="text-center">
          <div className="text-xs font-medium text-[color:var(--text-muted)]">Relatório mensal</div>
          <div className="text-xs text-[color:var(--text-muted)]">
            todo dia 1º, com PDF e resumo do mês
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_170px] items-center gap-2 rounded-lg bg-[color-mix(in_srgb,var(--warning)_15%,transparent)] p-3">
        <span className="font-medium">Todos os clientes</span>
        <span className="flex justify-center">
          <Switch
            aria-label="Relatório mensal para todos os clientes"
            checked={masterEnabled}
            onCheckedChange={(v) => saveMaster.mutate(v)}
          />
        </span>
      </div>

      <div className="mt-4">
        <Input
          type="text"
          placeholder="Buscar cliente…"
          aria-label="Buscar cliente"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 && (
        <p className="mt-4 text-center text-sm text-[color:var(--text-muted)]">
          Nenhum cliente encontrado.
        </p>
      )}

      <div className="mt-2 divide-y divide-[color:var(--border-color)]">
        {filtered.map((cliente) => {
          const hasEmail = !!cliente.email;
          return (
            <div key={cliente.id} className="grid grid-cols-[1fr_170px] items-center gap-2 py-3">
              <div>
                <div className="font-medium">{cliente.nome}</div>
                <div className="text-sm text-[color:var(--text-muted)]">
                  {hasEmail ? cliente.email : 'sem e-mail cadastrado'}
                </div>
              </div>
              <span className="flex justify-center">
                {hasEmail ? (
                  <Switch
                    aria-label={`Relatório mensal para ${cliente.nome}`}
                    checked={cliente.send_report_email ?? false}
                    onCheckedChange={(v) => {
                      if (cliente.id == null) return;
                      saveCliente.mutate({ id: cliente.id, enabled: v });
                    }}
                  />
                ) : (
                  <span
                    className="text-center text-[color:var(--text-muted)]"
                    title="Sem e-mail cadastrado"
                    aria-label={`${cliente.nome}: sem e-mail cadastrado`}
                  >
                    ·
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-sm text-[color:var(--text-muted)]">
        Clientes sem e-mail cadastrado não recebem nada. Cadastre o e-mail na ficha do cliente.
      </p>
    </div>
  );
}
