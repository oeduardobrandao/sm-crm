import React from 'react';
import { HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { InfoButton } from '@/components/mobile/InfoButton';
import { useIsDesktop } from '@/hooks/useIsDesktop';

interface HelpTooltipProps {
  /** Desktop trigger. Phones always show the round help button instead. */
  children?: React.ReactNode;
  content: React.ReactNode;
  /** Title of the help sheet on phones. */
  title?: string;
}

export function HelpTooltip({ children, content, title = 'Ajuda' }: HelpTooltipProps) {
  const isDesktop = useIsDesktop(768);

  // Phones have no hover: the same content opens in a small sheet on tap (D29).
  if (!isDesktop) {
    return (
      <InfoButton
        title={title}
        label={title}
        content={content}
        icon={<HelpCircle aria-hidden="true" />}
      />
    );
  }

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
