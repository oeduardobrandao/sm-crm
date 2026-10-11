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
import { MensagensListPhone } from './phone/MensagensListPhone';
import { ConversationThreadPhone } from './phone/ConversationThreadPhone';
import { ThreadPhoneShell } from './phone/ThreadPhoneShell';

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

  function renderThreadSlot() {
    if (invalidId) return <ThreadNotFound />;
    if (clienteId == null) return <ThreadPlaceholder />;
    if (conversas.isLoading) return <ThreadLoading />;
    if (conversasHardError) {
      return <ThreadLoadError onRetry={() => conversas.refetch()} />;
    }
    const conversa = conversas.data?.find((c) => c.cliente_id === clienteId);
    if (!conversa) return <ThreadNotFound />;
    return (
      <ConversationThread
        key={clienteId}
        conversa={conversa}
        feed={feed}
        sendGeneral={sendGeneral}
        replyToPost={replyToPost}
        clientesById={clientesById}
      />
    );
  }

  // Phones (below 768): the list is a root screen with the page header; a thread is a
  // pushed screen with its own nav bar and composer, and the tab bar hidden.
  if (!isDesktop) {
    if (clienteId == null && !invalidId) {
      return (
        <MensagensListPhone
          conversas={conversas.data ?? []}
          isLoading={conversas.isLoading}
          isError={conversasHardError}
          clientesById={clientesById}
          onSelect={goToConversa}
        />
      );
    }
    const conversa =
      clienteId != null ? conversas.data?.find((c) => c.cliente_id === clienteId) : undefined;
    if (conversa && !conversas.isLoading) {
      return (
        <ConversationThreadPhone
          key={clienteId}
          conversa={conversa}
          feed={feed}
          sendGeneral={sendGeneral}
          replyToPost={replyToPost}
          clientesById={clientesById}
        />
      );
    }
    return (
      <ThreadPhoneShell title="Mensagens">
        {invalidId ? (
          <ThreadNotFound />
        ) : conversas.isLoading ? (
          <ThreadLoading />
        ) : conversasHardError ? (
          <ThreadLoadError onRetry={() => conversas.refetch()} />
        ) : (
          <ThreadNotFound />
        )}
      </ThreadPhoneShell>
    );
  }

  return (
    <div className="page-full-bleed flex min-h-0">
      <ConversationList
        className="w-[340px] shrink-0 border-r border-[var(--border-color)]"
        conversas={conversas.data ?? []}
        isLoading={conversas.isLoading}
        isError={conversasHardError}
        selectedClienteId={clienteId}
        clientesById={clientesById}
        onSelect={goToConversa}
      />
      {renderThreadSlot()}
    </div>
  );
}
