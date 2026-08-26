import { describe, expect, it } from 'vitest';
import { shouldAutoOpenGuide } from '../guideGating';
import { EMPTY_PROGRESS } from '../guideStorage';

const OK = {
  authLoading: false,
  isOwner: true,
  pathname: '/dashboard',
  progress: { ...EMPTY_PROGRESS },
  clientes: { status: 'success', count: 0 },
  workflows: { status: 'success', count: 0 },
};

describe('shouldAutoOpenGuide', () => {
  it('abre para dono, no dashboard, workspace vazio, queries success', () => {
    expect(shouldAutoOpenGuide(OK)).toBe(true);
  });

  it('nunca abre para não-dono ou durante o loading do auth', () => {
    expect(shouldAutoOpenGuide({ ...OK, isOwner: false })).toBe(false);
    expect(shouldAutoOpenGuide({ ...OK, authLoading: true })).toBe(false);
  });

  it('só abre em /dashboard', () => {
    expect(shouldAutoOpenGuide({ ...OK, pathname: '/clientes' })).toBe(false);
  });

  it('abre no máximo uma vez: autoOpenedAt, dismissedAt ou concludedAt bloqueiam', () => {
    expect(
      shouldAutoOpenGuide({ ...OK, progress: { ...OK.progress, autoOpenedAt: 'x' } }),
    ).toBe(false);
    expect(
      shouldAutoOpenGuide({ ...OK, progress: { ...OK.progress, dismissedAt: 'x' } }),
    ).toBe(false);
    expect(
      shouldAutoOpenGuide({ ...OK, progress: { ...OK.progress, concludedAt: 'x' } }),
    ).toBe(false);
  });

  it('erro ou pending NUNCA conta como vazio', () => {
    expect(
      shouldAutoOpenGuide({ ...OK, clientes: { status: 'error', count: 0 } }),
    ).toBe(false);
    expect(
      shouldAutoOpenGuide({ ...OK, workflows: { status: 'pending', count: 0 } }),
    ).toBe(false);
  });

  it('workspace com dados não abre', () => {
    expect(shouldAutoOpenGuide({ ...OK, clientes: { status: 'success', count: 3 } })).toBe(false);
    expect(shouldAutoOpenGuide({ ...OK, workflows: { status: 'success', count: 1 } })).toBe(false);
  });
});
