import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
import { requiredSignals } from './guideContent';
import { loadGuideProgress } from './guideStorage';

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
  closeForAction(): void;
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

  // Sinais rodam para sempre por padrão (5 queries por dono, em toda página) até que o guia
  // seja concluído — a partir daí não há mais razão para recomputá-los a cada navegação.
  const initiallyConcluded = useMemo(
    () => (contaId ? Boolean(loadGuideProgress(contaId).concludedAt) : false),
    [contaId],
  );
  const [concludedGate, setConcludedGate] = useState(initiallyConcluded);

  const signals = useGuideSignals(isOwner && !concludedGate);
  const view = useGuideProgress(contaId, signals, hasFeature);

  useEffect(() => {
    if (!concludedGate && view.progress.concludedAt) setConcludedGate(true);
  }, [concludedGate, view.progress.concludedAt]);

  const [isOpen, setIsOpen] = useState(false);
  const [currentPageId, setCurrentPageId] = useState<string | null>(null);

  const open = useCallback(
    (source: GuideOpenSource) => {
      const landingPageId = source === 'auto' ? null : (view.progress.lastPageId ?? null);
      setCurrentPageId(landingPageId);
      setIsOpen(true);
      captureEvent('guide_opened', { source });
      if (landingPageId != null) captureEvent('guide_page_viewed', { page: landingPageId });
    },
    [view.progress.lastPageId],
  );

  const close = useCallback(() => {
    setIsOpen(false);
    view.dismiss();
    captureEvent('guide_closed', { page: currentPageId });
  }, [view, currentPageId]);

  const closeForAction = useCallback(() => setIsOpen(false), []);

  const goTo = useCallback((pageId: string | null) => {
    setCurrentPageId(pageId);
    if (pageId) captureEvent('guide_page_viewed', { page: pageId });
  }, []);

  const concludeGuide = useCallback(() => {
    const alreadyConcluded = Boolean(view.progress.concludedAt);
    view.conclude();
    setIsOpen(false);
    if (!alreadyConcluded) captureEvent('guide_completed', { via: 'cta' });
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

  // Pill/entradas só aparecem com evidência positiva de guia pendente: nunca
  // durante o "ainda não sei" das queries (padrão TrialNudgeCard). Sem isso, um
  // workspace ativo mostra o pill até os sinais resolverem e o guia se
  // auto-concluir, sumindo na frente do usuário.
  const required = requiredSignals(view.trails);
  const anySignalKnownFalse = required.some((s) => signals.values[s] === false);
  const hasStoredActivity =
    view.progress.pagesSeen.length > 0 ||
    Boolean(view.progress.autoOpenedAt) ||
    Boolean(view.progress.dismissedAt) ||
    Boolean(view.progress.lastPageId);

  const api: GuideApi = {
    ...view,
    isOpen,
    currentPageId,
    latestClienteId: signals.latestClienteId,
    signalValues: signals.values,
    showEntryPoint: isOwner && !view.isConcluded && (anySignalKnownFalse || hasStoredActivity),
    open,
    close,
    closeForAction,
    goTo,
    concludeGuide,
  };

  return <GuideContext.Provider value={api}>{children}</GuideContext.Provider>;
}
