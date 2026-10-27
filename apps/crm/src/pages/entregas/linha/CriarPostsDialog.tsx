import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { trackUnsavedWork } from '@mesaas/app-lifecycle';
import type { ContentFormat } from '@mesaas/platforms';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { entitlementMessage, mapEntitlementError } from '@/lib/entitlement-errors';
import {
  converterItens,
  linhaPostsKey,
  type LinhaColuna,
  type LinhaEditorial,
  type LinhaItem,
} from '@/store/linhaEditorial';
import { applyPostProcess } from '@/store/postProcesses';
import { getWorkflowTemplates, type WorkflowTemplate } from '@/store/workflows';
import { buildApplyPlan } from '../applyProcessDeadlines';
import { buildTemplateFingerprint } from '../fingerprint';
import { TIPO_LABELS } from '../postLabels';
import { buildPostsFromItens } from './buildPostsFromItens';
import { formatBreakdown } from './linhaLogic';
import { linhaItensKey, linhasKey } from './useLinhaQueries';

type Modo = 'sem' | 'por_formato';

/** Select value for "no template for this format" (Radix items cannot use ''). */
const NENHUM = 'nenhum';

const posts = (n: number) => `${n} ${n === 1 ? 'post' : 'posts'}`;
const criados = (n: number) => `${posts(n)} ${n === 1 ? 'criado' : 'criados'}`;

export interface CriarPostsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linha: LinhaEditorial;
  /** The selected, unconverted rows. */
  itens: LinhaItem[];
  colunas: LinhaColuna[];
  /** After the posts exist (clears the selection). */
  onDone: () => void;
  /** The toast's "Ver posts": the Lista in Publicações mode, filtered by the client. */
  onVerPosts?: (clienteId: number) => void;
}

/**
 * "Criar posts individuais" (spec 7.2): the selected rows become avulso posts through
 * `linha_editorial_converter`, then, with `feature_post_processes`, each one optionally gets
 * its format's process template, one at a time. A process that fails leaves its post created
 * without a process.
 */
