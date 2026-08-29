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
    cleanup = mountAnchor(TOUR_STEPS[1].anchor);
    render(<TourOverlay {...baseProps} step={TOUR_STEPS[1]} index={1} />);
    expect(screen.getByText('tour.next')).toBeInTheDocument();
    expect(screen.queryByText('tour.back')).not.toBeInTheDocument();
  });

  it('passo intermediário: Voltar + Próximo, callbacks corretos', () => {
    cleanup = mountAnchor(TOUR_STEPS[4].anchor);
    const onNext = vi.fn();
    const onBack = vi.fn();
    render(
      <TourOverlay {...baseProps} step={TOUR_STEPS[4]} index={4} onNext={onNext} onBack={onBack} />,
    );
    fireEvent.click(screen.getByText('tour.next'));
    fireEvent.click(screen.getByText('tour.back'));
    expect(onNext).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('último passo: Concluir chama onFinish', () => {
    cleanup = mountAnchor(TOUR_STEPS[7].anchor);
    const onFinish = vi.fn();
    render(<TourOverlay {...baseProps} step={TOUR_STEPS[7]} index={7} onFinish={onFinish} />);
    fireEvent.click(screen.getByText('tour.finish'));
    expect(onFinish).toHaveBeenCalledOnce();
    expect(screen.queryByText('tour.next')).not.toBeInTheDocument();
  });

  it('"Pular tour" chama onSkip em qualquer passo', () => {
    cleanup = mountAnchor(TOUR_STEPS[2].anchor);
    const onSkip = vi.fn();
    render(<TourOverlay {...baseProps} step={TOUR_STEPS[2]} index={2} onSkip={onSkip} />);
    fireEvent.click(screen.getByText('tour.skip'));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('âncora ausente: não renderiza card nem spotlight', () => {
    render(<TourOverlay {...baseProps} step={TOUR_STEPS[3]} index={3} />);
    expect(screen.queryByTestId('tour-card')).not.toBeInTheDocument();
  });
});
