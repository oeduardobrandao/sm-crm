import { useMemo } from 'react';
import {
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
import { getClientes } from '@/store/clients';
import { getContratos, getTransacoes } from '@/store/finance';
import { getMembros } from '@/store/team';
import { getWorkflows } from '@/store/workflows';
import { getAllWorkflowPosts } from '@/store/posts';
import { getIdeias } from '@/store/ideias';
import { getAllHubPages } from '@/store/hub';
import { useAuth } from '@/context/AuthContext';
import { getKbSearchIndex } from '@/store/kb';
import KbSearchGroup from './KbSearchGroup';

/** Deep link for a post result: NULL workflow_id = post avulso (fora de
 *  fluxo), which opens via the universal `?post=` form instead of
 *  `?drawer=&post=`. */
function postHref(p: { id?: number; workflow_id: number | null }): string {
  return p.workflow_id != null
    ? `/entregas?drawer=${p.workflow_id}&post=${p.id}`
    : `/entregas?post=${p.id}`;
}

interface GlobalSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Corpo da busca global (⌘K). Montado pelo GlobalSearchTrigger no desktop e
 * pelo MobileNav no celular; quem abre/fecha é o pai.
 */
export default function GlobalSearchDialog({ open, onOpenChange }: GlobalSearchDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { canSeeFinancials } = useAuth();
  const financialsAllowed = canSeeFinancials === true;

  const results = useQueries({
    queries: [
      { queryKey: ['clientes'], queryFn: getClientes, enabled: open },
      { queryKey: ['contratos'], queryFn: getContratos, enabled: open && financialsAllowed },
      { queryKey: ['membros'], queryFn: getMembros, enabled: open },
      { queryKey: ['transacoes'], queryFn: getTransacoes, enabled: open && financialsAllowed },
      { queryKey: ['workflows'], queryFn: getWorkflows, enabled: open },
      { queryKey: ['all-workflow-posts'], queryFn: getAllWorkflowPosts, enabled: open },
      { queryKey: ['ideias'], queryFn: () => getIdeias(), enabled: open },
      { queryKey: ['all-hub-pages'], queryFn: getAllHubPages, enabled: open },
      // Índice leve dos artigos da Central de Ajuda (plataforma, muda pouco).
      {
        queryKey: ['kb-search-index'],
        queryFn: getKbSearchIndex,
        enabled: open,
        staleTime: 5 * 60_000,
      },
    ],
  });

  const [
    clientesRes,
    contratosRes,
    membrosRes,
    transacoesRes,
    workflowsRes,
    postsRes,
    ideiasRes,
    pagesRes,
    kbRes,
  ] = results;
  // O spinner só espera os dados do workspace; o grupo Ajuda entra quando o
  // índice chegar, sem atrasar o resto.
  const workspaceResults = results.slice(0, 8);
  const isLoading = workspaceResults.some((r) => r.isLoading);

  const clientes = clientesRes.data ?? [];
  // Guard the result too, not just the query: `enabled: false` only stops a new
  // fetch — a query with the same key already populated elsewhere (e.g. the
  // Financeiro or Contratos pages) can still leave cached data on this hook.
  const contratos = financialsAllowed ? (contratosRes.data ?? []) : [];
  const membros = membrosRes.data ?? [];
  const transacoes = financialsAllowed ? (transacoesRes.data ?? []) : [];
  const workflows = workflowsRes.data ?? [];
  const posts = postsRes.data ?? [];
  const ideias = ideiasRes.data ?? [];
  const pages = pagesRes.data ?? [];
  const kbArticles = kbRes.data ?? [];

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
    onOpenChange(false);
    navigate(route);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
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
                {clientes.map((c) => (
                  <CommandItem
                    key={`cliente-${c.id}`}
                    value={`cliente ${c.nome} ${c.email} ${c.sigla}`}
                    onSelect={() => go(`/clientes/${c.id}`)}
                  >
                    <Users className="h-4 w-4 shrink-0" />
                    <span className="truncate">{c.nome}</span>
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {c.email}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {contratos.length > 0 && (
              <CommandGroup heading="Contratos">
                {contratos.map((c) => (
                  <CommandItem
                    key={`contrato-${c.id}`}
                    value={`contrato ${c.titulo} ${c.cliente_nome}`}
                    onSelect={() => go('/contratos')}
                  >
                    <FileText className="h-4 w-4 shrink-0" />
                    <span className="truncate">{c.titulo}</span>
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {c.cliente_nome}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {membros.length > 0 && (
              <CommandGroup heading="Equipe">
                {membros.map((m) => (
                  <CommandItem
                    key={`membro-${m.id}`}
                    value={`equipe ${m.nome} ${m.cargo}`}
                    onSelect={() => go(`/equipe/${m.id}`)}
                  >
                    <UserRound className="h-4 w-4 shrink-0" />
                    <span className="truncate">{m.nome}</span>
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {m.cargo}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {transacoes.length > 0 && (
              <CommandGroup heading="Financeiro">
                {transacoes.map((tx) => (
                  <CommandItem
                    key={`transacao-${tx.id}`}
                    value={`financeiro ${tx.descricao} ${tx.categoria} ${tx.detalhe}`}
                    onSelect={() => go('/financeiro')}
                  >
                    <Wallet className="h-4 w-4 shrink-0" />
                    <span className="truncate">{tx.descricao}</span>
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {tx.categoria}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {workflows.length > 0 && (
              <CommandGroup heading="Workflows">
                {workflows.map((w) => (
                  <CommandItem
                    key={`workflow-${w.id}`}
                    value={`workflow ${w.titulo}`}
                    onSelect={() => go(`/entregas?drawer=${w.id}`)}
                  >
                    <Kanban className="h-4 w-4 shrink-0" />
                    <span className="truncate">{w.titulo}</span>
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {w.status}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {posts.length > 0 && (
              <CommandGroup heading="Postagens">
                {posts.map((p) => (
                  <CommandItem
                    key={`post-${p.id}`}
                    value={`postagem ${p.titulo} ${p.workflow_id != null ? (workflowMap.get(p.workflow_id) ?? '') : ''}`}
                    onSelect={() => go(postHref(p))}
                  >
                    <Image className="h-4 w-4 shrink-0" />
                    <span className="truncate">{p.titulo}</span>
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {p.workflow_id != null ? p.tipo : `${p.tipo} · Avulso`}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {ideias.length > 0 && (
              <CommandGroup heading="Ideias">
                {ideias.map((idea) => (
                  <CommandItem
                    key={`ideia-${idea.id}`}
                    value={`ideia ${idea.titulo} ${idea.clientes?.nome ?? ''}`}
                    onSelect={() => go('/ideias')}
                  >
                    <Lightbulb className="h-4 w-4 shrink-0" />
                    <span className="truncate">{idea.titulo}</span>
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {idea.clientes?.nome}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {pages.length > 0 && (
              <CommandGroup heading="Páginas">
                {pages.map((pg) => (
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

            <KbSearchGroup articles={kbArticles} onNavigate={go} />
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
