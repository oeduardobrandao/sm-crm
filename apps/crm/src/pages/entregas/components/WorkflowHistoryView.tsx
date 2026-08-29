import { useQuery } from '@tanstack/react-query';
import {
  Plus,
  Play,
  Check,
  RotateCcw,
  Pencil,
  Flag,
  RefreshCw,
  Archive,
  ArrowRightLeft,
} from 'lucide-react';
import { getWorkflowEvents, type WorkflowEvent } from '../../../store';
import { buildWorkflowTimeline, type WorkflowTimelineNode } from './workflowTimeline';

function formatNodeDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function formatNodeDateFull(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const EVENT_TYPE_ICONS: Record<WorkflowEvent['event_type'], typeof Plus> = {
  criado: Plus,
  etapa_iniciada: Play,
  etapa_concluida: Check,
  etapa_revertida: RotateCcw,
  etapa_editada: Pencil,
  fluxo_editado: Pencil,
  fluxo_concluido: Flag,
  fluxo_reaberto: RefreshCw,
  fluxo_arquivado: Archive,
  template_migrado: ArrowRightLeft,
  template_propagado: RefreshCw,
};

function EventTypeIcon({ eventType }: { eventType: WorkflowEvent['event_type'] }) {
  // Forward-compat: an event_type the frontend doesn't yet know how to
  // iconify falls back to a generic icon rather than crashing (mirrors
  // labelFor's fallback in workflowTimeline.ts).
  const Icon = EVENT_TYPE_ICONS[eventType] ?? Pencil;
  return <Icon className="h-3 w-3" />;
}

export function WorkflowHistoryList({ nodes }: { nodes: WorkflowTimelineNode[] }) {
  return (
    <div className="history-timeline">
      {nodes.map((node, i) => (
        <div key={node.key} className="history-step">
          <div className="history-step-track">
            <div className={`history-step-icon history-step-icon--${node.tone}`}>
              <EventTypeIcon eventType={node.eventType} />
            </div>
            {i < nodes.length - 1 && (
              <div className={`history-step-line history-step-line--${node.tone}`} />
            )}
          </div>
          <div className="history-step-body">
            <div className="history-step-name">{node.label}</div>
            <div className="history-step-detail">
              <span className="post-timeline-actor">{node.actorLabel}</span>
              {' · '}
              <span title={formatNodeDateFull(node.at)}>{formatNodeDate(node.at)}</span>
              {node.detail && (
                <>
                  {' · '}
                  <span>{node.detail}</span>
                </>
              )}
            </div>
            {node.diffs.length > 0 && (
              <div className="workflow-event-diffs">
                {node.diffs.map((diff, diffIndex) => (
                  <div key={`${node.key}-diff-${diffIndex}`} className="workflow-event-diff">
                    {diff}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

interface WorkflowHistoryViewProps {
  workflowId: number;
}

export function WorkflowHistoryView({ workflowId }: WorkflowHistoryViewProps) {
  const { data: events, isLoading } = useQuery({
    queryKey: ['workflow-events', workflowId],
    queryFn: () => getWorkflowEvents(workflowId),
  });

  if (isLoading) {
    return <div className="workflow-history-empty">Carregando...</div>;
  }

  const nodes = buildWorkflowTimeline(events ?? []);

  if (nodes.length === 0) {
    return <div className="workflow-history-empty">Nenhum evento registrado ainda.</div>;
  }

  return <WorkflowHistoryList nodes={nodes} />;
}
