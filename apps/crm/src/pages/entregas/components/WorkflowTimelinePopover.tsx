import { useState } from 'react';
import { Clock } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { WorkflowHistoryView } from './WorkflowHistoryView';

interface WorkflowTimelinePopoverProps {
  workflowId: number;
}

export function WorkflowTimelinePopover({ workflowId }: WorkflowTimelinePopoverProps) {
  const [open, setOpen] = useState(false);

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
        {open && <WorkflowHistoryView workflowId={workflowId} />}
      </PopoverContent>
    </Popover>
  );
}
