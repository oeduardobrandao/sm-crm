import { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Users,
  FileText,
  UserRound,
  Wallet,
  Kanban,
  Image,
  Lightbulb,
  LayoutGrid,
  Loader2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import {
  getClientes,
  getContratos,
  getMembros,
  getTransacoes,
  getWorkflows,
  getAllWorkflowPosts,
  getIdeias,
  getAllHubPages,
} from '@/store';

export default function GlobalSearchTrigger() {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(v => !v);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const results = useQueries({
    queries: [
      { queryKey: ['clientes'], queryFn: getClientes, enabled: open },
      { queryKey: ['contratos'], queryFn: getContratos, enabled: open },
      { queryKey: ['membros'], queryFn: getMembros, enabled: open },
      { queryKey: ['transacoes'], queryFn: getTransacoes, enabled: open },
      { queryKey: ['workflows'], queryFn: getWorkflows, enabled: open },
      { queryKey: ['all-workflow-posts'], queryFn: getAllWorkflowPosts, enabled: open },
      { queryKey: ['ideias'], queryFn: () => getIdeias(), enabled: open },
      { queryKey: ['all-hub-pages'], queryFn: getAllHubPages, enabled: open },
    ],
  });

  const [clientesRes, contratosRes, membrosRes, transacoesRes, workflowsRes, postsRes, ideiasRes, pagesRes] = results;
  const isLoading = results.some(r => r.isLoading);

  const clientes = clientesRes.data ?? [];
  const contratos = contratosRes.data ?? [];
  const membros = membrosRes.data ?? [];
  const transacoes = transacoesRes.data ?? [];
  const workflows = workflowsRes.data ?? [];
  const posts = postsRes.data ?? [];
  const ideias = ideiasRes.data ?? [];
  const pages = pagesRes.data ?? [];

  const clienteMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of clientes) if (c.id) map.set(c.id, c.nome);
    return map;
  }, [clientes]);

  const workflowMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const w of workflows) if (w.id) map.set(w.id, w.titulo);
    return map;
  }, [workflows]);

  const go = (route: string) => {
    setOpen(false);
    navigate(route);
  };

  const isMac = navigator.platform.toUpperCase().includes('MAC');

  return (
    <>
      <button type="button" className="search-trigger" onClick={() => setOpen(true)}>
        <Search size={15} className="search-trigger-icon" />
        <span className="search-trigger-text">{t('topbar.search', 'Buscar...')}</span>
        <kbd className="search-trigger-kbd">{isMac ? '⌘' : 'Ctrl+'}K</kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder={t('topbar.searchPlaceholder', 'Buscar...')} />
        <CommandList>
          {isLoading ? (
            <div className="py-6 text-center">
              <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <CommandEmpty>{t('topbar.noResults', 'Nenhum resultado.')}</CommandEmpty>

              {clientes.length > 0 && (
                <CommandGroup heading="Clientes">
                  {clientes.map(c => (
                    <CommandItem
                      key={`cliente-${c.id}`}
                      value={`cliente ${c.nome} ${c.email} ${c.sigla}`}
                      onSelect={() => go(`/clientes/${c.id}`)}
                    >
                      <Users className="h-4 w-4 shrink-0" />
                      <span className="truncate">{c.nome}</span>
                      <span className="ml-auto truncate text-xs text-muted-foreground">{c.email}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {contratos.length > 0 && (
                <CommandGroup heading="Contratos">
                  {contratos.map(c => (
                    <CommandItem
                      key={`contrato-${c.id}`}
                      value={`contrato ${c.titulo} ${c.cliente_nome}`}
                      onSelect={() => go('/contratos')}
                    >
                      <FileText className="h-4 w-4 shrink-0" />
                      <span className="truncate">{c.titulo}</span>
                      <span className="ml-auto truncate text-xs text-muted-foreground">{c.cliente_nome}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {membros.length > 0 && (
                <CommandGroup heading="Equipe">
                  {membros.map(m => (
                    <CommandItem
                      key={`membro-${m.id}`}
                      value={`equipe ${m.nome} ${m.cargo}`}
                      onSelect={() => go(`/equipe/${m.id}`)}
                    >
                      <UserRound className="h-4 w-4 shrink-0" />
                      <span className="truncate">{m.nome}</span>
                      <span className="ml-auto truncate text-xs text-muted-foreground">{m.cargo}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {transacoes.length > 0 && (
                <CommandGroup heading="Financeiro">
                  {transacoes.map(tx => (
                    <CommandItem
                      key={`transacao-${tx.id}`}
                      value={`financeiro ${tx.descricao} ${tx.categoria} ${tx.detalhe}`}
                      onSelect={() => go('/financeiro')}
                    >
                      <Wallet className="h-4 w-4 shrink-0" />
                      <span className="truncate">{tx.descricao}</span>
                      <span className="ml-auto truncate text-xs text-muted-foreground">{tx.categoria}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {workflows.length > 0 && (
                <CommandGroup heading="Workflows">
                  {workflows.map(w => (
                    <CommandItem
                      key={`workflow-${w.id}`}
                      value={`workflow ${w.titulo}`}
                      onSelect={() => go(`/entregas?drawer=${w.id}`)}
                    >
                      <Kanban className="h-4 w-4 shrink-0" />
                      <span className="truncate">{w.titulo}</span>
                      <span className="ml-auto truncate text-xs text-muted-foreground">{w.status}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {posts.length > 0 && (
                <CommandGroup heading="Postagens">
                  {posts.map(p => (
                    <CommandItem
                      key={`post-${p.id}`}
                      value={`postagem ${p.titulo} ${workflowMap.get(p.workflow_id) ?? ''}`}
                      onSelect={() => go(`/entregas?drawer=${p.workflow_id}`)}
                    >
                      <Image className="h-4 w-4 shrink-0" />
                      <span className="truncate">{p.titulo}</span>
                      <span className="ml-auto truncate text-xs text-muted-foreground">{p.tipo}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {ideias.length > 0 && (
                <CommandGroup heading="Ideias">
                  {ideias.map(idea => (
                    <CommandItem
                      key={`ideia-${idea.id}`}
                      value={`ideia ${idea.titulo} ${idea.clientes?.nome ?? ''}`}
                      onSelect={() => go('/ideias')}
                    >
                      <Lightbulb className="h-4 w-4 shrink-0" />
                      <span className="truncate">{idea.titulo}</span>
                      <span className="ml-auto truncate text-xs text-muted-foreground">{idea.clientes?.nome}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {pages.length > 0 && (
                <CommandGroup heading="Páginas">
                  {pages.map(pg => (
                    <CommandItem
                      key={`page-${pg.id}`}
                      value={`pagina ${pg.title} ${clienteMap.get(pg.cliente_id) ?? ''}`}
                      onSelect={() => go(`/clientes/${pg.cliente_id}`)}
                    >
                      <LayoutGrid className="h-4 w-4 shrink-0" />
                      <span className="truncate">{pg.title}</span>
                      <span className="ml-auto truncate text-xs text-muted-foreground">
                        {clienteMap.get(pg.cliente_id)}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
