// Modelos de relatório (spec 2026-09-25 §1): lista, cria, duplica, renomeia,
// define o padrão e exclui. Sem gate por configuracoes:editar: as policies de
// report_templates liberam o workspace inteiro (ver a spec, "Permissões").
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Lock, MoreHorizontal, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ReportLayout } from '@mesaas/report-blocks/types';
import {
  buildSystemDefaultLayout,
  createReportTemplate,
  deleteReportTemplate,
  listReportTemplates,
  setDefaultReportTemplate,
  SYSTEM_TEMPLATE_NAME,
  updateReportTemplate,
  type ReportTemplateRow,
} from '../../../services/reportTemplates';

const LIST_KEY = ['report-templates'] as const;
const detailKey = (id: string) => ['report-template', id] as const;
const GENERIC_ERROR = 'Não foi possível atualizar o modelo.';

function blockCount(n: number): string {
  return n === 1 ? '1 bloco' : `${n} blocos`;
}

const ROW_STYLE = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.75rem',
  padding: '0.65rem 0',
  borderBottom: '1px solid var(--border-color)',
} as const;

const META_STYLE = { fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' };

export function ReportTemplatesCard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: templates = [], isLoading } = useQuery({
    queryKey: LIST_KEY,
    queryFn: listReportTemplates,
  });
  const [renaming, setRenaming] = useState<ReportTemplateRow | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState<ReportTemplateRow | null>(null);

  useEffect(() => {
    if (renaming) setRenameValue(renaming.name);
  }, [renaming]);

  const create = useMutation({
    mutationFn: ({ name, layout }: { name: string; layout: ReportLayout }) =>
      createReportTemplate(name, layout),
    onSuccess: async (row) => {
      await qc.invalidateQueries({ queryKey: LIST_KEY });
      navigate(`/relatorios/modelos/${row.id}`);
    },
    onError: () => toast.error('Não foi possível criar o modelo.'),
  });

  const makeDefault = useMutation({
    mutationFn: (id: string) => setDefaultReportTemplate(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: LIST_KEY });
      toast.success('Modelo padrão atualizado.');
    },
    onError: () => toast.error(GENERIC_ERROR),
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateReportTemplate(id, { name }),
    onSuccess: async (_data, { id }) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: LIST_KEY }),
        // O editor lê o detalhe com staleTime: Infinity: sem isso ele
        // reabriria com o nome antigo.
        qc.invalidateQueries({ queryKey: detailKey(id) }),
      ]);
      setRenaming(null);
      toast.success('Modelo renomeado.');
    },
    onError: () => toast.error(GENERIC_ERROR),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteReportTemplate(id),
    onSuccess: async (_data, id) => {
      qc.removeQueries({ queryKey: detailKey(id) });
      await qc.invalidateQueries({ queryKey: LIST_KEY });
      setDeleting(null);
      toast.success('Modelo excluído.');
    },
    onError: () => toast.error('Não foi possível excluir o modelo.'),
  });

  const busy = create.isPending;

  return (
    <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h3 className="config-title">Modelos de relatório</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
            Layouts usados ao gerar relatórios. O padrão vem pré-selecionado.
          </p>
        </div>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => create.mutate({ name: 'Novo modelo', layout: buildSystemDefaultLayout() })}
        >
          <Plus className="h-3.5 w-3.5" /> Novo modelo
        </Button>
      </div>

      <div style={{ marginTop: '0.75rem' }}>
        <div data-template-row="system" style={ROW_STYLE}>
          <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            <Lock
              className="h-3.5 w-3.5"
              aria-hidden="true"
              style={{ color: 'var(--text-muted)', marginRight: '0.5rem' }}
            />
            <span>{SYSTEM_TEMPLATE_NAME}</span>
            <span style={META_STYLE}>embutido</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              create.mutate({
                name: `${SYSTEM_TEMPLATE_NAME} (cópia)`,
                layout: buildSystemDefaultLayout(),
              })
            }
          >
            <Copy className="h-3.5 w-3.5" /> Duplicar
          </Button>
        </div>

        {templates.map((t) => (
          <div key={t.id} data-template-row={t.id} style={ROW_STYLE}>
            <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
              <span>{t.name}</span>
              {t.is_default && (
                <span className="badge badge-neutral badge--sm" style={{ marginLeft: '0.5rem' }}>
                  padrão
                </span>
              )}
              <span style={META_STYLE}>{blockCount(t.layout.blocks.length)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/relatorios/modelos/${t.id}`)}
              >
                <Pencil className="h-3.5 w-3.5" /> Editar
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" aria-label={`Mais ações de ${t.name}`}>
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {!t.is_default && (
                    <DropdownMenuItem
                      disabled={makeDefault.isPending}
                      onSelect={() => makeDefault.mutate(t.id)}
                    >
                      Definir como padrão
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => setRenaming(t)}>Renomear</DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={busy}
                    onSelect={() => create.mutate({ name: `Cópia de ${t.name}`, layout: t.layout })}
                  >
                    Duplicar
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setDeleting(t)}>Excluir</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ))}

        {!isLoading && templates.length === 0 && (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.75rem 0 0' }}>
            Crie um modelo para reaproveitar a mesma estrutura em todos os relatórios.
          </p>
        )}
      </div>

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open && !rename.isPending) setRenaming(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renomear modelo</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rename-template-name">Nome do modelo</Label>
            <Input
              id="rename-template-name"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              Cancelar
            </Button>
            <Button
              disabled={rename.isPending || !renameValue.trim()}
              onClick={() =>
                renaming && rename.mutate({ id: renaming.id, name: renameValue.trim() })
              }
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir o modelo?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.name}. Relatórios já gerados com ele não mudam.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleting) remove.mutate(deleting.id);
              }}
            >
              Excluir modelo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
