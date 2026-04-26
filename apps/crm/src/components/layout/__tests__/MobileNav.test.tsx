import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../../../context/AuthContext'
import { useBubbleAnimation } from '../use-bubble-animation'

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../mobile-nav-canvas', () => ({
  drawNavBar: vi.fn(),
  getItemCenterX: vi.fn().mockReturnValue(50),
  BAR_WIDTH: 390,
  CUTOUT_R: 32,
  CUTOUT_CY: 44,
}))

vi.mock('../use-bubble-animation', () => ({
  useBubbleAnimation: vi.fn(),
  BUBBLE_SIZE: 52,
  BUBBLE_TOP_UP: 18,
}))

import MobileNav from '../MobileNav'

const mockedUseAuth = vi.mocked(useAuth)
const mockedUseBubbleAnimation = vi.mocked(useBubbleAnimation)

function PathProbe() {
  const loc = useLocation()
  return <div data-testid="path">{loc.pathname}</div>
}

function setAuth(overrides: Record<string, unknown> = {}) {
  mockedUseAuth.mockReturnValue({
    user: { id: '1' } as any,
    session: {} as any,
    profile: {
      id: '1',
      nome: 'Ana Maria',
      role: 'owner',
      conta_id: 'c1',
      ...overrides,
    } as any,
    role: (overrides.role as string) || 'owner',
    loading: false,
    signOut: overrides.signOut as any || vi.fn(),
    refreshProfile: vi.fn(),
  } as any)
}

function renderMobileNav(pathname = '/dashboard') {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    arc: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    fillStyle: '',
    globalCompositeOperation: 'source-over',
  }) as any

  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route path="*" element={<><MobileNav /><PathProbe /></>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('MobileNav', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
    localStorage.clear()
    mockedUseBubbleAnimation.mockReturnValue({
      animate: vi.fn(),
      initBubble: vi.fn(),
      animatingRef: { current: false },
    } as any)
  })

  it('marks active item and shows profile in more sheet', async () => {
    setAuth()
    renderMobileNav('/analytics')

    const labels = document.querySelectorAll('.mobile-nav-item')
    const analyticsItem = Array.from(labels).find(el => el.textContent?.includes('Analytics'))
    expect(analyticsItem?.classList.contains('active')).toBe(true)

    fireEvent.click(document.getElementById('mobile-more-btn')!)
    expect(document.getElementById('mobile-avatar')?.textContent).toBe('AM')
    expect(document.getElementById('mobile-user-name')?.textContent).toBe('Ana Maria')
  })

  it('navigates from more sheet and closes it', async () => {
    setAuth()
    renderMobileNav('/dashboard')

    fireEvent.click(document.getElementById('mobile-more-btn')!)

    const configBtn = Array.from(document.querySelectorAll('.mobile-more-item'))
      .find(el => el.textContent?.includes('Configurações'))
    expect(configBtn).toBeTruthy()
    fireEvent.click(configBtn!)

    await waitFor(() => {
      expect(screen.getByTestId('path').textContent).toBe('/configuracao')
    })
    expect(document.querySelector('.mobile-more-overlay.visible')).toBeNull()
  })

  it('includes all sidebar routes in more sheet', () => {
    setAuth()
    renderMobileNav('/dashboard')
    fireEvent.click(document.getElementById('mobile-more-btn')!)

    const items = Array.from(document.querySelectorAll('.mobile-more-item'))
      .map(el => el.textContent?.trim())

    expect(items).toContain('Calendário')
    expect(items).toContain('Leads')
    expect(items).toContain('Ideias')
    expect(items).toContain('Arquivos')
    expect(items).toContain('Fluxos')
    expect(items).toContain('Privacidade')
  })

  it('toggles theme and signs out', async () => {
    const signOut = vi.fn()
    setAuth({ signOut })
    renderMobileNav('/dashboard')

    fireEvent.click(document.getElementById('mobile-more-btn')!)
    fireEvent.click(document.getElementById('mobile-theme-toggle')!)

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem('theme')).toBe('dark')

    fireEvent.click(document.getElementById('mobile-logout-btn')!)
    expect(signOut).toHaveBeenCalled()
  })
})
