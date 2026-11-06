import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useGuideMock, captureEventMock, toastSuccessMock } = vi.hoisted(() => ({
  useGuideMock: vi.fn(),
  captureEventMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock('../../guide/GuideContext', () => ({ useGuide: useGuideMock }));
vi.mock('../../../lib/analytics', () => ({ captureEvent: captureEventMock }));
vi.mock('sonner', () => ({ toast: { success: toastSuccessMock } }));

import VidroIntro from '../VidroIntro';
import { readIntroSeen } from '../../../lib/vidroLook';

function renderIntro(onClassic = vi.fn()) {
  render(<VidroIntro userId="u1" onClassic={onClassic} openDelayMs={0} />);
  act(() => {
    vi.runAllTimers();
  });
  return onClassic;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useGuideMock.mockReturnValue({ autoOpen: 'no', isOpen: false });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  document.documentElement.removeAttribute('data-theme');
});

describe('VidroIntro', () => {
  it('announces the new look and records it as seen', () => {
    renderIntro();
    expect(screen.getByRole('heading', { name: 'O Mesaas está de visual novo' })).toBeVisible();
    expect(screen.getByText('Visual clássico')).toBeInTheDocument();
    expect(document.querySelector('img')).toHaveAttribute('src', '/vidro-intro-light.webp');
    expect(readIntroSeen('u1')).toBe(true);
    expect(captureEventMock).toHaveBeenCalledWith('vidro_intro_shown');
  });

  it('uses the dark picture under the dark theme', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    renderIntro();
    expect(document.querySelector('img')).toHaveAttribute('src', '/vidro-intro-dark.webp');
  });

  it('closes on "Continuar no novo" without touching the look', () => {
    const onClassic = renderIntro();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar no novo' }));
    expect(screen.queryByRole('heading', { name: 'O Mesaas está de visual novo' })).toBeNull();
    expect(onClassic).not.toHaveBeenCalled();
    expect(captureEventMock).toHaveBeenCalledWith('vidro_intro_dismissed', { how: 'continue' });
  });

  it('switches to classic and says where to switch back', () => {
    const onClassic = renderIntro();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao clássico' }));
    expect(onClassic).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).toHaveBeenCalledWith('Visual clássico ativado', {
      description: 'Para usar o visual novo, escolha Visual novo no menu do seu perfil.',
    });
    expect(screen.queryByRole('heading', { name: 'O Mesaas está de visual novo' })).toBeNull();
  });

  it('yields to the onboarding guide and does not come back', () => {
    useGuideMock.mockReturnValue({ autoOpen: 'yes', isOpen: false });
    renderIntro();
    expect(screen.queryByRole('heading', { name: 'O Mesaas está de visual novo' })).toBeNull();
    expect(readIntroSeen('u1')).toBe(true);
  });

  it('waits while the guide state is unknown', () => {
    useGuideMock.mockReturnValue({ autoOpen: 'unknown', isOpen: false });
    renderIntro();
    expect(screen.queryByRole('heading', { name: 'O Mesaas está de visual novo' })).toBeNull();
    expect(readIntroSeen('u1')).toBe(false);
  });
});
