import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { Cliente } from '@/store';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { useEquipeChatRealtime } from '@/hooks/useEquipeChatRealtime';
import { useMensagensData } from './hooks/useMensagensData';
import { useEquipeChatData } from './hooks/useEquipeChatData';
import { ConversationList } from './components/ConversationList';
import { ConversationThread } from './components/ConversationThread';
import { EquipeConversationList } from './components/EquipeConversationList';
import { EquipeThread } from './components/EquipeThread';
import { NovaConversaDialog } from './components/NovaConversaDialog';
import { EquipeDetalhesSheet } from './components/EquipeDetalhesSheet';
import {
  ThreadLoadError,
  ThreadLoading,
  ThreadNotFound,
  ThreadPlaceholder,
} from './components/ThreadStatus';

type MensagensTab = 'clientes' | 'equipe';

const LIST_COL_CLASS_DESKTOP = 'w-[340px] shrink-0 border-r border-[var(--border-color)]';
const LIST_COL_CLASS_MOBILE = 'flex-1';

function TabPills({
  activeTab,
  onSelect,
}: {
  activeTab: MensagensTab;
  onSelect: (tab: MensagensTab) => void;
}) {
  return (
    <div className="flex gap-1 border-b border-[var(--border-color)] px-4 py-2">
      {(
        [
          { id: 'clientes', label: 'Clientes' },
          { id: 'equipe', label: 'Equipe' },
        ] as const
      ).map((t) => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id)}
          data-testid={`mensagens-tab-${t.id}`}
          className="rounded-full px-3 py-1.5 text-xs whitespace-nowrap"
          style={{
            border: 'none',
            cursor: 'pointer',
            background: activeTab === t.id ? 'var(--text-main)' : 'transparent',
            color: activeTab === t.id ? 'var(--card-bg)' : 'var(--text-muted)',
            fontWeight: activeTab === t.id ? 600 : 400,
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

interface EquipePaneProps {
  active: boolean;
  showTabs: boolean;
  activeTab: MensagensTab;
  onTabSelect: (tab: MensagensTab) => void;
  isDesktop: boolean;
  conversaId: number | null;
  invalidId: boolean;
  onBack?: () => void;
  onSelect: (conversaId: number) => void;
  onNovaConversa: () => void;
  detalhesOpen: boolean;
  onOpenDetalhes: () => void;
  onCloseDetalhes: () => void;
  onLeftGrupo: () => void;
}

/** Owns the equipe-chat data + realtime hooks. The parent only mounts this
 * component while `feature_team_chat` is on, so a workspace without the flag
 * never issues the extra `get_equipe_conversas` fetch. `active` then gates
 * whether it actually renders into the list/thread slots -- it keeps its
 * query alive in the background even while the Clientes tab is the one
 * showing, the same way the clientes side never pauses on the Equipe tab. */
function EquipePane({
  active,
  showTabs,
  activeTab,
  onTabSelect,
  isDesktop,
  conversaId,
  invalidId,
  onBack,
  onSelect,
  onNovaConversa,
  detalhesOpen,
  onOpenDetalhes,
  onCloseDetalhes,
  onLeftGrupo,
}: EquipePaneProps) {
  const equipe = useEquipeChatData(conversaId);
  useEquipeChatRealtime(conversaId);

  if (!active) return null;

  // Same rationale as the clientes side: a background refetch failing on top
  // of already-cached data must not tear down the list or an open thread.
  const conversasHardError = equipe.conversas.isError && equipe.conversas.data == null;
  const conversaAtual =
    conversaId != null ? equipe.conversas.data?.find((c) => c.conversa_id === conversaId) : null;

  function renderThreadSlot() {
    if (invalidId) return <ThreadNotFound onBack={onBack} />;
    if (conversaId == null) return <ThreadPlaceholder />;
    if (equipe.conversas.isLoading) return <ThreadLoading onBack={onBack} />;
    if (conversasHardError) {
      return <ThreadLoadError onRetry={() => equipe.conversas.refetch()} onBack={onBack} />;
    }
    if (!conversaAtual) return <ThreadNotFound onBack={onBack} />;
    return (
      <EquipeThread
        key={conversaId}
        conversa={conversaAtual}
        mensagens={equipe.mensagens}
        send={equipe.send}
        markSeen={equipe.markSeen}
        onBack={onBack}
        onOpenDetalhes={onOpenDetalhes}
      />
    );
  }

  const showList = isDesktop || (conversaId == null && !invalidId);
  const showThread = isDesktop || conversaId != null || invalidId;

  return (
    <>
      {showList && (
        <div
          className={`flex flex-col ${isDesktop ? LIST_COL_CLASS_DESKTOP : LIST_COL_CLASS_MOBILE}`}
        >
          {showTabs && <TabPills activeTab={activeTab} onSelect={onTabSelect} />}
          <EquipeConversationList
            className="min-h-0 flex-1"
            conversas={equipe.conversas.data ?? []}
            isLoading={equipe.conversas.isLoading}
            isError={conversasHardError}
            selectedConversaId={conversaId}
            onSelect={onSelect}
            onNovaConversa={onNovaConversa}
          />
        </div>
      )}
      {showThread && renderThreadSlot()}
      {detalhesOpen && conversaAtual && (
        <EquipeDetalhesSheet
          conversa={conversaAtual}
          onClose={onCloseDetalhes}
          onLeft={onLeftGrupo}
        />
      )}
    </>
  );
}

export default function MensagensPage() {
  const { clienteId: clienteIdParam, conversaId: conversaIdParam } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { features, isLoading: limitsLoading, isUnlimited } = useWorkspaceLimits();
  // An unlimited workspace never gets a `features` payload (see
  // useWorkspaceLimits) -- ProtectedRoute and ExpressPostPage already carve
  // this out for their own gates; without it here, both flags read false for
  // an unlimited workspace and the redirect below would bounce every deep
  // link ProtectedRoute deliberately let through.
  const clientesOn = isUnlimited || features?.feature_mensagens === true;
  const equipeOn = isUnlimited || features?.feature_team_chat === true;
  const showTabs = clientesOn && equipeOn;

  const equipeMode = location.pathname.startsWith('/mensagens/equipe');
  // Aba ativa: URL de conversa manda; senao estado local, default = primeira
  // aba habilitada.
  const [tab, setTab] = useState<MensagensTab>(() =>
    clientesOn || !equipeOn ? 'clientes' : 'equipe',
  );
  const activeTab: MensagensTab = equipeMode ? 'equipe' : clienteIdParam != null ? 'clientes' : tab;

  // Keeps the local tab in sync with whatever section the URL implies, so a
  // deep link followed by mobile's "voltar" (which drops back to the bare
  // /mensagens URL) lands back on the section the user was actually in
  // instead of resetting to the mount-time default. Gated on the section's
  // own flag: an URL for a section that isn't entitled is about to be
  // redirected away below and must not be allowed to poison `tab` first
  // (that raced with the redirect and left the page blank post-redirect).
  useEffect(() => {
    if (equipeMode) {
      if (equipeOn && tab !== 'equipe') setTab('equipe');
    } else if (clienteIdParam != null) {
      if (clientesOn && tab !== 'clientes') setTab('clientes');
    }
  }, [equipeMode, clienteIdParam, equipeOn, clientesOn, tab]);

  // Snap-to-enabled: the `tab` initializer above runs while useWorkspaceLimits
  // is still loading (both flags false at that point), so it always defaults
  // to 'clientes' -- for a team-chat-only workspace on bare /mensagens, the
  // sync effect above never corrects it either (it only reacts to an
  // equipe/cliente URL, not the flag-only case), leaving a blank clientes
  // pane. Once the entitlement check has actually resolved, nudge `tab` to
  // whichever section is really enabled.
  useEffect(() => {
    if (limitsLoading) return;
    if (tab === 'clientes' && !clientesOn && equipeOn) setTab('equipe');
    else if (tab === 'equipe' && !equipeOn && clientesOn) setTab('clientes');
  }, [limitsLoading, clientesOn, equipeOn, tab]);

  const [novaConversaOpen, setNovaConversaOpen] = useState(false);
  const [detalhesOpen, setDetalhesOpen] = useState(false);

  function selectTab(next: MensagensTab) {
    setTab(next);
    navigate('/mensagens');
  }

  const hasParam = clienteIdParam != null;
  const parsedId = hasParam ? parseInt(clienteIdParam, 10) : NaN;
  const invalidId = hasParam && isNaN(parsedId);
  const clienteId = hasParam && !invalidId ? parsedId : null;

  const parsedConversaId = conversaIdParam != null ? parseInt(conversaIdParam, 10) : NaN;
  const equipeConversaId = equipeMode && !isNaN(parsedConversaId) ? parsedConversaId : null;
  const invalidEquipeId = equipeMode && conversaIdParam != null && isNaN(parsedConversaId);

  const { feed, conversas, clientes, sendGeneral, replyToPost } = useMensagensData(
    clienteId,
    clientesOn,
  );

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

  // A workspace can have either flag on independently. Once the entitlement
  // check has actually resolved (never redirect mid-load, or every deep link
  // bounces on first paint), send a URL for a section the workspace doesn't
  // have back to the tab it does have -- e.g. team_chat on / mensagens off
  // hitting /mensagens/14 directly, which must not fall through to the
  // clientes branch below and leak client conversation data past the flag.
  if (!limitsLoading) {
    if (equipeMode && !equipeOn) return <Navigate to="/mensagens" replace />;
    if (!equipeMode && clienteIdParam != null && !clientesOn) {
      return <Navigate to="/mensagens" replace />;
    }
  }

  return (
    <div className="page-full-bleed flex min-h-0">
      {clientesOn && activeTab === 'clientes' && (
        <>
          {showList && (
            <div
              className={`flex flex-col ${isDesktop ? LIST_COL_CLASS_DESKTOP : LIST_COL_CLASS_MOBILE}`}
            >
              {showTabs && <TabPills activeTab={activeTab} onSelect={selectTab} />}
              <ConversationList
                className="min-h-0 flex-1"
                conversas={conversas.data ?? []}
                isLoading={conversas.isLoading}
                isError={conversasHardError}
                selectedClienteId={clienteId}
                clientesById={clientesById}
                onSelect={goToConversa}
              />
            </div>
          )}
          {showThread && renderThreadSlot()}
        </>
      )}
      {equipeOn && (
        <EquipePane
          active={activeTab === 'equipe'}
          showTabs={showTabs}
          activeTab={activeTab}
          onTabSelect={selectTab}
          isDesktop={isDesktop}
          conversaId={equipeConversaId}
          invalidId={invalidEquipeId}
          onBack={onBack}
          onSelect={(id) => navigate(`/mensagens/equipe/${id}`)}
          onNovaConversa={() => setNovaConversaOpen(true)}
          detalhesOpen={detalhesOpen}
          onOpenDetalhes={() => setDetalhesOpen(true)}
          onCloseDetalhes={() => setDetalhesOpen(false)}
          onLeftGrupo={() => {
            setDetalhesOpen(false);
            navigate('/mensagens');
          }}
        />
      )}
      {equipeOn && (
        <NovaConversaDialog
          open={novaConversaOpen}
          onOpenChange={setNovaConversaOpen}
          onCreated={(id) => navigate(`/mensagens/equipe/${id}`)}
        />
      )}
    </div>
  );
}
