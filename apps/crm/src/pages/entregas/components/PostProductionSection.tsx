import { useQuery } from '@tanstack/react-query';
import { Check, Clock, Ban, CircleDot } from 'lucide-react';
import {
  getPostProcessEvents,
  type Membro,
  type PostProcess,
  type PostProcessStep,
} from '../../../store';
import { etapaDeadlineDateOf, formatEtapaDeadlineDay } from '../etapaPrazo';
import { buildPostTimeline } from './postTimeline';
import { PostTimelineList } from './PostTimelinePopover';

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
}

/**
 * Seção de produção do post individual (spec §5.4), só leitura na fase 3:
 * origem (template ou fluxo de origem), linha de etapas com responsável e
 * prazo por etapa, estado do processo, nota sobre propriedades e o histórico
 * filtrado ao processo. Não existe stepper reutilizável (SortableEtapaList é
 * formulário); a linha usa o estilo history-timeline do PostTimelinePopover.
 * Sem ações no cabeçalho: Avançar/Voltar/Concluir/Reabrir/Remover/Aplicar/
 * Vincular são fase 4. Só é montada pelo drawer de post avulso (workflowId
 * nulo) e só busca eventos enquanto está aberta.
 */
export function PostProductionSection({ process, postId, membros }: PostProductionSectionProps) {
  const { data: events = [] } = useQuery({
    queryKey: ['post-process-events', String(postId)],
    queryFn: () => getPostProcessEvents([postId]),
  });
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

      <div className="history-timeline">
        {process.steps.map((step, i) => {
          const responsavel =
            step.responsavel_id != null
              ? membros.find((m) => m.id === step.responsavel_id)
              : undefined;
          const prazo = etapaDeadlineDateOf(step);
          const tone = toneFor(step.estado);
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
                <div className="history-step-detail">
                  <span>{ESTADO_LABEL[step.estado]}</span>
                  {' · '}
                  <span>{responsavel ? responsavel.nome : 'Sem responsável'}</span>
                  {' · '}
                  <span>{prazo ? formatEtapaDeadlineDay(prazo) : 'Sem prazo'}</span>
                </div>
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
