import { Clock, Check, RotateCcw, Send, AlertTriangle } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import type { WorkflowPost, PostApproval, PostStatusEvent } from '../../../store';
import { buildPostTimeline, type TimelineNode, type TimelineTone } from './postTimeline';

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

function ToneIcon({ tone }: { tone: TimelineTone }) {
  if (tone === 'approved') return <Check className="h-3 w-3" />;
  if (tone === 'correction') return <RotateCcw className="h-3 w-3" />;
  if (tone === 'published') return <Send className="h-3 w-3" />;
  if (tone === 'failed') return <AlertTriangle className="h-3 w-3" />;
  return null; // neutral: the gray circle itself is the marker
}

export function PostTimelineList({ nodes }: { nodes: TimelineNode[] }) {
  return (
    <div className="history-timeline">
      {nodes.map((node, i) => (
        <div key={node.key} className="history-step">
          <div className="history-step-track">
            <div className={`history-step-icon history-step-icon--${node.tone}`}>
              <ToneIcon tone={node.tone} />
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
            </div>
            {node.comment && <div className="post-timeline-comment">{node.comment}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

interface PostTimelinePopoverProps {
  post: Pick<WorkflowPost, 'created_at'>;
  events: PostStatusEvent[];
  approvals: PostApproval[];
}

export function PostTimelinePopover({ post, events, approvals }: PostTimelinePopoverProps) {
  const nodes = buildPostTimeline(post, events, approvals);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="drawer-post-history-btn"
          title="Histórico do post"
          onClick={(e) => e.stopPropagation()}
        >
          <Clock className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="post-timeline-popover"
        style={{ zIndex: 9999 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="post-timeline-title">Histórico</div>
        <PostTimelineList nodes={nodes} />
      </PopoverContent>
    </Popover>
  );
}
