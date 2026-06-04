import React from 'react';
import { HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface HelpTooltipProps {
  children?: React.ReactNode;
  content: React.ReactNode;
}

export function HelpTooltip({ children, content }: HelpTooltipProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {children ?? (
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-full w-5 h-5 text-stone-400 hover:text-stone-600 transition-colors"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          )}
        </TooltipTrigger>
        <TooltipContent sideOffset={6} style={{ maxWidth: 280 }}>
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
