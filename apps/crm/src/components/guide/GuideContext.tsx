import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useIsWorkspaceOwner } from '../../hooks/useIsWorkspaceOwner';
import { useEntitlements } from '../../hooks/useEntitlements';
import { captureEvent } from '../../lib/analytics';
import { useGuideSignals, type GuideSignals } from './useGuideSignals';
import { useGuideProgress, type GuideView } from './useGuideProgress';
import { shouldAutoOpenGuide } from './guideGating';

export type GuideOpenSource = 'auto' | 'pill' | 'sidebar' | 'mobile_nav';

export interface GuideApi extends GuideView {
  isOpen: boolean;
  /** null = tela inicial (trilhas). */
  currentPageId: string | null;
  latestClienteId: number | null;
  signalValues: GuideSignals['values'];
  showEntryPoint: boolean;
  open(source: GuideOpenSource): void;
  close(): void;
  goTo(pageId: string | null): void;
  concludeGuide(): void;
}

export const GuideContext = createContext<GuideApi | null>(null);

export function useGuide(): GuideApi | null {
  return useContext(GuideContext);
}

export function GuideProvider({ children }: { children: ReactNode }) {
  const { loading, profile } = useAuth();
  const isOwner = useIsWorkspaceOwner();
  const { hasFeature } = useEntitlements();
  const location = useLocation();

  const contaId = profile?.conta_id ?? null;
  const signals = useGuideSignals(isOwner);
  const view = useGuideProgress(contaId, signals, hasFeature);

  const [isOpen, setIsOpen] = useState(false);
  const [currentPageId, setCurrentPageId] = useState<string | null>(null);

  const open = useCallback(
    (source: GuideOpenSource) => {
      setCurrentPageId(source === 'auto' ? null : (view.progress.lastPageId ?? null));
      setIsOpen(true);
      captureEvent('guide_opened', { source });
    },
    [view.progress.lastPageId],
  );

  const close = useCallback(() => {
    setIsOpen(false);
    view.dismiss();
    captureEvent('guide_closed', { page: currentPageId });
  }, [view, currentPageId]);

  const goTo = useCallback((pageId: string | null) => {
    setCurrentPageId(pageId);
    if (pageId) captureEvent('guide_page_viewed', { page: pageId });
  }, []);

  const concludeGuide = useCallback(() => {
    view.conclude();
    setIsOpen(false);
    captureEvent('guide_completed', { via: 'cta' });
  }, [view]);

  // Auto-abertura: uma vez por workspace, condições da spec.
  const autoOpenTried = useRef(false);
  useEffect(() => {
    if (autoOpenTried.current || isOpen) return;
    const ok = shouldAutoOpenGuide({
      authLoading: loading,
      isOwner,
      pathname: location.pathname,
      progress: view.progress,
      clientes: signals.clientes,
      workflows: signals.workflows,
    });
    if (!ok) return;
    autoOpenTried.current = true;
    view.recordAutoOpen();
    open('auto');
  }, [
    loading,
    isOwner,
    location.pathname,
    view,
    signals.clientes,
    signals.workflows,
    isOpen,
    open,
  ]);

  // Trilha completada: captura uma vez por trilha.
  useEffect(() => {
    for (const trail of view.trails) {
      const done = trail.pages.every((p) => view.doneIds.has(p.id));
      if (done && !view.progress.trailsCompleted.includes(trail.id)) {
        view.recordTrailCompleted(trail.id);
        captureEvent('guide_trail_completed', { trail: trail.id });
      }
    }
  }, [view]);

  // Conclusão por sinais: workspace claramente ativo dispensa o guia.
  useEffect(() => {
    if (view.signalsSatisfied && !view.progress.concludedAt) {
      view.conclude();
      captureEvent('guide_completed', { via: 'signals' });
    }
  }, [view]);

  const api: GuideApi = {
    ...view,
    isOpen,
    currentPageId,
    latestClienteId: signals.latestClienteId,
    signalValues: signals.values,
    showEntryPoint: isOwner && !view.isConcluded,
    open,
    close,
    goTo,
    concludeGuide,
  };

  return <GuideContext.Provider value={api}>{children}</GuideContext.Provider>;
}
