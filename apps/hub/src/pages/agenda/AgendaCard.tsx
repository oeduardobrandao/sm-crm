import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { agendaIcsUrl, cancelarRemarcacao, responderAgenda } from '../../api';
import { invalidateHubAgenda, setHubAgendaItem } from '../../queries';
import type { HubAgendaItem } from '../../types';
import { AgendaCardView } from './AgendaCardView';
import { RemarcarDialog } from './RemarcarDialog';

export { localeDe, selo, textoQuando, type T } from './AgendaCardView';

interface AgendaCardProps {
  item: HubAgendaItem;
  token: string;
  /** Snapshot of "now" from the page, so every card agrees on past/future. */
  agora: number;
  highlighted?: boolean;
}

/** The Hub's card: `AgendaCardView` wired to hub-agenda and the Hub's query cache. */
export function AgendaCard({ item, token, agora, highlighted = false }: AgendaCardProps) {
  const qc = useQueryClient();
  const [remarcarAberto, setRemarcarAberto] = useState(false);

  // Moved, ended or already resolved: the view shows the message; reload what the client sees.
  const falha = () => void invalidateHubAgenda(qc, token);

  // useMutation (not a bare await) so queryClient.isMutating() holds the silent deploy swap.
  const responder = useMutation({
    mutationFn: (v: { resposta: 'sim' | 'nao'; inicioVisto: string }) =>
      responderAgenda(token, item.ocorrencia_id, v.resposta, v.inicioVisto),
    onSuccess: (r) => setHubAgendaItem(qc, token, r.item),
    onError: falha,
  });

  const cancelar = useMutation({
    mutationFn: (remarcacaoId: number) => cancelarRemarcacao(token, remarcacaoId),
    onSuccess: () => setHubAgendaItem(qc, token, { ...item, remarcacao: null }),
    onError: falha,
  });

  return (
    <>
      <AgendaCardView
        item={item}
        agora={agora}
        highlighted={highlighted}
        icsUrl={agendaIcsUrl(token, item.ocorrencia_id)}
        onResponder={async (resposta, inicioVisto) => {
          await responder.mutateAsync({ resposta, inicioVisto });
        }}
        onRemarcar={() => setRemarcarAberto(true)}
        onCancelarRemarcacao={async (id) => {
          await cancelar.mutateAsync(id);
        }}
      />
      {remarcarAberto && (
        <RemarcarDialog
          item={item}
          token={token}
          onClose={() => setRemarcarAberto(false)}
          onErro={() => void invalidateHubAgenda(qc, token)}
        />
      )}
    </>
  );
}
