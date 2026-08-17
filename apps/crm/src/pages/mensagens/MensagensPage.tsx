import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Cliente } from '@/store';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useMensagensData } from './hooks/useMensagensData';
import { ConversationList } from './components/ConversationList';
import { ConversationThread } from './components/ConversationThread';
import {
  ThreadLoadError,
  ThreadLoading,
  ThreadNotFound,
  ThreadPlaceholder,
} from './components/ThreadStatus';

export default function MensagensPage() {
  const { clienteId: clienteIdParam } = useParams();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();

  const hasParam = clienteIdParam != null;
  const parsedId = hasParam ? parseInt(clienteIdParam, 10) : NaN;
  const invalidId = hasParam && isNaN(parsedId);
  const clienteId = hasParam && !invalidId ? parsedId : null;

  const { feed, conversas, clientes, sendGeneral, replyToPost } = useMensagensData(clienteId);

  // A failed background refetch (e.g. window refocus, or the seen-marker's
  // post-mount invalidation) keeps `data` populated from the last successful
  // fetch — TanStack Query only clears it when the query has never
  // succeeded. Treat only the latter as a hard failure: a background blip
  // on top of good cached data should leave the list and any open thread
  // alone rather than tearing them down for a spurious error screen.
  const conversasHardError = conversas.isError && conversas.data == null;

  const clientesById = useMemo(() => {
    const map = new Map<number, Cliente>();
    for (const c of clientes.data ?? []) if (c.id != null) map.set(c.id, c);
    return map;
  }, [clientes.data]);

  function goToConversa(id: number) {
    navigate(`/mensagens/${id}`);
  }

  const onBack = !isDesktop ? () => navigate('/mensagens') : undefined;

  function renderThreadSlot() {
    if (invalidId) return <ThreadNotFound onBack={onBack} />;
    // Only reachable when isDesktop: on mobile with no id, showThread below
    // is false and the list fills the screen instead.
    if (clienteId == null) return <ThreadPlaceholder />;
    if (conversas.isLoading) return <ThreadLoading onBack={onBack} />;
    if (conversasHardError) {
      return <ThreadLoadError onRetry={() => conversas.refetch()} onBack={onBack} />;
    }
    const conversa = conversas.data?.find((c) => c.cliente_id === clienteId);
    if (!conversa) return <ThreadNotFound onBack={onBack} />;
    return (
      <ConversationThread
        key={clienteId}
        conversa={conversa}
        feed={feed}
        sendGeneral={sendGeneral}
        replyToPost={replyToPost}
        clientesById={clientesById}
        onBack={onBack}
      />
    );
  }

  const showList = isDesktop || (clienteId == null && !invalidId);
  const showThread = isDesktop || clienteId != null || invalidId;

  return (
    <div className="page-full-bleed flex min-h-0">
      {showList && (
        <ConversationList
          className={
            isDesktop ? 'w-[340px] shrink-0 border-r border-[var(--border-color)]' : 'flex-1'
          }
          conversas={conversas.data ?? []}
          isLoading={conversas.isLoading}
          isError={conversasHardError}
          selectedClienteId={clienteId}
          clientesById={clientesById}
          onSelect={goToConversa}
        />
      )}
      {showThread && renderThreadSlot()}
    </div>
  );
}
