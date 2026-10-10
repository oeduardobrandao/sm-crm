import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Tooltip de um botão só-ícone (Tipo, Destinos). O gatilho é um span em volta do
 * botão: botão desabilitado não recebe hover (o CSS tira os pointer events dele),
 * então o span é quem abre o tooltip e mostra o motivo do bloqueio. Precisa de um
 * TooltipProvider acima.
 */
export function IconTip({
  label,
  reason,
  children,
}: {
  label: string;
  reason?: string | null;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="icon-tip">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <span style={{ fontWeight: 600 }}>{label}</span>
        {reason && <span style={{ display: 'block', opacity: 0.75 }}>{reason}</span>}
      </TooltipContent>
    </Tooltip>
  );
}
