import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import './tour.css';
import { i18n } from '@mesaas/i18n';

interface TourStepDef {
  readonly selector: string;
  readonly title: string;
  readonly description: string;
}

/** title/description são getters: resolvem no idioma atual a cada leitura, nunca no load. */
const tourStep = (selector: string, key: string, descriptionKey = key): TourStepDef => ({
  selector,
  get title() {
    return i18n.t(`entregasPhone:tour.${key}.title`);
  },
  get description() {
    return i18n.t(`entregasPhone:tour.${descriptionKey}.description`);
  },
});

export const TOUR_STEP_DEFS: TourStepDef[] = [
  tourStep('[data-tour="wf-card"]', 'card'),
  tourStep('[data-tour="wf-deadline"]', 'deadline'),
  tourStep('[data-tour="wf-posts"]', 'posts'),
  tourStep('[data-tour="wf-card"]', 'drag'),
  tourStep('[data-tour="wf-col-aprovacao"]', 'approval'),
  tourStep('[data-tour="novo-fluxo-btn"]', 'firstFluxo'),
];

/** Variante com feature_post_processes: mesmos seletores, sem afirmar que só
 *  fluxos são cards (spec §3). */
export const TOUR_STEP_DEFS_POST_PROCESSES: TourStepDef[] = TOUR_STEP_DEFS.map((s, i) =>
  i === 0
    ? tourStep(s.selector, 'card', 'cardPostProcesses')
    : i === 2
      ? tourStep(s.selector, 'posts', 'postsPostProcesses')
      : s,
);

export const tourStorageKey = (contaId: string) => `entregas_tour_done_${contaId}`;

export function buildTourSteps(
  root: ParentNode = document,
  defs: typeof TOUR_STEP_DEFS = TOUR_STEP_DEFS,
): DriveStep[] {
  return defs
    .filter((s) => root.querySelector(s.selector))
    .map((s) => ({
      element: s.selector,
      popover: { title: s.title, description: s.description },
    }));
}

export function startEntregasTour(opts: {
  onComplete: () => void;
  onDismiss: (stepIndex: number) => void;
  postProcesses?: boolean;
}): void {
  const steps = buildTourSteps(
    document,
    opts.postProcesses ? TOUR_STEP_DEFS_POST_PROCESSES : TOUR_STEP_DEFS,
  );
  if (steps.length === 0) return;

  // Completion = the user clicked "Concluir" on the last step. Any other exit (X, overlay,
  // Escape) is a dismissal — even on the last step.
  //
  // Real driver.js call graph (verified against 1.7.0's dist source): clicking the done button
  // invokes `onDoneClick` directly from the popover's click handler — it is NOT routed through
  // the internal destroy flow. Calling `d.destroy()` runs the internal teardown with its
  // "started" flag forced off, which deliberately SKIPS re-invoking `onDestroyStarted`. So
  // `onComplete` must be fired from `onDoneClick` itself, not deferred to `onDestroyStarted` —
  // deferring it there means it would never fire for a real done-click.
  //
  // `settled` guards both branches so onComplete/onDismiss can only fire once per tour, however
  // future driver.js versions route the two hooks.
  let settled = false;
  const d = driver({
    steps,
    showProgress: true,
    progressText: i18n.t('entregasPhone:tour.progress', {
      interpolation: { skipOnVariables: true },
      current: '{{current}}',
      total: '{{total}}',
    }),
    nextBtnText: i18n.t('entregasPhone:tour.next'),
    prevBtnText: i18n.t('entregasPhone:tour.prev'),
    doneBtnText: i18n.t('entregasPhone:tour.done'),
    onDoneClick: () => {
      if (!settled) {
        settled = true;
        opts.onComplete();
      }
      d.destroy();
    },
    onDestroyStarted: () => {
      if (!settled) {
        settled = true;
        opts.onDismiss(d.getActiveIndex() ?? 0);
      }
      d.destroy();
    },
  });
  d.drive();
}
