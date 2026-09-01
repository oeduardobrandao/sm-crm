import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import './tour.css';

export const TOUR_STEP_DEFS = [
  {
    selector: '[data-tour="wf-card"]',
    title: 'Card de fluxo',
    description:
      'Isto é um card de fluxo: um ciclo de trabalho de um cliente. Ele avança pelas colunas (etapas) até a entrega.',
  },
  {
    selector: '[data-tour="wf-deadline"]',
    title: 'Prazo e etapa',
    description:
      'Aqui você acompanha o prazo da etapa atual — verde em dia, amarelo urgente, vermelho atrasado.',
  },
  {
    selector: '[data-tour="wf-posts"]',
    title: 'Posts vivem no card',
    description: 'Os posts ficam dentro do card. Clique no card para abrir o painel e criar posts.',
  },
  {
    selector: '[data-tour="wf-card"]',
    title: 'Arraste para avançar',
    description: 'Arraste o card para a próxima coluna para avançar a etapa.',
  },
  {
    selector: '[data-tour="wf-col-aprovacao"]',
    title: 'Aprovação do cliente',
    description:
      'Quando o card chega nesta coluna, os posts podem ser enviados ao portal do cliente para aprovação — sem login.',
  },
  {
    selector: '[data-tour="novo-fluxo-btn"]',
    title: 'Crie seu primeiro fluxo',
    description: 'Clique em Novo e escolha Novo fluxo para começar. Há modelos prontos.',
  },
];

export const tourStorageKey = (contaId: string) => `entregas_tour_done_${contaId}`;

export function buildTourSteps(root: ParentNode = document): DriveStep[] {
  return TOUR_STEP_DEFS.filter((s) => root.querySelector(s.selector)).map((s) => ({
    element: s.selector,
    popover: { title: s.title, description: s.description },
  }));
}

export function startEntregasTour(opts: {
  onComplete: () => void;
  onDismiss: (stepIndex: number) => void;
}): void {
  const steps = buildTourSteps();
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
    progressText: '{{current}} de {{total}}',
    nextBtnText: 'Próximo →',
    prevBtnText: '← Voltar',
    doneBtnText: 'Concluir',
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
