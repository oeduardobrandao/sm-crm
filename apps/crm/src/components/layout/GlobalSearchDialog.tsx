import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import {
  Users,
  FileText,
  UserRound,
  Wallet,
  Kanban,
  Image,
  Lightbulb,
  LayoutGrid,
  BookOpen,
  ArrowRight,
  Layers,
  Loader2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { getClientes } from '@/store/clients';
import { getContratos, getTransacoes } from '@/store/finance';
import { getMembros } from '@/store/team';
import { getWorkflows } from '@/store/workflows';
import { getAllWorkflowPosts } from '@/store/posts';
import { getIdeias } from '@/store/ideias';
import { getAllHubPages } from '@/store/hub';
import { getKbSearchIndex } from '@/store/kb';
import { useAuth } from '@/context/AuthContext';
import {
  buildSearchItems,
  countByType,
  filterSearchItems,
  groupSearchItems,
  SEARCH_TYPE_LABELS,
  SEARCH_TYPE_ORDER,
  type SearchType,
} from './searchModel';

const TYPE_ICONS: Record<SearchType, ComponentType<{ className?: string }>> = {
  cliente: Users,
  contrato: FileText,
  membro: UserRound,
  transacao: Wallet,
  fluxo: Kanban,
  post: Image,
  ideia: Lightbulb,
  pagina: LayoutGrid,
  ajuda: BookOpen,
};

interface GlobalSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Corpo da busca global (⌘K). Montado pelo GlobalSearchTrigger no desktop e
 * pelo MobileNav no celular; quem abre/fecha é o pai.
 *
 * O filtro é nosso (substring sem acento, ver searchModel.ts), não o fuzzy
 * do cmdk: "como postar" não pode dar match em qualquer título que contenha
 * essas letras espalhadas. As pills abaixo do input restringem a um tipo;
 * em "Tudo" cada tipo mostra só uma prévia.
 */
export default function GlobalSearchDialog({ open, onOpenChange }: GlobalSearchDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { canSeeFinancials } = useAuth();
  const financialsAllowed = canSeeFinancials === true;

  const [query, setQuery] = useState('');
  const [activeType, setActiveType] = useState<SearchType | 'all'>('all');
  const inputRef = useRef<HTMLInputElement>(null);

  // Clicar numa pill não pode roubar o foco do input: setas e Enter seguem
  // navegando a lista, e o usuário continua digitando.
  const selectType = (type: SearchType | 'all') => {
    setActiveType(type);
    inputRef.current?.focus();
  };

  // Reabrir começa do zero: sem termo e sem pill.
  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveType('all');
    }
  }, [open]);

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

  // Guard the result too, not just the query: `enabled: false` only stops a new
  // fetch — a query with the same key already populated elsewhere (e.g. the
  // Financeiro or Contratos pages) can still leave cached data on this hook.
  const clientes = clientesRes.data;
  const contratos = financialsAllowed ? contratosRes.data : undefined;
  const membros = membrosRes.data;
  const transacoes = financialsAllowed ? transacoesRes.data : undefined;
  const workflows = workflowsRes.data;
  const posts = postsRes.data;
  const ideias = ideiasRes.data;
  const pages = pagesRes.data;
  const articles = kbRes.data;

  const items = useMemo(
    () =>
      buildSearchItems({
        clientes: clientes ?? [],
        contratos: contratos ?? [],
        membros: membros ?? [],
        transacoes: transacoes ?? [],
        workflows: workflows ?? [],
        posts: posts ?? [],
        ideias: ideias ?? [],
        pages: pages ?? [],
        articles: articles ?? [],
      }),
    [clientes, contratos, membros, transacoes, workflows, posts, ideias, pages, articles],
  );

  const matches = useMemo(() => filterSearchItems(items, query), [items, query]);
  const counts = useMemo(() => countByType(matches), [matches]);
  // Uma pill sem match (o termo mudou) cai de volta em "Tudo" sem estado extra.
  const effectiveType = activeType !== 'all' && counts[activeType] ? activeType : 'all';
  const groups = useMemo(() => groupSearchItems(matches, effectiveType), [matches, effectiveType]);

  const hasQuery = query.trim().length > 0;

  const go = (route: string) => {
    onOpenChange(false);
    navigate(route);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} commandProps={{ shouldFilter: false }}>
      <CommandInput
        ref={inputRef}
        placeholder={t('topbar.searchPlaceholder', 'Buscar...')}
        value={query}
        onValueChange={setQuery}
      />

      {hasQuery && matches.length > 0 && (
        <div
          role="group"
          aria-label="Filtrar por tipo"
          className="flex gap-1.5 overflow-x-auto border-b px-3 py-2 [scrollbar-width:none]"
        >
          <TypePill
            icon={Layers}
            label="Tudo"
            count={counts.total}
            active={effectiveType === 'all'}
            onClick={() => selectType('all')}
          />
          {SEARCH_TYPE_ORDER.filter((type) => counts[type]).map((type) => (
            <TypePill
              key={type}
              icon={TYPE_ICONS[type]}
              label={SEARCH_TYPE_LABELS[type]}
              count={counts[type] ?? 0}
              active={effectiveType === type}
              onClick={() => selectType(type)}
            />
          ))}
        </div>
      )}

      <CommandList>
        {isLoading ? (
          <div className="py-6 text-center">
            <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : !hasQuery ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Digite para buscar clientes, posts, fluxos, artigos de ajuda…
          </div>
        ) : matches.length === 0 ? (
          <div className="py-6 text-center text-sm">
            {t('topbar.noResults', 'Nenhum resultado.')}
          </div>
        ) : (
          groups.map((group) => {
            const Icon = TYPE_ICONS[group.type];
            return (
              <CommandGroup key={group.type} heading={SEARCH_TYPE_LABELS[group.type]}>
                {group.items.map((item) => (
                  <CommandItem key={item.key} value={item.key} onSelect={() => go(item.route)}>
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {item.meta}
                    </span>
                  </CommandItem>
                ))}
                {group.hiddenCount > 0 &&
                  (group.type === 'ajuda' ? (
                    // A Central de Ajuda também busca no corpo dos artigos; vale
                    // mais levar o termo para lá do que só ampliar a lista aqui.
                    <CommandItem
                      value="ajuda-ver-todos"
                      onSelect={() => go(`/ajuda?q=${encodeURIComponent(query.trim())}`)}
                    >
                      <ArrowRight className="h-4 w-4 shrink-0" />
                      <span className="truncate">Ver todos em Ajuda</span>
                      <span className="ml-auto truncate text-xs text-muted-foreground">
                        +{group.hiddenCount}
                      </span>
                    </CommandItem>
                  ) : (
                    <CommandItem
                      value={`${group.type}-ver-todos`}
                      onSelect={() => selectType(group.type)}
                    >
                      <ArrowRight className="h-4 w-4 shrink-0" />
                      <span className="truncate">
                        Ver todos em {SEARCH_TYPE_LABELS[group.type]}
                      </span>
                      <span className="ml-auto truncate text-xs text-muted-foreground">
                        +{group.hiddenCount}
                      </span>
                    </CommandItem>
                  ))}
              </CommandGroup>
            );
          })
        )}
      </CommandList>
    </CommandDialog>
  );
}

interface TypePillProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}

function TypePill({ icon: Icon, label, count, active, onClick }: TypePillProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition-colors',
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {label}
      <span className={cn('tabular-nums', active ? 'opacity-80' : 'opacity-70')}>{count}</span>
    </button>
  );
}
