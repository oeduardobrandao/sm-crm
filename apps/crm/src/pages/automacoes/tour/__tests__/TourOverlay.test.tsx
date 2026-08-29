import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TourOverlay from '../TourOverlay';
import { TOUR_STEPS } from '../tourSteps';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
    i18n: { language: 'pt' },
  }),
}));

const noop = () => {};
const baseProps = {
  total: TOUR_STEPS.length,
  onNext: noop,
  onBack: noop,
  onSkip: noop,
  onFinish: noop,
};

/** Cria a âncora no DOM antes do render; devolve cleanup. */
function mountAnchor(anchor: string): () => void {
  const el = document.createElement('div');
  el.setAttribute('data-tour', anchor);
  document.body.appendChild(el);
  return () => el.remove();
}

/**
 * Para passos `surface: 'dialog'`, `measure()` só resolve dentro de um
 * ancestral real com `[data-dialog-scroll]` (o wrapper de scroll interno do
 * Radix DialogContent em produção, ver dialog.tsx) -- sem isso o overlay não
 * deve resolver o layout, é assim que o fail-safe evita coordenadas erradas
 * se o dialog ainda estiver montando. Este helper cria esse wrapper no body
 * com a âncora dentro dele e devolve o container para `render(ui,
 * { container })`: o `TourOverlay` monta como descendente do wrapper, então
 * `rootRef.current.closest('[data-dialog-scroll]')` encontra um ancestral de
 * verdade, igual ao caso de produção.
 *
 * Em produção `role="dialog"` fica no Radix Content e `data-dialog-scroll`
 * no `<div>` filho dele (o wrapper com scroll); aqui os dois atributos vão
 * no mesmo elemento porque é só isso que o seletor que `measure()` de fato
 * usa hoje precisa satisfazer.
 */
function mountDialogAnchor(anchor: string): { container: HTMLElement; cleanup: () => void } {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('data-dialog-scroll', '');
  document.body.appendChild(dialog);
  const el = document.createElement('div');
  el.setAttribute('data-tour', anchor);
  dialog.appendChild(el);
  // Container de render separado da âncora: o React (createRoot) limpa
  // qualquer filho pré-existente do nó em que monta, o que apagaria a
  // âncora se ela estivesse no mesmo container passado a `render()`.
  const renderContainer = document.createElement('div');
  dialog.appendChild(renderContainer);
  return { container: renderContainer, cleanup: () => dialog.remove() };
}

describe('TourOverlay', () => {
  let cleanup: (() => void) | null = null;
  beforeEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it('passo 1: título, texto, contador e só o CTA (sem Voltar/Próximo)', () => {
    cleanup = mountAnchor(TOUR_STEPS[0].anchor);
    render(<TourOverlay {...baseProps} step={TOUR_STEPS[0]} index={0} onCta={noop} />);
    expect(screen.getByText('tour.step1Title')).toBeInTheDocument();
    expect(screen.getByText('tour.step1Text')).toBeInTheDocument();
    expect(screen.getByText('tour.counter:{"current":1,"total":8}')).toBeInTheDocument();
    expect(screen.getByText('tour.step1Cta')).toBeInTheDocument();
    expect(screen.queryByText('tour.next')).not.toBeInTheDocument();
    expect(screen.queryByText('tour.back')).not.toBeInTheDocument();
  });

  it('passo 2 (índice 1): Próximo sem Voltar', () => {
    const dialog = mountDialogAnchor(TOUR_STEPS[1].anchor);
    cleanup = dialog.cleanup;
    render(<TourOverlay {...baseProps} step={TOUR_STEPS[1]} index={1} />, {
      container: dialog.container,
    });
    expect(screen.getByText('tour.next')).toBeInTheDocument();
    expect(screen.queryByText('tour.back')).not.toBeInTheDocument();
  });

  it('passo intermediário: Voltar + Próximo, callbacks corretos', () => {
    const dialog = mountDialogAnchor(TOUR_STEPS[4].anchor);
    cleanup = dialog.cleanup;
    const onNext = vi.fn();
    const onBack = vi.fn();
    render(
      <TourOverlay {...baseProps} step={TOUR_STEPS[4]} index={4} onNext={onNext} onBack={onBack} />,
      { container: dialog.container },
    );
    fireEvent.click(screen.getByText('tour.next'));
    fireEvent.click(screen.getByText('tour.back'));
    expect(onNext).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('último passo: Concluir chama onFinish', () => {
    const dialog = mountDialogAnchor(TOUR_STEPS[7].anchor);
    cleanup = dialog.cleanup;
    const onFinish = vi.fn();
    render(<TourOverlay {...baseProps} step={TOUR_STEPS[7]} index={7} onFinish={onFinish} />, {
      container: dialog.container,
    });
    fireEvent.click(screen.getByText('tour.finish'));
    expect(onFinish).toHaveBeenCalledOnce();
    expect(screen.queryByText('tour.next')).not.toBeInTheDocument();
  });

  it('"Pular tour" chama onSkip em qualquer passo', () => {
    const dialog = mountDialogAnchor(TOUR_STEPS[2].anchor);
    cleanup = dialog.cleanup;
    const onSkip = vi.fn();
    render(<TourOverlay {...baseProps} step={TOUR_STEPS[2]} index={2} onSkip={onSkip} />, {
      container: dialog.container,
    });
    fireEvent.click(screen.getByText('tour.skip'));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('âncora ausente: não renderiza card nem spotlight', () => {
    render(<TourOverlay {...baseProps} step={TOUR_STEPS[3]} index={3} />);
    expect(screen.queryByTestId('tour-card')).not.toBeInTheDocument();
  });
});
