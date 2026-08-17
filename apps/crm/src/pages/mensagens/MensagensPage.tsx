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
    if (conversas.isError) {
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
          isError={conversas.isError}
          selectedClienteId={clienteId}
          clientesById={clientesById}
          onSelect={goToConversa}
        />
      )}
      {showThread && renderThreadSlot()}
    </div>
  );
}