export function CriarPostsDialog({
  open,
  onOpenChange,
  linha,
  itens,
  colunas,
  onDone,
  onVerPosts,
}: CriarPostsDialogProps) {
  const qc = useQueryClient();
  const { features } = useWorkspaceLimits();
  const processosOn = features?.feature_post_processes === true;

  const [modo, setModo] = useState<Modo>('sem');
  const [porTipo, setPorTipo] = useState<Partial<Record<ContentFormat, number>>>({});
  const [busy, setBusy] = useState(false);
  const [progresso, setProgresso] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setModo('sem');
    setPorTipo({});
    setProgresso(null);
  }, [open]);

  const { data: templates = [] } = useQuery({
    queryKey: ['workflow-templates'],
    queryFn: getWorkflowTemplates,
    enabled: open && processosOn,
  });
  // Only templates that apply without the manual dialog (as NewAvulsoDialog: a missing
  // modo_prazo counts as padrao).
  const padrao = useMemo(
    () => templates.filter((t) => (t.modo_prazo ?? 'padrao') === 'padrao' && t.id != null),
    [templates],
  );
  const tipos = useMemo(() => formatBreakdown(itens).map((b) => b.tipo), [itens]);
  const n = itens.length;

  const templateDe = (tipo: ContentFormat | undefined): WorkflowTemplate | null => {
    if (!processosOn || modo !== 'por_formato' || !tipo) return null;
    const id = porTipo[tipo];
    return id == null ? null : (padrao.find((t) => t.id === id) ?? null);
  };

  const criar = async () => {
    let feitos: { item_id: string; post_id: number }[];
    try {
      feitos = await converterItens(linha.id, null, buildPostsFromItens(itens, colunas, null));
    } catch (err) {
      const ent = mapEntitlementError(err);
      toast.error(
        ent ? entitlementMessage(ent) : 'Não foi possível criar os posts. Tente de novo.',
      );
      return;
    }

    for (const key of [
      linhaItensKey(linha.id),
      linhaPostsKey(linha.id),
      ['linha-origem'],
      linhasKey(linha.periodo),
      ['active-posts'],
    ])
      void qc.invalidateQueries({ queryKey: key });

    const tipoDe = new Map(itens.map((i) => [i.id, i.tipo]));
    const fila = feitos.flatMap((f) => {
      const template = templateDe(tipoDe.get(f.item_id));
      return template ? [{ postId: f.post_id, template }] : [];
    });
    let falhas = 0;
    for (const [idx, { postId, template }] of fila.entries()) {
      setProgresso(`Aplicando processo ${idx + 1} de ${fila.length}`);
      try {
        const plan = buildApplyPlan({
          template,
          startOrdem: 0,
          now: new Date(),
          fixedDates: {},
          deliveryDate: null,
          clienteHasDiaEntrega: false,
          responsaveis: {},
        });
        await applyPostProcess({
          postId,
          templateId: template.id!,
          templateFingerprint: buildTemplateFingerprint(template.etapas),
          startOrdem: 0,
          stepOverrides: plan.overrides,
        });
      } catch {
        // template_changed included: the post stays created, without a process.
        falhas++;
      }
    }
    if (fila.length > 0) {
      for (const key of [['post-processes'], ['post-process-events'], ['active-posts']])
        void qc.invalidateQueries({ queryKey: key });
    }

    // "Ver posts" opens the Lista in Publicações mode, which lists posts with or without a
    // process (the posts entity lists only processes, so "Sem processo" would land empty).
    const action = onVerPosts
      ? { label: 'Ver posts', onClick: () => onVerPosts(linha.cliente_id) }
      : undefined;
    if (falhas > 0) {
      toast.warning(`${criados(feitos.length)}. ${falhas} sem processo: aplique pelo post.`, {
        action,
      });
    } else {
      toast.success(criados(feitos.length), { action });
    }
    onDone();
    onOpenChange(false);
  };

  const submit = async () => {
    setBusy(true);
    try {
      await trackUnsavedWork(criar());
    } finally {
      setBusy(false);
      setProgresso(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o || !busy) && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>
            Criar {n} {n === 1 ? 'post individual' : 'posts individuais'}
          </DialogTitle>
          <DialogDescription>
            Cada linha vira um post avulso, fora de um fluxo, com a data e o conteúdo da linha.
          </DialogDescription>
        </DialogHeader>

        {processosOn && (
          <fieldset className="flex flex-col gap-2" disabled={busy}>
            <legend className="mb-1 text-sm font-semibold">Processo de produção</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="linha-processo"
                checked={modo === 'sem'}
                onChange={() => setModo('sem')}
              />
              Sem processo
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="linha-processo"
                checked={modo === 'por_formato'}
                onChange={() => setModo('por_formato')}
              />
              Um processo por formato
            </label>
            {modo === 'por_formato' && (
              <div className="ml-6 flex flex-col gap-2">
                {tipos.map((tipo) => (
                  <div key={tipo} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-sm">{TIPO_LABELS[tipo]}</span>
                    <Select
                      value={porTipo[tipo] != null ? String(porTipo[tipo]) : NENHUM}
                      onValueChange={(v) =>
                        setPorTipo((p) => ({ ...p, [tipo]: v === NENHUM ? undefined : Number(v) }))
                      }
                    >
                      <SelectTrigger aria-label={`Processo para ${TIPO_LABELS[tipo]}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NENHUM}>Nenhum</SelectItem>
                        {padrao.map((t) => (
                          <SelectItem key={t.id} value={String(t.id)}>
                            {t.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                {padrao.length === 0 && (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Nenhum modelo com prazos padrão. Aplique o processo depois, pelo post.
                  </p>
                )}
              </div>
            )}
          </fieldset>
        )}

        {progresso && (
          <p role="status" className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {progresso}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancelar
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={busy || n === 0}>
            {busy ? 'Criando...' : `Criar ${posts(n)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
