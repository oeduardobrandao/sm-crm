import { PauseCircle } from 'lucide-react';

/**
 * What a Hub link shows while the agency's workspace is paused (403 `hub_paused` from
 * hub-bootstrap, after the reverse trial). It renders with no bootstrap, so only the Hub's
 * fallback tokens and fonts apply (no agency branding). The copy never mentions plans or
 * payment: the client did nothing wrong and the agency decides when the portal comes back.
 * pt-BR only for now, like the rest of the copy the spec fixed for this page.
 */
export function PortalPausado({ agencyName }: { agencyName: string | null }) {
  const agency = agencyName?.trim() ? agencyName.trim() : 'a agência';
  return (
    <div className="hub-root hub-noise min-h-screen flex items-center justify-center px-5 py-12">
      <main className="hub-card w-full max-w-md px-6 py-10 sm:px-10 flex flex-col items-center gap-4 text-center">
        <PauseCircle aria-hidden="true" className="h-10 w-10 hub-tx3" strokeWidth={1.5} />
        <h1 className="font-display text-[26px] leading-tight font-medium hub-txt">
          Este portal está pausado
        </h1>
        <p className="text-[15px] leading-relaxed hub-tx2">
          Fale com {agency} para voltar a acessar suas aprovações, posts e materiais.
        </p>
        <p className="text-[13px] leading-relaxed hub-tx3">
          Nada foi perdido. Quando a agência reativar o portal, este mesmo link volta a funcionar.
        </p>
      </main>
    </div>
  );
}
