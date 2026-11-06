import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { Cliente } from '@/store';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useAuth } from '@/context/AuthContext';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { useEquipeChatRealtime } from '@/hooks/useEquipeChatRealtime';
import { usePageToolbar } from '@/components/layout/PageToolbarContext';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import { useMensagensData } from './hooks/useMensagensData';
import { useEquipeChatData } from './hooks/useEquipeChatData';
import { ConversationList, MensagensInfoTooltip } from './components/ConversationList';
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
import { MensagensListPhone } from './phone/MensagensListPhone';
import { ConversationThreadPhone } from './phone/ConversationThreadPhone';
import { ThreadPhoneShell } from './phone/ThreadPhoneShell';
import { EquipeListPhone } from './phone/EquipeListPhone';
import { EquipeThreadPhone } from './phone/EquipeThreadPhone';
import { colegasSemDm } from './equipeChatLogic';

type MensagensTab = 'clientes' | 'equipe';

const LIST_COL_CLASS = 'w-[340px] shrink-0 border-r border-[var(--border-color)]';

function TabPills({
  activeTab,
  onSelect,
}: {
  activeTab: MensagensTab;
  onSelect: (tab: MensagensTab) => void;
}) {
  const { t } = useTranslation('messages');
  return (
    <div className="flex gap-1 border-b border-[var(--border-color)] px-4 py-2">
      {(
        [
          { id: 'clientes', label: t('page.tabs.clientes') },
          { id: 'equipe', label: t('page.tabs.equipe') },
        ] as const
      ).map((tab) => (
        <button
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          data-testid={`mensagens-tab-${tab.id}`}
          className="rounded-full px-3 py-1.5 text-xs whitespace-nowrap"
          style={{
            border: 'none',
            cursor: 'pointer',
            background: activeTab === tab.id ? 'var(--text-main)' : 'transparent',
            color: activeTab === tab.id ? 'var(--card-bg)' : 'var(--text-muted)',
            fontWeight: activeTab === tab.id ? 600 : 400,
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** Phones: the same two sections as an iOS segmented control under the large
 * title. The testids sit on the labels (the click bubbles to the segment), so
 * the page tests drive both layouts the same way. */
function PhoneTabs({
  activeTab,
  onSelect,
}: {
  activeTab: MensagensTab;
  onSelect: (tab: MensagensTab) => void;
}) {
  const { t } = useTranslation('messages');
  return (
    <SegmentedControl
      aria-label={t('page.sectionLabel')}
      className="mt-2"
      value={activeTab}
      onChange={onSelect}
      options={[
        {
          value: 'clientes',
          label: <span data-testid="mensagens-tab-clientes">{t('page.tabs.clientes')}</span>,
          ariaLabel: t('page.tabs.clientes'),
        },
        {
          value: 'equipe',
          label: <span data-testid="mensagens-tab-equipe">{t('page.tabs.equipe')}</span>,
          ariaLabel: t('page.tabs.equipe'),
        },
      ]}
    />
  );
}

interface EquipePaneProps {
  active: boolean;
  /** Clientes | Equipe pills, or null when only one section is on. */
  tabs: ReactNode;
  isDesktop: boolean;
  conversaId: number | null;
  invalidId: boolean;
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
 * whether it actually renders into the list/thread slots -- on desktop it
 * keeps its query alive in the background even while the Clientes tab is the
 * one showing, the same way the clientes side never pauses on the Equipe tab.
 * On phones it renders the list as a root screen under the page header and a
 * thread inside ThreadPhoneShell, the same frame as the Clientes screens. */
function EquipePane({
  active,
  tabs,
  isDesktop,
  conversaId,
  invalidId,
  onSelect,
  onNovaConversa,
  detalhesOpen,
  onOpenDetalhes,
  onCloseDetalhes,
  onLeftGrupo,
}: EquipePaneProps) {
  const { t } = useTranslation('messages');
  const { user } = useAuth();
  const equipe = useEquipeChatData(conversaId);
  useEquipeChatRealtime(conversaId);

  if (!active) return null;

  // Same rationale as the clientes side: a background refetch failing on top
  // of already-cached data must not tear down the list or an open thread.
  const conversasHardError = equipe.conversas.isError && equipe.conversas.data == null;
  const conversaAtual =
    conversaId != null ? equipe.conversas.data?.find((c) => c.conversa_id === conversaId) : null;

  // Every colleague with no DM yet is listed too, like every client on the
  // Clientes tab; a click opens (creates) the DM. A failed members fetch only
  // drops those rows, the conversations still show.
  const conversas = equipe.conversas.data ?? [];
  const colegas = colegasSemDm(equipe.membros.data ?? [], conversas, user?.id ?? null);
  const listaLoading = equipe.conversas.isLoading || equipe.membros.isLoading;
  const abrindoColegaId = equipe.abrirDm.isPending ? (equipe.abrirDm.variables ?? null) : null;
  function abrirColega(userId: string) {
    if (equipe.abrirDm.isPending) return;
    equipe.abrirDm.mutate(userId, {
      onSuccess: onSelect,
      onError: () => toast.error(t('shared.openConversationError')),
    });
  }

  const lista = (
    <EquipeConversationList
      className="min-h-0 min-w-0 flex-1"
      conversas={conversas}
      colegas={colegas}
      isLoading={listaLoading}
      isError={conversasHardError}
      selectedConversaId={conversaId}
      currentUserId={user?.id ?? null}
      onSelect={onSelect}
      onSelectColega={abrirColega}
      abrindoColegaId={abrindoColegaId}
      onNovaConversa={onNovaConversa}
    />
  );

  const detalhes = detalhesOpen && conversaAtual && (
    <EquipeDetalhesSheet conversa={conversaAtual} onClose={onCloseDetalhes} onLeft={onLeftGrupo} />
  );

  function renderThreadStatus() {
    if (invalidId) return <ThreadNotFound />;
    if (equipe.conversas.isLoading) return <ThreadLoading />;
    if (conversasHardError) {
      return <ThreadLoadError onRetry={() => equipe.conversas.refetch()} />;
    }
    return <ThreadNotFound />;
  }

  if (!isDesktop) {
    if (conversaId == null && !invalidId) {
      return (
        <EquipeListPhone
          conversas={conversas}
          colegas={colegas}
          isLoading={listaLoading}
          isError={conversasHardError}
          currentUserId={user?.id ?? null}
          onSelect={onSelect}
          onSelectColega={abrirColega}
          abrindoColegaId={abrindoColegaId}
          onNovaConversa={onNovaConversa}
          headerExtra={tabs}
        />
      );
    }
    if (!conversaAtual || equipe.conversas.isLoading) {
      return <ThreadPhoneShell title={t('shared.title')}>{renderThreadStatus()}</ThreadPhoneShell>;
    }
    return (
      <EquipeThreadPhone
        key={conversaId}
        conversa={conversaAtual}
        mensagens={equipe.mensagens}
        send={equipe.send}
        markSeen={equipe.markSeen}
        onOpenDetalhes={onOpenDetalhes}
      >
        {detalhes}
      </EquipeThreadPhone>
    );
  }

  return (
    <>
      <div className={`flex flex-col ${LIST_COL_CLASS}`}>
        {tabs}
        {lista}
      </div>
      {conversaId == null && !invalidId ? (
        <ThreadPlaceholder />
      ) : conversaAtual && !equipe.conversas.isLoading ? (
        <EquipeThread
          key={conversaId}
          conversa={conversaAtual}
          mensagens={equipe.mensagens}
          send={equipe.send}
          markSeen={equipe.markSeen}
          onOpenDetalhes={onOpenDetalhes}
        />
      ) : (
        renderThreadStatus()
      )}
      {detalhes}
    </>
  );
}

export default function MensagensPage() {
  const { t } = useTranslation('messages');
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
  //
  // `tab` is deliberately NOT a dependency (read via the functional setTab
  // form instead): a tab-pill click fires `setTab` and `navigate` together,
  // and if this effect re-ran merely because `tab` changed -- while
  // `equipeMode`/`location` hasn't caught up to the new URL in that same
  // render yet -- it would see the *old* equipeMode still true and the
  // *new* tab already flipped, and force it straight back. Keying only on
  // the URL-derived values means the effect stays inert while just `tab`
  // moves, and only re-asserts once the URL itself actually changes.
  useEffect(() => {
    if (equipeMode) {
      setTab((t) => (equipeOn && t !== 'equipe' ? 'equipe' : t));
    } else if (clienteIdParam != null) {
      setTab((t) => (clientesOn && t !== 'clientes' ? 'clientes' : t));
    }
  }, [equipeMode, clienteIdParam, equipeOn, clientesOn]);

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
    clientesOn && activeTab === 'clientes',
  );
  const inToolbar = usePageToolbar({
    title: t('shared.title'),
    titleAccessory: <MensagensInfoTooltip />,
  });

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

  const tabs = !showTabs ? null : isDesktop ? (
    <TabPills activeTab={activeTab} onSelect={selectTab} />
  ) : (
    <PhoneTabs activeTab={activeTab} onSelect={selectTab} />
  );

  const equipePane = (active: boolean) => (
    <EquipePane
      active={active}
      tabs={tabs}
      isDesktop={isDesktop}
      conversaId={equipeConversaId}
      invalidId={invalidEquipeId}
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
  );

  const novaConversaDialog = equipeOn && (
    <NovaConversaDialog
      open={novaConversaOpen}
      onOpenChange={setNovaConversaOpen}
      onCreated={(id) => navigate(`/mensagens/equipe/${id}`)}
    />
  );

  // Phones (below 768): the list is a root screen with the page header; a thread is a
  // pushed screen with its own nav bar and composer, and the tab bar hidden. The
  // Equipe tab renders inside the same frame (EquipePane's phone branch).
  if (!isDesktop) {
    if (equipeOn && activeTab === 'equipe') {
      return (
        <>
          {equipePane(true)}
          {novaConversaDialog}
        </>
      );
    }
    if (!clientesOn) return null;
    if (clienteId == null && !invalidId) {
      return (
        <MensagensListPhone
          conversas={conversas.data ?? []}
          isLoading={conversas.isLoading}
          isError={conversasHardError}
          clientesById={clientesById}
          onSelect={goToConversa}
          headerExtra={tabs}
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
      <ThreadPhoneShell title={t('shared.title')}>
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
      {clientesOn && activeTab === 'clientes' && (
        <>
          <div className={`flex flex-col ${LIST_COL_CLASS}`}>
            {tabs}
            <ConversationList
              className="min-h-0 flex-1"
              conversas={conversas.data ?? []}
              isLoading={conversas.isLoading}
              isError={conversasHardError}
              selectedClienteId={clienteId}
              clientesById={clientesById}
              onSelect={goToConversa}
              hideTitle={inToolbar}
            />
          </div>
          {renderThreadSlot()}
        </>
      )}
      {equipeOn && equipePane(activeTab === 'equipe')}
      {novaConversaDialog}
    </div>
  );
}
