import { beforeEach, describe, expect, it, vi } from 'vitest';

const driverInstance = vi.hoisted(() => ({
  drive: vi.fn(),
  destroy: vi.fn(),
  getActiveIndex: vi.fn(() => 2),
}));
const capturedConfig = vi.hoisted(() => ({ current: null as any }));
const driverFactory = vi.hoisted(() =>
  vi.fn((cfg) => {
    capturedConfig.current = cfg;
    return driverInstance;
  }),
);
vi.mock('driver.js', () => ({
  driver: driverFactory,
}));

import {
  TOUR_STEP_DEFS,
  TOUR_STEP_DEFS_POST_PROCESSES,
  buildTourSteps,
  startEntregasTour,
  tourStorageKey,
} from '../entregasTour';

describe('entregas tour', () => {
  it('defines 6 steps with the expected selectors', () => {
    expect(TOUR_STEP_DEFS).toHaveLength(6);
    expect(TOUR_STEP_DEFS.map((s) => s.selector)).toEqual([
      '[data-tour="wf-card"]',
      '[data-tour="wf-deadline"]',
      '[data-tour="wf-posts"]',
      '[data-tour="wf-card"]',
      '[data-tour="wf-col-aprovacao"]',
      '[data-tour="novo-fluxo-btn"]',
    ]);
  });

  it('omits steps whose selector is absent from the DOM', () => {
    document.body.innerHTML = `
      <div data-tour="wf-card"></div>
      <button data-tour="novo-fluxo-btn"></button>
    `;
    const steps = buildTourSteps(document);
    // wf-card appears twice in defs → both survive; deadline/posts/aprovacao dropped
    expect(steps).toHaveLength(3);
  });

  it('storage key is per conta', () => {
    expect(tourStorageKey('abc')).toBe('entregas_tour_done_abc');
  });
});

describe('startEntregasTour completion vs dismissal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks wipes call records but NOT implementations, so a mockReturnValue set inside
    // one test would leak into every test after it. Re-stub the default here explicitly.
    // (vi.resetAllMocks() is not an option: it would also blow away driverFactory's
    // implementation, so capturedConfig would never be populated.)
    driverInstance.getActiveIndex.mockReturnValue(2);
    document.body.innerHTML = '<div data-tour="wf-card"></div>';
  });

  it('starts the driver when at least one anchor is present', () => {
    const onComplete = vi.fn();
    const onDismiss = vi.fn();
    startEntregasTour({ onComplete, onDismiss });
    expect(driverFactory).toHaveBeenCalledTimes(1);
    expect(driverInstance.drive).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no tour anchors are present in the DOM', () => {
    document.body.innerHTML = '';
    const onComplete = vi.fn();
    const onDismiss = vi.fn();
    startEntregasTour({ onComplete, onDismiss });
    expect(driverFactory).not.toHaveBeenCalled();
    expect(driverInstance.drive).not.toHaveBeenCalled();
  });

  // Mirrors the REAL driver.js 1.7.0 call graph: the done-button click handler invokes
  // onDoneClick directly, and the d.destroy() we make from inside it runs teardown with the
  // internal `started` flag forced false — which skips the onDestroyStarted branch entirely.
  // So onDestroyStarted never runs on this path, and onComplete must fire from onDoneClick
  // itself. This is the test that actually pins the bug fix; the double-invocation test below
  // passes against the broken implementation too and only guards against double-firing.
  it('done button alone completes (real driver.js never re-enters onDestroyStarted)', () => {
    const onComplete = vi.fn();
    const onDismiss = vi.fn();
    startEntregasTour({ onComplete, onDismiss });
    capturedConfig.current.onDoneClick();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('done button → onComplete', () => {
    const onComplete = vi.fn();
    const onDismiss = vi.fn();
    startEntregasTour({ onComplete, onDismiss });
    capturedConfig.current.onDoneClick();
    capturedConfig.current.onDestroyStarted();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('early exit → onDismiss with the active step index', () => {
    const onComplete = vi.fn();
    const onDismiss = vi.fn();
    startEntregasTour({ onComplete, onDismiss });
    capturedConfig.current.onDestroyStarted();
    expect(onDismiss).toHaveBeenCalledWith(2);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('closing on the FINAL step without the done button is still a dismissal', () => {
    driverInstance.getActiveIndex.mockReturnValue(5);
    const onComplete = vi.fn();
    const onDismiss = vi.fn();
    startEntregasTour({ onComplete, onDismiss });
    capturedConfig.current.onDestroyStarted();
    expect(onDismiss).toHaveBeenCalledWith(5);
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe('tour com posts individuais', () => {
  it('a variante tem os mesmos 6 seletores e não afirma que só fluxos são cards', () => {
    expect(TOUR_STEP_DEFS_POST_PROCESSES.map((s) => s.selector)).toEqual(
      TOUR_STEP_DEFS.map((s) => s.selector),
    );
    expect(TOUR_STEP_DEFS_POST_PROCESSES[0].description).toMatch(/Posts individuais/);
    expect(TOUR_STEP_DEFS_POST_PROCESSES[2].description).toMatch(/Os posts de um fluxo/);
    expect(TOUR_STEP_DEFS[2].description).toBe(
      'Os posts ficam dentro do card. Clique no card para abrir o painel e criar posts.',
    );
  });

  it('startEntregasTour escolhe a variante pela opção postProcesses', () => {
    document.body.innerHTML = '<div data-tour="wf-card"></div>';
    startEntregasTour({ onComplete: vi.fn(), onDismiss: vi.fn(), postProcesses: true });
    expect(capturedConfig.current.steps[0].popover.description).toMatch(/Posts individuais/);
  });
});
