import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { getWorkflowEvents } from '../../../store';
import { buildWorkflowTimeline } from './workflowTimeline';
import { WorkflowHistoryList } from './WorkflowHistoryView';

interface WorkflowTimelinePopoverProps {
  workflowId: number;
}

export function WorkflowTimelinePopover({ workflowId }: WorkflowTimelinePopoverProps) {
  const [open, setOpen] = useState(false);
  const { data: events } = useQuery({
    queryKey: ['workflow-events', workflowId],
    queryFn: () => getWorkflowEvents(workflowId),
    enabled: open,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="drawer-post-history-btn"
          title="Histórico do fluxo"
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
        <WorkflowHistoryList nodes={buildWorkflowTimeline(events ?? [])} />
      </PopoverContent>
    </Popover>
  );
}
