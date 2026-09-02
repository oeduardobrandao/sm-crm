import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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

const STATUS_TAG: Record<Exclude<Cliente['status'], 'ativo'>, string> = {
  pausado: '(pausado)',
  encerrado: '(encerrado)',
};

/** "Seus clientes": matriz do relatório mensal e das pendências do Hub por
 * cliente, cada uma com um interruptor geral — workspaces.send_report_email /
 * workspaces.send_client_event_emails — e um por cliente —
 * clientes.send_report_email / clientes.send_event_email. Um cliente que já
 * se descadastrou do digest de pendências (clientes.event_email_unsub_at)
 * tem o interruptor daquela coluna esmaecido; reativar exige confirmação num
 * AlertDialog, nunca um toggle direto. Renderizada só para owner/admin: o
 * gate fica em NotificacoesTab. */
export default function SeusClientesSection() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [confirmReactivateId, setConfirmReactivateId] = useState<number | null>(null);

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

  if (clientesLoading || brandingLoading) {
    return (
      <div className="card animate-up flex justify-center p-8">
        <Spinner />
      </div>
    );
  }

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

  return (
    <div className="card animate-up">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Seus clientes</h2>
        <p className="text-sm text-[color:var(--text-muted)]">
          O relatório mensal e as pendências do Hub de cada cliente, um por um. Os gerais ligam ou
          desligam todo mundo de uma vez.
        </p>
      </div>

      <div className="grid grid-cols-[1fr_170px_170px] items-start gap-2 pb-2">
        <span />
        <div className="text-center">
          <div className="text-xs font-medium text-[color:var(--text-muted)]">Relatório mensal</div>
          <div className="text-xs text-[color:var(--text-muted)]">
            todo dia 1º, com PDF e resumo do mês
          </div>
        </div>
        <div className="text-center">
          <div className="text-xs font-medium text-[color:var(--text-muted)]">
            Pendências do Hub
          </div>
          <div className="text-xs text-[color:var(--text-muted)]">
            posts a aprovar e mensagens não lidas · máx. 1 e-mail a cada 4h
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_170px_170px] items-center gap-2 rounded-lg bg-[color-mix(in_srgb,var(--warning)_15%,transparent)] p-3">
        <span className="font-medium">Todos os clientes</span>
        <span className="flex justify-center">
          <Switch
            aria-label="Relatório mensal para todos os clientes"
            checked={masterEnabled}
            onCheckedChange={(v) => saveMaster.mutate(v)}
          />
        </span>
        <span className="flex justify-center">
          <Switch
            aria-label="Pendências do Hub para todos os clientes"
            checked={masterEventEnabled}
            onCheckedChange={(v) => saveMasterEvent.mutate(v)}
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
          const unsubbed = !!cliente.event_email_unsub_at;
          // Clientes homônimos: o e-mail (ou, sem ele, o id) desambigua o
          // nome acessível de cada linha.
          const identifiedName =
            cliente.id != null ? `${cliente.nome} (cliente ${cliente.id})` : cliente.nome;
          const statusTag =
            cliente.status && cliente.status !== 'ativo' ? STATUS_TAG[cliente.status] : null;
          return (
            <div
              key={cliente.id}
              className="grid grid-cols-[1fr_170px_170px] items-center gap-2 py-3"
            >
              <div>
                <div className="font-medium">
                  {cliente.nome}
                  {statusTag && (
                    <span className="ml-1 text-xs font-normal text-[color:var(--text-muted)]">
                      {statusTag}
                    </span>
                  )}
                </div>
                <div className="text-sm text-[color:var(--text-muted)]">
                  {hasEmail ? cliente.email : 'sem e-mail cadastrado'}
                </div>
              </div>
              <span className="flex justify-center">
                {hasEmail ? (
                  <Switch
                    aria-label={`Relatório mensal para ${cliente.nome} (${cliente.email})`}
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
                    aria-label={`${identifiedName}: sem e-mail cadastrado (relatório mensal)`}
                  >
                    ·
                  </span>
                )}
              </span>
              <span className="flex flex-col items-center justify-center gap-0.5">
                {hasEmail ? (
                  <>
                    <Switch
                      aria-label={`Pendências do Hub para ${cliente.nome} (${cliente.email})`}
                      checked={cliente.send_event_email ?? false}
                      // Deliberadamente NÃO usa a prop `disabled`: um controle
                      // realmente desabilitado não recebe clique nenhum, e
                      // reativar precisa do clique para abrir o AlertDialog de
                      // confirmação. O esmaecimento é só visual.
                      className={unsubbed ? 'opacity-60' : undefined}
                      onCheckedChange={(v) => {
                        if (cliente.id == null) return;
                        if (unsubbed) {
                          setConfirmReactivateId(cliente.id);
                          return;
                        }
                        saveClienteEvent.mutate({ id: cliente.id, patch: { send_event_email: v } });
                      }}
                    />
                    {unsubbed && (
                      // --warning não tem contraparte de texto acessível (o
                      // mesmo problema documentado para --danger/--danger-text
                      // no DESIGN_SYSTEM.md) — usa --text-muted, já AA neste
                      // arquivo, em vez de colorir a nota.
                      <span className="text-center text-xs leading-tight text-[color:var(--text-muted)]">
                        desativado pelo cliente
                      </span>
                    )}
                  </>
                ) : (
                  <span
                    className="text-center text-[color:var(--text-muted)]"
                    title="Sem e-mail cadastrado"
                    aria-label={`${identifiedName}: sem e-mail cadastrado (pendências do Hub)`}
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

      <AlertDialog
        open={confirmReactivateId != null}
        onOpenChange={(open) => {
          if (!open) setConfirmReactivateId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Reativar pendências do Hub{confirmCliente ? ` para ${confirmCliente.nome}` : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              O cliente pediu para não receber estes e-mails. Reativar mesmo assim?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmReactivate}>Reativar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
