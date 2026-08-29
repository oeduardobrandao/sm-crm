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

  describe('listener de scroll (regressão do fix de containing block)', () => {
    // Para `surface: 'dialog'` o containing block do overlay já é o wrapper
    // que rola (ver dialog.tsx `data-dialog-scroll` + measure() em
    // TourOverlay.tsx), então recalcular measure() no evento de scroll
    // aplicaria o deslocamento uma SEGUNDA vez. O listener de scroll só deve
    // ser registrado para `surface: 'page'`, onde as coordenadas são
    // relativas ao viewport.
    it('passo de página: registra e remove o listener de scroll', () => {
      cleanup = mountAnchor(TOUR_STEPS[0].anchor);
      const addSpy = vi.spyOn(document, 'addEventListener');
      const removeSpy = vi.spyOn(document, 'removeEventListener');
      const { unmount } = render(
        <TourOverlay {...baseProps} step={TOUR_STEPS[0]} index={0} onCta={noop} />,
      );
      expect(addSpy).toHaveBeenCalledWith('scroll', expect.any(Function), true);
      unmount();
      expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function), true);
      addSpy.mockRestore();
      removeSpy.mockRestore();
    });

    it('passo de dialog: NÃO registra listener de scroll', () => {
      const dialog = mountDialogAnchor(TOUR_STEPS[1].anchor);
      cleanup = dialog.cleanup;
      const addSpy = vi.spyOn(document, 'addEventListener');
      const removeSpy = vi.spyOn(document, 'removeEventListener');
      const { unmount } = render(<TourOverlay {...baseProps} step={TOUR_STEPS[1]} index={1} />, {
        container: dialog.container,
      });
      expect(addSpy).not.toHaveBeenCalledWith('scroll', expect.any(Function), true);
      unmount();
      expect(removeSpy).not.toHaveBeenCalledWith('scroll', expect.any(Function), true);
      addSpy.mockRestore();
      removeSpy.mockRestore();
    });
  });

  describe('measure() soma o scroll do wrapper na primeira medição (bug 3: scrollIntoView + measure no mesmo tick)', () => {
    // jsdom não faz layout de verdade: getBoundingClientRect sempre devolve
    // zeros e scrollIntoView não move nada. Para provar que a fórmula agora
    // inclui content.scrollTop/scrollLeft, mockamos getBoundingClientRect do
    // wrapper `[data-dialog-scroll]` e da âncora com retângulos fixos e
    // diferentes, e setamos scrollTop/scrollLeft do wrapper manualmente --
    // exatamente o estado em que measure() roda hoje, já que
    // scrollIntoView() (chamado antes, no mesmo tick síncrono) pode ter
    // deixado o wrapper com scroll != 0 antes da primeira (e única) medição
    // daquele passo.
    it('spot.top/left incluem content.scrollTop/scrollLeft quando o wrapper já rolou antes da medição', () => {
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('data-dialog-scroll', '');
      document.body.appendChild(dialog);

      const anchorEl = document.createElement('div');
      anchorEl.setAttribute('data-tour', TOUR_STEPS[1].anchor);
      dialog.appendChild(anchorEl);

      // Container de render separado da âncora (mesmo motivo do
      // mountDialogAnchor acima: createRoot limpa filhos pré-existentes).
      const renderContainer = document.createElement('div');
      dialog.appendChild(renderContainer);

      // Wrapper já rolado (o que scrollIntoView teria feito antes desta
      // medição). jsdom permite setar scrollTop/scrollLeft direto, sem scroll
      // real.
      dialog.scrollTop = 396;
      dialog.scrollLeft = 15;

      const dialogRect = {
        top: 50,
        left: 20,
        width: 300,
        height: 400,
        right: 320,
        bottom: 450,
        x: 20,
        y: 50,
        toJSON: () => ({}),
      } as DOMRect;
      const anchorRect = {
        top: 200,
        left: 60,
        width: 100,
        height: 30,
        right: 160,
        bottom: 230,
        x: 60,
        y: 200,
        toJSON: () => ({}),
      } as DOMRect;
      vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue(dialogRect);
      vi.spyOn(anchorEl, 'getBoundingClientRect').mockReturnValue(anchorRect);

      render(<TourOverlay {...baseProps} step={TOUR_STEPS[1]} index={1} />, {
        container: renderContainer,
      });

      const overlay = screen.getByTestId('tour-overlay');
      const spotlight = overlay.firstElementChild as HTMLElement;
      // Fórmula esperada: rect.top - cRect.top + content.scrollTop (e o
      // análogo para left) -- ou seja, 200 - 50 + 396 = 546 e 60 - 20 + 15 = 55.
      // A fórmula antiga (sem o termo de scroll) daria 150 / 40.
      expect(spotlight.style.top).toBe('546px');
      expect(spotlight.style.left).toBe('55px');
      expect(spotlight.style.width).toBe('100px');
      expect(spotlight.style.height).toBe('30px');

      dialog.remove();
    });
  });
});
