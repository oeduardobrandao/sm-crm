import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Archive, BarChart2, Calendar, Columns, List, MoreHorizontal, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { loadSavedViews, persistSavedViews, type SavedView } from '../savedViews';
import { parseEntregasQuery, type ActiveView } from '../viewQuery';

const VIEW_ICONS: Record<ActiveView, React.ReactNode> = {
  kanban: <Columns className="h-3.5 w-3.5" />,
  chart: <BarChart2 className="h-3.5 w-3.5" />,
  calendar: <Calendar className="h-3.5 w-3.5" />,
  list: <List className="h-3.5 w-3.5" />,
  concluded: <Archive className="h-3.5 w-3.5" />,
};

function viewIcon(query: string): React.ReactNode {
  return VIEW_ICONS[parseEntregasQuery(new URLSearchParams(query)).view];
}

interface VistasTabsProps {
  contaId: string;
  /** Serialized query of what is on screen right now. */
  currentQuery: string;
  onApply: (query: string) => void;
}

/**
 * Notion-style saved-views row: "Padrão" (the free, unsaved state) plus each
 * saved vista as an always-visible tab. A vista is a name + the same serialized
 * query string the URL carries. Local per-conta/per-device storage.
 */
export function VistasTabs({ contaId, currentQuery, onApply }: VistasTabsProps) {
  const [views, setViews] = useState<SavedView[]>(() => loadSavedViews(contaId));
  // The vista the user last applied (or that the shared URL matched at mount).
  const [activeName, setActiveName] = useState<string | null>(
    () => loadSavedViews(contaId).find((v) => v.query === currentQuery)?.name ?? null,
  );
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const activeVista = activeName != null ? views.find((v) => v.name === activeName) : undefined;
  // The applied vista no longer matches the screen — the user tweaked something.
  const modified = activeVista != null && activeVista.query !== currentQuery;

  const persist = (next: SavedView[]) => {
    setViews(next);
    persistSavedViews(contaId, next);
  };

  const saveNew = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    persist([...views.filter((v) => v.name !== trimmed), { name: trimmed, query: currentQuery }]);
    setActiveName(trimmed);
    setNewName('');
    setAddOpen(false);
    toast.success(`Vista "${trimmed}" salva!`);
  };

  const updateWithCurrent = (name: string) => {
    persist(views.map((v) => (v.name === name ? { ...v, query: currentQuery } : v)));
    setActiveName(name);
    toast.success(`Vista "${name}" atualizada!`);
  };

  const remove = (name: string) => {
    persist(views.filter((v) => v.name !== name));
    if (activeName === name) setActiveName(null);
  };

  const commitRename = () => {
    const from = renaming;
    const to = renameDraft.trim();
    setRenaming(null);
    if (!from || !to || to === from) return;
    persist(
      views
        // Renaming onto an existing name replaces it (same semantics as saveNew);
        // without this the list would hold two entries with the same name and
        // remove() — which filters by name — would delete both.
        .filter((v) => v.name !== to)
        .map((v) => (v.name === from ? { ...v, name: to } : v)),
    );
    if (activeName === from) setActiveName(to);
  };

  return (
    <div className="vista-tabs no-scrollbar animate-up">
      <button
        type="button"
        className={`vista-tab ${activeName == null ? 'vista-tab--active' : ''}`}
        onClick={() => {
          setActiveName(null);
          onApply('');
        }}
      >
        <span className="vista-tab-ico">{VIEW_ICONS.kanban}</span>
        Padrão
      </button>

      {views.map((v) => {
        const isActive = v.name === activeName;
        return (
          <span key={v.name} className={`vista-tab ${isActive ? 'vista-tab--active' : ''}`}>
            {renaming === v.name ? (
              <Input
                ref={renameInputRef}
                autoFocus
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setRenaming(null);
                }}
                onBlur={commitRename}
                className="h-6 w-[140px] !text-xs mb-0 px-1.5"
              />
            ) : (
              <>
                <button
                  type="button"
                  className="vista-tab-main"
                  onClick={() => {
                    setActiveName(v.name);
                    onApply(v.query);
                  }}
                >
                  <span className="vista-tab-ico">{viewIcon(v.query)}</span>
                  {v.name}
                  {isActive && modified && (
                    <span
                      className="vista-tab-dot"
                      title="Vista modificada — use ⋯ para salvar as alterações"
                    />
                  )}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="vista-tab-more"
                      aria-label={`Opções da vista ${v.name}`}
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-[190px]">
                    <DropdownMenuItem
                      className="text-xs"
                      onSelect={() => updateWithCurrent(v.name)}
                    >
                      Atualizar com estado atual
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-xs"
                      onSelect={() => {
                        setRenameDraft(v.name);
                        setRenaming(v.name);
                      }}
                    >
                      Renomear
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-xs text-[var(--danger-text)]"
                      onSelect={() => remove(v.name)}
                    >
                      Excluir
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </span>
        );
      })}

      <Popover open={addOpen} onOpenChange={setAddOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="vista-tab vista-tab--add">
            <Plus className="h-3.5 w-3.5" /> Nova vista
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[260px] p-2">
          <p className="px-1 pb-2 text-[0.7rem] text-muted-foreground">
            Salva a visualização, o modo e os filtros atuais.
          </p>
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveNew();
              }}
              placeholder="Nome da vista"
              className="h-8 flex-1 min-w-0 !text-xs mb-0 px-2"
            />
            <Button
              onClick={saveNew}
              disabled={!newName.trim()}
              className="h-8 px-3 text-xs mb-0"
              variant="outline"
            >
              Salvar
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
