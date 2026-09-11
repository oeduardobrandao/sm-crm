import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, Ban, CircleDot } from 'lucide-react';
import { toast } from 'sonner';
import {
  getPostProcessEvents,
  updatePostProcessStep,
  type Membro,
  type PostProcess,
  type PostProcessStep,
} from '../../../store';
import { endOfLocalDay, parseLocalISODate, toLocalISODate } from '@/utils/postDate';
import { getPostProcessErrorToast, isStaleStateError } from '../postProcessErrors';
import { etapaDeadlineDateOf, formatEtapaDeadlineDay } from '../etapaPrazo';
import { forwardLabelFor } from '../postProcessCommands';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { buildPostTimeline } from './postTimeline';
import { PostTimelineList } from './PostTimelinePopover';

/** Sentinel para "sem responsável": Radix `SelectItem` (v2) rejeita
 *  `value=""`, então o `null` do modelo é representado por 'none' na UI
 *  (mesmo padrão de TarefaFormDialog.tsx) e traduzido de volta ao salvar. */
const NO_RESPONSAVEL = 'none';

const ESTADO_LABEL: Record<PostProcessStep['estado'], string> = {
  pendente: 'Pendente',
  ativo: 'Em andamento',
  concluido: 'Concluída',
  herdado: 'Herdada',
  ignorado: 'Ignorada',
  interrompido: 'Interrompida',
};

const PROCESS_LABEL: Record<PostProcess['estado'], string> = {
  ativo: 'Ativo',
  concluido: 'Concluído',
  encerrado: 'Encerrado',
};

function StepIcon({ estado }: { estado: PostProcessStep['estado'] }) {
  if (estado === 'concluido') return <Check className="h-3 w-3" />;
  if (estado === 'ativo') return <CircleDot className="h-3 w-3" />;
  if (estado === 'interrompido') return <Ban className="h-3 w-3" />;
  if (estado === 'pendente') return <Clock className="h-3 w-3" />;
  return null; // herdado / ignorado: só o círculo neutro
}

function toneFor(estado: PostProcessStep['estado']): string {
  if (estado === 'concluido') return 'approved';
  if (estado === 'interrompido') return 'failed';
  return 'neutral';
}

interface PostProductionSectionProps {
  process: PostProcess;
  postId: number;
  membros: Membro[];
  postStatus: string;
  onAvancar?: () => void;
}

/**
 * Seção de produção do post individual (spec §5.4): origem (template ou
 * fluxo de origem), linha de etapas com responsável e prazo por etapa,
 * estado do processo, nota sobre propriedades e o histórico filtrado ao
 * processo. Não existe stepper reutilizável (SortableEtapaList é
 * formulário); a linha usa o estilo history-timeline do PostTimelinePopover.
 * Sem ações no cabeçalho: Avançar/Voltar/Concluir/Reabrir/Remover/Aplicar/
 * Vincular são comandos aparte (fase 4). Enquanto o processo está 'ativo',
 * as etapas 'pendente'/'ativo' ganham editores inline de responsável e
 * prazo (`update_post_process_step`, Task 10); as demais (concluído,
 * herdada, ignorada, interrompida) e qualquer etapa de um processo não
 * ativo continuam só leitura. Só é montada pelo drawer de post avulso
 * (workflowId nulo) e só busca eventos enquanto está aberta.
 */
