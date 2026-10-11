import { useRef, useState } from 'react';
import {
  Archive,
  BarChart2,
  Calendar,
  Columns,
  List,
  ListChecks,
  MoreHorizontal,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SAVED_VIEW_NAME_MAX, type EntregasSavedView } from '@/store/savedViews';
import { useSavedViewSelection } from '../hooks/useSavedViewSelection';
import { parseEntregasQuery, type ActiveView } from '../viewQuery';

const VIEW_ICONS: Record<ActiveView, React.ReactNode> = {
  kanban: <Columns className="h-3.5 w-3.5" />,
  chart: <BarChart2 className="h-3.5 w-3.5" />,
  calendar: <Calendar className="h-3.5 w-3.5" />,
  list: <List className="h-3.5 w-3.5" />,
  concluded: <Archive className="h-3.5 w-3.5" />,
  fila: <ListChecks className="h-3.5 w-3.5" />,
};

function viewIcon(query: string): React.ReactNode {
  return VIEW_ICONS[parseEntregasQuery(new URLSearchParams(query)).view];
}

interface VistasTabsProps {
  contaId: string;
  /** Serialized query of what is on screen right now. */
  currentQuery: string;
  onApply: (query: string) => void;
  /** Right-aligned slot on the same row (the Entregas search input). */
  trailing?: React.ReactNode;
}

/**
 * Notion-style saved-views row: "Padrão" (the free, unsaved state) plus each
 * saved vista as an always-visible tab. A vista is a name + the same serialized
 * query string the URL carries. Stored on the server per user and workspace
 * (useSavedViews), with this browser's old localStorage list imported once.
 */
export function VistasTabs({ contaId, currentQuery, onApply, trailing }: VistasTabsProps) {
  const {
    views,
    isLoading,
    activeId,
    modified,
    choose,
    saveNew: saveVista,
    updateWithCurrent,
    removeVista,
    renameVista,
  } = useSavedViewSelection(contaId, currentQuery);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  // Enter commits and unmounts the input, which can also fire its blur: the ref
  // makes the second commit a no-op instead of a second rename request.
  const renamingRef = useRef<string | null>(null);

  const saveNew = async () => {
    if (!newName.trim() || isLoading || saving) return;
    setSaving(true);
    try {
      if (await saveVista(newName)) {
        setNewName('');
        setAddOpen(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const startRename = (v: EntregasSavedView) => {
    setRenameDraft(v.name);
    renamingRef.current = v.id;
    setRenaming(v.id);
  };

  const cancelRename = () => {
    renamingRef.current = null;
    setRenaming(null);
  };

  const commitRename = async () => {
    const fromId = renamingRef.current;
    renamingRef.current = null;
    setRenaming(null);
    if (fromId != null) await renameVista(fromId, renameDraft);
  };

  return (
    <div className="vista-tabs no-scrollbar animate-up">
      <button
        type="button"
        className={`vista-tab ${activeId == null ? 'vista-tab--active' : ''}`}
        onClick={() => {
          choose(null);
          onApply('');
        }}
      >
        <span className="vista-tab-ico">{VIEW_ICONS.kanban}</span>
        Padrão
      </button>

      {isLoading && (
        // Placeholder for the saved tabs while the first list loads, so they
        // don't pop in next to an apparently empty row.
        <span
          className="vista-tab pointer-events-none"
          aria-hidden="true"
          data-testid="vista-tabs-loading"
        >
          <Skeleton className="h-3.5 w-24" />
        </span>
      )}

      {views.map((v) => {
        const isActive = v.id === activeId;
        return (
          <span key={v.id} className={`vista-tab ${isActive ? 'vista-tab--active' : ''}`}>
            {renaming === v.id ? (
              <Input
                ref={renameInputRef}
                autoFocus
                value={renameDraft}
                maxLength={SAVED_VIEW_NAME_MAX}
                onChange={(e) => setRenameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitRename();
                  if (e.key === 'Escape') cancelRename();
                }}
                onBlur={() => void commitRename()}
                className="h-6 w-[140px] !text-xs mb-0 px-1.5"
              />
            ) : (
              <>
                <button
                  type="button"
                  className="vista-tab-main"
                  onClick={() => {
                    choose(v.id);
                    onApply(v.query);
                  }}
                >
                  <span className="vista-tab-ico">{viewIcon(v.query)}</span>
                  {v.name}
                  {isActive && modified && (
                    <span
                      className="vista-tab-dot"
                      title="Visualização modificada: use ⋯ para salvar as alterações"
                    />
                  )}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="vista-tab-more"
                      aria-label={`Opções da visualização ${v.name}`}
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-[190px]">
                    <DropdownMenuItem className="text-xs" onSelect={() => updateWithCurrent(v)}>
                      Atualizar com estado atual
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-xs" onSelect={() => startRename(v)}>
                      Renomear
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-xs text-[var(--danger-text)]"
                      onSelect={() => removeVista(v)}
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
            <Plus className="h-3.5 w-3.5" /> Nova visualização
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[260px] p-2">
          <p className="px-1 pb-2 text-[0.7rem] text-muted-foreground">
            Salva a exibição, o modo e os filtros atuais.
          </p>
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={newName}
              maxLength={SAVED_VIEW_NAME_MAX}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveNew();
              }}
              placeholder="Nome da visualização"
              className="h-8 flex-1 min-w-0 !text-xs mb-0 px-2"
            />
            <Button
              onClick={() => void saveNew()}
              disabled={!newName.trim() || isLoading || saving}
              className="h-8 px-3 text-xs mb-0"
              variant="outline"
            >
              Salvar
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {trailing != null && <span className="ml-auto shrink-0 pl-3 py-1">{trailing}</span>}
    </div>
  );
}
