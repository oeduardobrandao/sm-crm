import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays, Pencil, Plus, Trash2, User2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { avatarColorClass } from '@/lib/avatarColor';
import { MentionText } from '@/components/mentions/MentionText';
import {
  addSubtarefa,
  deleteSubtarefa,
  deleteTarefa,
  getInitials,
  getSubtarefas,
  toggleSubtarefa,
  updateTarefa,
  type Membro,
  type TarefaWithRelations,
} from '../../../store';
import { dueBadge, parseDateOnly, STATUS_LABELS, STATUS_ORDER } from '../tarefasLogic';
import { TagPill } from './TagPicker';

interface TarefaDetailSheetProps {
  tarefa: TarefaWithRelations;
  membros: Membro[];
  onClose: () => void;
  onEdit: () => void;
  onRefresh: () => void;
}

export function TarefaDetailSheet({
  tarefa,
  membros,
  onClose,
  onEdit,
  onRefresh,
}: TarefaDetailSheetProps) {
  const queryClient = useQueryClient();
  const [newSubtarefa, setNewSubtarefa] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const now = new Date();

  const { data: subtarefas = [] } = useQuery({
    queryKey: ['subtarefas', tarefa.id],
    queryFn: () => getSubtarefas(tarefa.id!),
  });

  const refreshSubtarefas = () => {
    queryClient.invalidateQueries({ queryKey: ['subtarefas', tarefa.id] });
    onRefresh(); // subtask counters on cards come from ['tarefas']
  };

  const membro = membros.find((m) => m.id === tarefa.responsavel_id) ?? null;
  const badge = dueBadge(tarefa, now);

  const handleStatusChange = async (status: TarefaWithRelations['status']) => {
    if (status === tarefa.status) return;
    try {
      await updateTarefa(tarefa.id!, { status });
      toast.success(status === 'concluida' ? 'Tarefa concluída!' : 'Status atualizado!');
      onRefresh();
    } catch {
      toast.error('Erro ao atualizar status');
    }
  };

  const handleAssign = async (responsavelId: number | null) => {
    try {
      await updateTarefa(tarefa.id!, { responsavel_id: responsavelId });
      toast.success('Responsável atualizado!');
      onRefresh();
    } catch {
      toast.error('Erro ao atualizar responsável');
    }
  };

  const handleAddSubtarefa = async () => {
    const titulo = newSubtarefa.trim();
    if (!titulo) return;
    try {
      await addSubtarefa({
        tarefa_id: tarefa.id!,
        titulo,
        concluida: false,
        ordem: subtarefas.length,
      });
      setNewSubtarefa('');
      refreshSubtarefas();
    } catch {
      toast.error('Erro ao adicionar subtarefa');
    }
  };

  const handleToggleSubtarefa = async (id: number, concluida: boolean) => {
    try {
      await toggleSubtarefa(id, concluida);
      refreshSubtarefas();
    } catch {
      toast.error('Erro ao atualizar subtarefa');
    }
  };

  const handleDeleteSubtarefa = async (id: number) => {
    try {
      await deleteSubtarefa(id);
      refreshSubtarefas();
    } catch {
      toast.error('Erro ao remover subtarefa');
    }
  };

  const handleDeleteTarefa = async () => {
    try {
      await deleteTarefa(tarefa.id!);
      toast.success('Tarefa excluída!');
      setConfirmDelete(false);
      onClose();
      onRefresh();
    } catch {
      toast.error('Erro ao excluir tarefa');
    }
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-[440px] overflow-y-auto">
        <SheetHeader className="mb-4 pr-8">
          <SheetTitle className="text-left leading-snug">{tarefa.titulo}</SheetTitle>
          <SheetDescription className="sr-only">Detalhes da tarefa</SheetDescription>
          {tarefa.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {tarefa.tags.map((tag) => (
                <TagPill key={tag.id} tag={tag} />
              ))}
            </div>
          )}
        </SheetHeader>

        <div className="flex flex-col gap-5">
          {/* Status segmented buttons */}
          <div className="flex gap-1.5">
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => handleStatusChange(s)}
                style={{
                  flex: 1,
                  padding: '0.4rem 0.5rem',
                  borderRadius: '8px',
                  fontSize: '0.72rem',
                  fontWeight: tarefa.status === s ? 700 : 400,
                  border:
                    tarefa.status === s
                      ? '1px solid var(--text-main)'
                      : '1px solid var(--border-color)',
                  background: tarefa.status === s ? 'var(--text-main)' : 'transparent',
                  color: tarefa.status === s ? 'var(--card-bg)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  transition: 'background 150ms ease-out, color 150ms ease-out',
                }}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>

          {/* Meta rows */}
          <div className="flex flex-col gap-2.5 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-xs w-24 shrink-0" style={{ color: 'var(--text-muted)' }}>
                Responsável
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="board-card-assignee board-card-assignee--clickable"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      padding: '0.25rem 0.5rem 0.25rem 0.25rem',
                      borderRadius: '10px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--card-bg)',
                      cursor: 'pointer',
                    }}
                  >
                    {membro ? (
                      <>
                        <span
                          className={`avatar ${avatarColorClass(membro.id ?? membro.nome)}`}
                          style={{ width: 20, height: 20, fontSize: '0.55rem', fontWeight: 800 }}
                        >
                          {getInitials(membro.nome)}
                        </span>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{membro.nome}</span>
                      </>
                    ) : (
                      <>
                        <span
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: '50%',
                            background: 'var(--surface-hover)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--text-muted)',
                          }}
                        >
                          <User2 className="h-3 w-3" />
                        </span>
                        <span
                          style={{
                            fontSize: '0.75rem',
                            color: 'var(--text-muted)',
                            fontStyle: 'italic',
                          }}
                        >
                          Sem responsável
                        </span>
                      </>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" style={{ minWidth: '180px' }}>
                  <DropdownMenuItem
                    onClick={() => handleAssign(null)}
                    className="text-xs italic"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Sem responsável
                  </DropdownMenuItem>
                  {membros
                    .filter((m) => m.id != null)
                    .map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        onClick={() => handleAssign(m.id!)}
                        className="flex items-center gap-2 text-xs cursor-pointer"
                      >
                        <span
                          className={`avatar ${avatarColorClass(m.id ?? m.nome)}`}
                          style={{ width: 16, height: 16, fontSize: '0.5rem' }}
                        >
                          {getInitials(m.nome)}
                        </span>
                        {m.nome}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs w-24 shrink-0" style={{ color: 'var(--text-muted)' }}>
                Prazo
              </span>
              <span className="inline-flex items-center gap-2 text-sm">
                <CalendarDays className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} />
                {tarefa.data_limite
                  ? parseDateOnly(tarefa.data_limite).toLocaleDateString('pt-BR')
                  : 'Sem prazo'}
                {badge && (
                  <span className={`board-card-deadline ${badge.className}`}>{badge.label}</span>
                )}
              </span>
            </div>

            {tarefa.cliente_nome && (
              <div className="flex items-center gap-2">
                <span className="text-xs w-24 shrink-0" style={{ color: 'var(--text-muted)' }}>
                  Cliente
                </span>
                <span className="text-sm">{tarefa.cliente_nome}</span>
              </div>
            )}
          </div>

          {tarefa.descricao && (
            <div>
              <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                Descrição
              </div>
              <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-main)' }}>
                <MentionText text={tarefa.descricao} />
              </p>
            </div>
          )}

          {/* Checklist */}
          <div>
            <div className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
              Subtarefas
              {subtarefas.length > 0 && (
                <span>
                  {' '}
                  · {subtarefas.filter((s) => s.concluida).length}/{subtarefas.length}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              {subtarefas.map((s) => (
                <div key={s.id} className="flex items-center gap-2 group">
                  <Checkbox
                    checked={s.concluida}
                    onCheckedChange={(checked) => handleToggleSubtarefa(s.id!, checked === true)}
                  />
                  <span
                    className="text-sm flex-1"
                    style={{
                      textDecoration: s.concluida ? 'line-through' : undefined,
                      color: s.concluida ? 'var(--text-muted)' : 'var(--text-main)',
                    }}
                  >
                    {s.titulo}
                  </span>
                  <button
                    type="button"
                    aria-label="Remover subtarefa"
                    onClick={() => handleDeleteSubtarefa(s.id!)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2 mt-1">
                <Input
                  placeholder="Nova subtarefa..."
                  value={newSubtarefa}
                  onChange={(e) => setNewSubtarefa(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddSubtarefa();
                    }
                  }}
                  className="h-8 !text-xs mb-0"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 px-2 shrink-0"
                  disabled={!newSubtarefa.trim()}
                  onClick={handleAddSubtarefa}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-[var(--border-color)]">
            <Button type="button" variant="ink" size="sm" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" /> Editar
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              style={{ color: 'var(--danger-text)' }}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Excluir
            </Button>
          </div>
        </div>

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir tarefa?</AlertDialogTitle>
              <AlertDialogDescription>
                A tarefa &quot;{tarefa.titulo}&quot; e suas subtarefas serão excluídas. Essa ação
                não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
                onClick={handleDeleteTarefa}
              >
                Excluir tarefa
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