export function PostProductionSection({
  process,
  postId,
  membros,
  postStatus,
  onAvancar,
}: PostProductionSectionProps) {
  const qc = useQueryClient();
  const { data: events = [] } = useQuery({
    queryKey: ['post-process-events', String(postId)],
    queryFn: () => getPostProcessEvents([postId]),
  });
  const [draft, setDraft] = useState<
    Record<number, { responsavelId: number | null; prazo: string }>
  >({});
  const [savingOrdem, setSavingOrdem] = useState<number | null>(null);

  // O revisão do processo muda a cada `update_post_process_step` bem-sucedido
  // (e a qualquer outro comando que avance/reabra a etapa); ao refetch, o
  // valor do servidor deve vencer sobre qualquer rascunho local pendente.
  useEffect(() => {
    setDraft({});
  }, [process.revisao]);

  const editable = (step: PostProcessStep) =>
    process.estado === 'ativo' && (step.estado === 'pendente' || step.estado === 'ativo');

  const valueOf = (step: PostProcessStep) =>
    draft[step.ordem] ?? {
      responsavelId: step.responsavel_id,
      prazo: step.prazo_efetivo ? toLocalISODate(new Date(step.prazo_efetivo)) : '',
    };

  const save = async (
    step: PostProcessStep,
    next: { responsavelId: number | null; prazo: string },
  ) => {
    setDraft((d) => ({ ...d, [step.ordem]: next }));
    setSavingOrdem(step.ordem);
    try {
      const day = next.prazo ? parseLocalISODate(next.prazo) : null;
      await updatePostProcessStep({
        processId: process.id,
        expectedRevisao: process.revisao,
        ordem: step.ordem,
        responsavelId: next.responsavelId,
        prazoEfetivo: day ? endOfLocalDay(day).toISOString() : null,
      });
      qc.invalidateQueries({ queryKey: ['post-process', postId] });
      qc.invalidateQueries({ queryKey: ['post-processes'] });
      qc.invalidateQueries({ queryKey: ['post-process-events'] });
    } catch (err) {
      setDraft((d) => {
        const { [step.ordem]: _drop, ...rest } = d;
        return rest;
      }); // revert to server value
      toast.error(getPostProcessErrorToast(err, 'Erro ao editar etapa'));
      if (isStaleStateError(err)) qc.invalidateQueries({ queryKey: ['post-process', postId] });
    } finally {
      setSavingOrdem(null);
    }
  };

  const origem = process.origem_descricao
    ? `Desmembrado de ${process.origem_descricao}`
    : process.template_nome
      ? `Template: ${process.template_nome}`
      : 'Processo individual';
  const processEvents = events.filter((e) => e.process_id === process.id);
  const nodes = buildPostTimeline({ created_at: undefined }, [], [], processEvents).filter(
    (n) => n.kind === 'process',
  );

  return (
    <section className="post-production" aria-labelledby="post-production-title">
      <div className="post-production-head">
        <h4 id="post-production-title" className="post-production-title">
          Produção
        </h4>
        <span className={`post-production-state post-production-state--${process.estado}`}>
          {PROCESS_LABEL[process.estado]}
        </span>
      </div>
      <p className="post-production-origem">{origem}</p>

      {process.estado === 'ativo' &&
        postStatus === 'aprovado_cliente' &&
        process.steps.find((s) => s.estado === 'ativo')?.tipo === 'aprovacao_cliente' && (
          <div className="post-production-hint" role="status">
            <span>Cliente aprovou. Avançar etapa?</span>
            {onAvancar && (
              <button type="button" className="sem-processo-link" onClick={onAvancar}>
                {forwardLabelFor(process)}
              </button>
            )}
          </div>
        )}

      <div className="history-timeline">
        {process.steps.map((step, i) => {
          const responsavel =
            step.responsavel_id != null
              ? membros.find((m) => m.id === step.responsavel_id)
              : undefined;
          const prazo = etapaDeadlineDateOf(step);
          const tone = toneFor(step.estado);
          const stepEditable = editable(step);
          const v = valueOf(step);
          return (
            <div key={step.id} className="history-step">
              <div className="history-step-track">
                <div className={`history-step-icon history-step-icon--${tone}`}>
                  <StepIcon estado={step.estado} />
                </div>
                {i < process.steps.length - 1 && (
                  <div className={`history-step-line history-step-line--${tone}`} />
                )}
              </div>
              <div className="history-step-body">
                <div className="history-step-name">
                  {step.nome}
                  {step.tipo === 'aprovacao_cliente' && (
                    <span className="post-production-tipo"> · Aprovação do cliente</span>
                  )}
                </div>
                {stepEditable ? (
                  <>
                    <div className="history-step-detail">
                      <span>{ESTADO_LABEL[step.estado]}</span>
                    </div>
                    <div className="post-production-step-edit">
                      <Select
                        value={v.responsavelId != null ? String(v.responsavelId) : NO_RESPONSAVEL}
                        onValueChange={(val) =>
                          save(step, {
                            ...v,
                            responsavelId: val === NO_RESPONSAVEL ? null : Number(val),
                          })
                        }
                        disabled={savingOrdem === step.ordem}
                      >
                        <SelectTrigger
                          aria-label={`Responsável da etapa ${step.nome}`}
                          className="h-7 text-xs"
                        >
                          <SelectValue placeholder="Sem responsável" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_RESPONSAVEL}>Sem responsável</SelectItem>
                          {membros.map((m) => (
                            <SelectItem key={m.id} value={String(m.id)}>
                              {m.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <input
                        type="date"
                        aria-label={`Prazo da etapa ${step.nome}`}
                        className="h-7 text-xs rounded-md border border-input px-2"
                        value={v.prazo}
                        disabled={savingOrdem === step.ordem}
                        onChange={(e) => save(step, { ...v, prazo: e.target.value })}
                      />
                    </div>
                  </>
                ) : (
                  <div className="history-step-detail">
                    <span>{ESTADO_LABEL[step.estado]}</span>
                    {' · '}
                    <span>{responsavel ? responsavel.nome : 'Sem responsável'}</span>
                    {' · '}
                    <span>{prazo ? formatEtapaDeadlineDay(prazo) : 'Sem prazo'}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {process.template_id != null && (
        <p className="post-production-note">Propriedades do template só valem dentro de um fluxo</p>
      )}

      {nodes.length > 0 && (
        <div className="post-production-history">
          <div className="post-timeline-title">Histórico do processo</div>
          <PostTimelineList nodes={nodes} />
        </div>
      )}
    </section>
  );
}
