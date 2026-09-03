import { useCommandState } from 'cmdk';
import { BookOpen, ArrowRight } from 'lucide-react';
import { CommandGroup, CommandItem } from '@/components/ui/command';
import { CATEGORY_LABELS } from '@/pages/ajuda/categoryConfig';
import type { KbSearchEntry } from '@/store/kb';
import { filterKbArticles, normalize } from './kbSearch';

interface KbSearchGroupProps {
  articles: KbSearchEntry[];
  onNavigate: (route: string) => void;
}

/**
 * Grupo "Ajuda" do palette. Só aparece com texto digitado e com match em
 * título/resumo/tags; corta em KB_SEARCH_LIMIT e oferece "Ver todos em Ajuda"
 * quando sobra. Precisa ser filho de <Command> por causa do useCommandState.
 *
 * O cmdk aplica o próprio filtro fuzzy em cima do `value`; os `keywords`
 * normalizados garantem que um item aprovado aqui não seja escondido por ele
 * (ex.: query "automacao" contra título "Automações"). Não usar forceMount:
 * itens forçados não contam no filtered.count e o CommandEmpty apareceria
 * junto dos artigos.
 */
export default function KbSearchGroup({ articles, onNavigate }: KbSearchGroupProps) {
  const search = useCommandState((state) => state.search);
  const { items, total } = filterKbArticles(articles, search);
  if (items.length === 0) return null;

  const remaining = total - items.length;
  const term = search.trim();

  return (
    <CommandGroup heading="Ajuda">
      {items.map((a) => (
        <CommandItem
          key={`kb-${a.id}`}
          value={`ajuda ${a.title}`}
          keywords={[normalize(a.title), normalize(a.excerpt ?? ''), ...a.tags.map(normalize)]}
          onSelect={() => onNavigate(`/ajuda/${a.slug}`)}
        >
          <BookOpen className="h-4 w-4 shrink-0" />
          <span className="truncate">{a.title}</span>
          <span className="ml-auto truncate text-xs text-muted-foreground">
            {CATEGORY_LABELS[a.category] ?? a.category}
          </span>
        </CommandItem>
      ))}
      {remaining > 0 && (
        <CommandItem
          key="kb-ver-todos"
          value={`ajuda ver todos ${term}`}
          keywords={[normalize(term)]}
          onSelect={() => onNavigate(`/ajuda?q=${encodeURIComponent(term)}`)}
        >
          <ArrowRight className="h-4 w-4 shrink-0" />
          <span className="truncate">Ver todos em Ajuda</span>
          <span className="ml-auto truncate text-xs text-muted-foreground">+{remaining}</span>
        </CommandItem>
      )}
    </CommandGroup>
  );
}
