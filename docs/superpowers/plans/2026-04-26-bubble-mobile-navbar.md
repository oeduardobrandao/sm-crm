# Bubble Mobile Bottom Navbar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current pill-shaped mobile bottom nav with a bubble-style navbar where the active item floats in a circle above the bar, with a Canvas-rendered cutout and animated transitions.

**Architecture:** Canvas 2D draws the bar background with a circular cutout (using `destination-out` compositing). A floating bubble div holds the active icon. Two-phase animation (drop old → rise new) handles transitions. More sheet is rebuilt as a grouped list mirroring Sidebar routes.

**Tech Stack:** React 19, Canvas 2D API, CSS transitions, Phosphor Icons, Vitest

---

### Task 1: Add Canvas bar drawing utility

**Files:**
- Create: `apps/crm/src/components/layout/mobile-nav-canvas.ts`
- Test: `apps/crm/src/components/layout/__tests__/mobile-nav-canvas.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/crm/src/components/layout/__tests__/mobile-nav-canvas.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { drawNavBar } from '../mobile-nav-canvas'

function createMockCanvas(width: number, height: number) {
  const ops: string[] = []
  const ctx = {
    clearRect: vi.fn(() => ops.push('clearRect')),
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(() => ops.push('beginPath')),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    arc: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(() => ops.push('fill')),
    fillStyle: '',
    globalCompositeOperation: 'source-over',
    ops,
  }
  const canvas = {
    getContext: vi.fn(() => ctx),
    width,
    height,
  }
  return { canvas, ctx }
}

describe('drawNavBar', () => {
  it('draws bar without cutout when amt is 0', () => {
    const { canvas, ctx } = createMockCanvas(780, 240)
    drawNavBar(canvas as unknown as HTMLCanvasElement, '#ffffff', 195, 0)
    expect(ctx.clearRect).toHaveBeenCalled()
    expect(ctx.fill).toHaveBeenCalledTimes(1)
    expect(ctx.globalCompositeOperation).toBe('source-over')
  })

  it('draws bar with circular cutout when amt is 1', () => {
    const { canvas, ctx } = createMockCanvas(780, 240)
    drawNavBar(canvas as unknown as HTMLCanvasElement, '#ffffff', 195, 1)
    expect(ctx.fill).toHaveBeenCalledTimes(2)
    expect(ctx.arc).toHaveBeenCalled()
  })

  it('scales cutout radius by amt', () => {
    const { canvas, ctx } = createMockCanvas(780, 240)
    drawNavBar(canvas as unknown as HTMLCanvasElement, '#ffffff', 100, 0.5)
    const arcCall = ctx.arc.mock.calls[0]
    expect(arcCall[2]).toBeCloseTo(16, 0) // radius = 32 * 0.5
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run apps/crm/src/components/layout/__tests__/mobile-nav-canvas.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// apps/crm/src/components/layout/mobile-nav-canvas.ts

const DPR = typeof window !== 'undefined' ? window.devicePixelRatio || 2 : 2
const W = 390
const H = 120
const BAR_Y = 42
const CORNER_R = 20
const CUTOUT_R = 32
const CUTOUT_CY = 44

export function drawNavBar(
  canvas: HTMLCanvasElement,
  fillColor: string,
  cutoutCX: number,
  amt: number
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const s = canvas.width / W

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.scale(s, s)

  const y = BAR_Y
  const r = CORNER_R

  ctx.beginPath()
  ctx.moveTo(0, y + r)
  ctx.quadraticCurveTo(0, y, r, y)
  ctx.lineTo(W - r, y)
  ctx.quadraticCurveTo(W, y, W, y + r)
  ctx.lineTo(W, H)
  ctx.lineTo(0, H)
  ctx.closePath()
  ctx.fillStyle = fillColor
  ctx.fill()

  if (amt > 0.01) {
    const radius = CUTOUT_R * amt
    ctx.globalCompositeOperation = 'destination-out'
    ctx.beginPath()
    ctx.arc(cutoutCX, CUTOUT_CY, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
  }

  ctx.restore()
}

export function getItemCenterX(index: number, itemCount: number, barWidth = W) {
  const slot = barWidth / itemCount
  return slot * index + slot / 2
}

export { W as BAR_WIDTH, CUTOUT_R, CUTOUT_CY }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run apps/crm/src/components/layout/__tests__/mobile-nav-canvas.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/layout/mobile-nav-canvas.ts apps/crm/src/components/layout/__tests__/mobile-nav-canvas.test.ts
git commit -m "feat(mobile-nav): add canvas bar drawing utility with circle cutout"
```

---

### Task 2: Add bubble animation hook

**Files:**
- Create: `apps/crm/src/components/layout/use-bubble-animation.ts`
- Test: `apps/crm/src/components/layout/__tests__/use-bubble-animation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/crm/src/components/layout/__tests__/use-bubble-animation.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

describe('easing functions', () => {
  it('easeOutCubic returns 0 at t=0 and 1 at t=1', async () => {
    const { easeOutCubic } = await import('../use-bubble-animation')
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
  })

  it('easeInOutCubic returns 0 at t=0, 0.5 at t=0.5, 1 at t=1', async () => {
    const { easeInOutCubic } = await import('../use-bubble-animation')
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(0.5)).toBe(0.5)
    expect(easeInOutCubic(1)).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run apps/crm/src/components/layout/__tests__/use-bubble-animation.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// apps/crm/src/components/layout/use-bubble-animation.ts
import { useRef, useCallback } from 'react'
import { drawNavBar, getItemCenterX } from './mobile-nav-canvas'

export function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3)
}

export function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

const CLOSE_DUR = 280
const OPEN_DUR = 350
const BUBBLE_TOP_UP = 18
const BUBBLE_TOP_DOWN = 38
const BUBBLE_SIZE = 52

interface AnimationRefs {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  bubbleRef: React.RefObject<HTMLDivElement | null>
  fillColor: string
  itemCount: number
}

export function useBubbleAnimation({ canvasRef, bubbleRef, fillColor, itemCount }: AnimationRefs) {
  const animatingRef = useRef(false)

  const positionBubble = useCallback((el: HTMLDivElement, index: number, up: boolean) => {
    const cx = getItemCenterX(index, itemCount)
    el.style.left = `${cx - BUBBLE_SIZE / 2}px`
    el.style.top = `${up ? BUBBLE_TOP_UP : BUBBLE_TOP_DOWN}px`
    el.style.opacity = up ? '1' : '0'
  }, [itemCount])

  const animate = useCallback((fromIndex: number, toIndex: number, onDone: () => void) => {
    const canvas = canvasRef.current
    const bubble = bubbleRef.current
    if (!canvas || !bubble || animatingRef.current) return
    animatingRef.current = true

    const fromX = getItemCenterX(fromIndex, itemCount)
    const toX = getItemCenterX(toIndex, itemCount)
    let start: number | null = null

    bubble.style.transition = `top 0.28s cubic-bezier(0.6, 0, 0.4, 1), opacity 0.18s ease 0.05s`
    positionBubble(bubble, fromIndex, false)

    function closePhase(ts: number) {
      if (!start) start = ts
      const t = Math.min((ts - start) / CLOSE_DUR, 1)
      drawNavBar(canvas!, fillColor, fromX, 1 - easeOutCubic(t))
      if (t < 1) {
        requestAnimationFrame(closePhase)
      } else {
        start = null
        onDone()
        bubble!.style.transition = `top 0.38s cubic-bezier(0.34, 1.56, 0.64, 1) 0.12s, opacity 0.15s ease 0.08s`
        requestAnimationFrame(() => positionBubble(bubble!, toIndex, true))
        requestAnimationFrame(openPhase)
      }
    }

    function openPhase(ts: number) {
      if (!start) start = ts
      const t = Math.min((ts - start) / OPEN_DUR, 1)
      drawNavBar(canvas!, fillColor, toX, easeInOutCubic(t))
      if (t < 1) {
        requestAnimationFrame(openPhase)
      } else {
        animatingRef.current = false
      }
    }

    requestAnimationFrame(closePhase)
  }, [canvasRef, bubbleRef, fillColor, itemCount, positionBubble])

  const initBubble = useCallback((index: number) => {
    const canvas = canvasRef.current
    const bubble = bubbleRef.current
    if (!canvas || !bubble) return
    const cx = getItemCenterX(index, itemCount)
    drawNavBar(canvas, fillColor, cx, 1)
    bubble.style.transition = 'none'
    positionBubble(bubble, index, true)
  }, [canvasRef, bubbleRef, fillColor, itemCount, positionBubble])

  return { animate, initBubble, animatingRef }
}

export { BUBBLE_SIZE, BUBBLE_TOP_UP }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run apps/crm/src/components/layout/__tests__/use-bubble-animation.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/layout/use-bubble-animation.ts apps/crm/src/components/layout/__tests__/use-bubble-animation.test.ts
git commit -m "feat(mobile-nav): add bubble animation hook with easing functions"
```

---

### Task 3: Extract shared nav data from Sidebar

**Files:**
- Create: `apps/crm/src/components/layout/nav-data.ts`
- Modify: `apps/crm/src/components/layout/Sidebar.tsx` — remove `NavItem`, `NavGroup`, `ALL_NAV_GROUPS`, `getNavGroups` (re-export from nav-data)

- [ ] **Step 1: Create the shared nav data module**

```ts
// apps/crm/src/components/layout/nav-data.ts

export interface NavItem { id: string; route: string; label: string; icon: string }
export interface NavGroup { id: string; label: string; icon: string; items: NavItem[]; isBottom?: boolean }

export const ALL_NAV_GROUPS: NavGroup[] = [
  {
    id: 'visao-geral', label: 'Visão Geral', icon: 'ph-squares-four', items: [
      { id: 'dashboard', route: '/dashboard', label: 'Dashboard', icon: 'ph-chart-pie-slice' },
      { id: 'calendario', route: '/calendario', label: 'Calendário', icon: 'ph-calendar-blank' },
    ]
  },
  {
    id: 'crm', label: 'CRM', icon: 'ph-users', items: [
      { id: 'leads', route: '/leads', label: 'Leads', icon: 'ph-funnel' },
      { id: 'clientes', route: '/clientes', label: 'Clientes', icon: 'ph-users' },
      { id: 'ideias', route: '/ideias', label: 'Ideias', icon: 'ph-lightbulb' },
    ]
  },
  {
    id: 'gestao', label: 'Gestão', icon: 'ph-folder', items: [
      { id: 'entregas', route: '/entregas', label: 'Entregas', icon: 'ph-kanban' },
      { id: 'arquivos', route: '/arquivos', label: 'Arquivos', icon: 'ph-folder-open' },
      { id: 'financeiro', route: '/financeiro', label: 'Financeiro', icon: 'ph-wallet' },
      { id: 'contratos', route: '/contratos', label: 'Contratos', icon: 'ph-file-text' },
      { id: 'equipe', route: '/equipe', label: 'Equipe', icon: 'ph-user-circle-gear' },
    ]
  },
  {
    id: 'analytics-group', label: 'Analytics', icon: 'ph-chart-line-up', items: [
      { id: 'analytics', route: '/analytics', label: 'Instagram', icon: 'ph-instagram-logo' },
      { id: 'analytics-fluxos', route: '/analytics-fluxos', label: 'Fluxos', icon: 'ph-flow-arrow' },
    ]
  },
  {
    id: 'config', label: 'Configurações', icon: 'ph-gear', isBottom: true, items: [
      { id: 'configuracao', route: '/configuracao', label: 'Configurações', icon: 'ph-gear' },
      { id: 'politica-de-privacidade', route: '/politica-de-privacidade', label: 'Privacidade', icon: 'ph-shield-check' },
    ]
  },
]

export const PRIMARY_NAV_IDS = ['dashboard', 'clientes', 'analytics', 'entregas']

export function getNavGroups(role: string): NavGroup[] {
  if (role !== 'agent') return ALL_NAV_GROUPS
  return ALL_NAV_GROUPS
    .map(g => {
      if (g.id === 'crm') return { ...g, items: g.items.filter(i => i.id !== 'leads') }
      if (g.id === 'gestao') return { ...g, items: g.items.filter(i => i.id !== 'financeiro' && i.id !== 'contratos') }
      return g
    })
    .filter(g => g.items.length > 0)
}

export function getMoreSheetGroups(role: string): NavGroup[] {
  return getNavGroups(role)
    .map(g => ({
      ...g,
      items: g.items.filter(i => !PRIMARY_NAV_IDS.includes(i.id))
    }))
    .filter(g => g.items.length > 0)
}
```

- [ ] **Step 2: Update Sidebar.tsx to import from nav-data**

Replace lines 1-55 of `apps/crm/src/components/layout/Sidebar.tsx`. Change the local interfaces, `ALL_NAV_GROUPS`, and `getNavGroups` to imports:

```ts
import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { getNavGroups } from './nav-data';
import type { NavGroup } from './nav-data';
```

Delete lines 6-54 (the local `NavItem`, `NavGroup`, `ALL_NAV_GROUPS`, and `getNavGroups`). The rest of the component stays identical — it already uses `navGroups` from `getNavGroups(role)`.

- [ ] **Step 3: Run tests to verify nothing is broken**

Run: `npm run test -- --run`
Expected: All existing tests PASS

- [ ] **Step 4: Run typecheck**

Run: `npm run build`
Expected: Build succeeds (tsc + vite)

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/layout/nav-data.ts apps/crm/src/components/layout/Sidebar.tsx
git commit -m "refactor: extract shared nav data to nav-data.ts for Sidebar and MobileNav reuse"
```

---

### Task 4: Rewrite MobileNav component — primary bar

**Files:**
- Modify: `apps/crm/src/components/layout/MobileNav.tsx` — full rewrite

- [ ] **Step 1: Rewrite MobileNav.tsx with canvas bar + bubble**

```tsx
// apps/crm/src/components/layout/MobileNav.tsx
import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { getMoreSheetGroups } from './nav-data'
import { drawNavBar, getItemCenterX, BAR_WIDTH } from './mobile-nav-canvas'
import { useBubbleAnimation, BUBBLE_SIZE } from './use-bubble-animation'

const PRIMARY_ITEMS = [
  { id: 'dashboard', route: '/dashboard', label: 'Dashboard', icon: 'ph-chart-pie-slice' },
  { id: 'clientes', route: '/clientes', label: 'Clientes', icon: 'ph-users' },
  { id: 'analytics', route: '/analytics', label: 'Analytics', icon: 'ph-chart-line-up' },
  { id: 'entregas', route: '/entregas', label: 'Entregas', icon: 'ph-kanban' },
]

const DPR = typeof window !== 'undefined' ? window.devicePixelRatio || 2 : 2

function getActiveIndex(pathname: string): number {
  const idx = PRIMARY_ITEMS.findIndex(item => pathname.startsWith(item.route))
  return idx >= 0 ? idx : -1
}

export default function MobileNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const { profile, role, signOut } = useAuth()
  const [moreOpen, setMoreOpen] = useState(false)
  const [isDark, setIsDark] = useState(document.documentElement.getAttribute('data-theme') === 'dark')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const activeIndexRef = useRef(-1)

  const fillColor = isDark ? '#1a1e26' : '#ffffff'
  const itemCount = PRIMARY_ITEMS.length + 1 // 4 items + More

  const { animate, initBubble, animatingRef } = useBubbleAnimation({
    canvasRef,
    bubbleRef,
    fillColor,
    itemCount,
  })

  const activeIndex = getActiveIndex(location.pathname)

  useEffect(() => {
    if (activeIndex >= 0) {
      if (activeIndexRef.current === -1) {
        initBubble(activeIndex)
      } else if (activeIndexRef.current !== activeIndex && !animatingRef.current) {
        animate(activeIndexRef.current, activeIndex, () => {})
      }
      activeIndexRef.current = activeIndex
    }
  }, [activeIndex, animate, initBubble, animatingRef])

  useEffect(() => {
    if (activeIndex >= 0 && canvasRef.current) {
      const cx = getItemCenterX(activeIndex, itemCount)
      drawNavBar(canvasRef.current, fillColor, cx, 1)
    }
  }, [isDark])

  const go = (route: string) => {
    navigate(route)
    setMoreOpen(false)
  }

  const handleNavClick = (index: number) => {
    if (animatingRef.current) return
    go(PRIMARY_ITEMS[index].route)
  }

  const toggleTheme = () => {
    const next = isDark ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next === 'dark' ? 'dark' : '')
    if (next === 'light') document.documentElement.removeAttribute('data-theme')
    localStorage.setItem('theme', next)
    setIsDark(next === 'dark')
  }

  const initials = profile?.nome
    ? profile.nome.split(' ').map((w: string) => w?.[0] || '').join('').substring(0, 2).toUpperCase()
    : 'U'

  const activeItem = activeIndex >= 0 ? PRIMARY_ITEMS[activeIndex] : null
  const moreSheetGroups = getMoreSheetGroups(role)

  return (
    <>
      <nav className="mobile-nav-bubble" id="mobile-nav">
        <div className="mobile-nav-wrap">
          <canvas
            ref={canvasRef}
            className="mobile-nav-canvas"
            width={BAR_WIDTH * DPR}
            height={120 * DPR}
          />

          <div ref={bubbleRef} className="mobile-nav-bubble-circle">
            {activeItem && (
              <i className={`ph-fill ${activeItem.icon}`} />
            )}
          </div>

          <div className="mobile-nav-items">
            {PRIMARY_ITEMS.map((item, i) => (
              <button
                key={item.id}
                className={`mobile-nav-item${activeIndex === i ? ' active' : ''}`}
                onClick={() => handleNavClick(i)}
                type="button"
              >
                <div className="icon-wrap">
                  <i className={`${activeIndex === i ? 'ph-fill' : 'ph'} ${item.icon}`} />
                </div>
                <span className="nav-label">{item.label}</span>
              </button>
            ))}

            <button
              id="mobile-more-btn"
              className="mobile-nav-item"
              onClick={() => setMoreOpen(v => !v)}
              type="button"
            >
              <div className="icon-wrap">
                <i className="ph ph-dots-three" />
              </div>
              <span className="nav-label">Mais</span>
            </button>
          </div>
        </div>
      </nav>

      {/* More Sheet Overlay */}
      <div
        className={`mobile-more-overlay${moreOpen ? ' visible' : ''}`}
        onClick={() => setMoreOpen(false)}
      >
        <div className="mobile-more-sheet" onClick={e => e.stopPropagation()}>
          {/* Profile */}
          <div className="mobile-more-profile" id="mobile-profile">
            <div className="avatar" id="mobile-avatar">{initials}</div>
            <div className="mobile-more-profile-info">
              <div className="mobile-more-profile-name" id="mobile-user-name">
                {profile?.nome || 'Minha Conta'}
              </div>
              <div className="mobile-more-profile-plan">
                {profile?.plano?.toUpperCase() || 'FREE'}
              </div>
            </div>
          </div>

          <div className="mobile-more-divider" />

          {/* Grouped nav items */}
          {moreSheetGroups.map(group => (
            <div key={group.id}>
              <div className="mobile-more-group-label">{group.label}</div>
              {group.items.map(item => {
                const isActive = location.pathname.startsWith(item.route)
                return (
                  <button
                    key={item.id}
                    className={`mobile-more-item${isActive ? ' active' : ''}`}
                    onClick={() => go(item.route)}
                    type="button"
                  >
                    <div className="mobile-more-item-icon">
                      <i className={`${isActive ? 'ph-fill' : 'ph'} ${item.icon}`} />
                    </div>
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </div>
          ))}

          <div className="mobile-more-divider" />

          {/* Actions */}
          <button
            id="mobile-theme-toggle"
            className="mobile-more-item"
            onClick={toggleTheme}
            type="button"
          >
            <div className="mobile-more-item-icon">
              <i className={`ph ${isDark ? 'ph-sun' : 'ph-moon'}`} />
            </div>
            <span>{isDark ? 'Modo Claro' : 'Modo Escuro'}</span>
          </button>

          <button
            id="mobile-logout-btn"
            className="mobile-more-item danger"
            onClick={signOut}
            type="button"
          >
            <div className="mobile-more-item-icon">
              <i className="ph ph-sign-out" />
            </div>
            <span>Sair</span>
          </button>
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run build`
Expected: May fail if CSS classes don't exist yet — that's fine, fix in Task 5.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/components/layout/MobileNav.tsx
git commit -m "feat(mobile-nav): rewrite primary bar with canvas cutout + bubble + grouped more sheet"
```

---

### Task 5: Replace CSS styles

**Files:**
- Modify: `apps/crm/style.css` — replace mobile nav styles (lines ~1519-1817)

- [ ] **Step 1: Remove old `.mobile-nav` styles and add new `.mobile-nav-bubble` styles**

Find the block starting with the comment or the `@media (max-width: 900px)` section that contains `.mobile-nav` styles (approximately lines 1519-1817). Replace all `.mobile-nav` related rules with the new styles below. Keep the `.main-content` bottom-padding rule and `.crisp-client` transform.

```css
/* ===== MOBILE NAV — BUBBLE STYLE ===== */

.mobile-nav-bubble {
  display: none;
}

@media (max-width: 900px) {
  .mobile-nav-bubble {
    display: block;
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 1000;
    height: 120px;
    pointer-events: none;
  }

  .mobile-nav-wrap {
    position: relative;
    width: 100%;
    height: 100%;
    pointer-events: auto;
  }

  .mobile-nav-canvas {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 120px;
  }

  /* Floating bubble circle */
  .mobile-nav-bubble-circle {
    position: absolute;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: #12151a;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
    pointer-events: none;
  }

  [data-theme="dark"] .mobile-nav-bubble-circle {
    background: #1e2430;
  }

  .mobile-nav-bubble-circle i {
    font-size: 1.35rem;
    color: #ffffff;
  }

  [data-theme="dark"] .mobile-nav-bubble-circle i {
    color: #e8eaf0;
  }

  /* Nav items row */
  .mobile-nav-items {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 68px;
    display: flex;
    align-items: center;
    justify-content: space-around;
    z-index: 5;
    padding: 0 0.25rem;
  }

  .mobile-nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    background: none;
    border: none;
    cursor: pointer;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    width: 64px;
    padding: 0;
    font-family: var(--font-main);
  }

  .mobile-nav-item .icon-wrap {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 0.25s ease;
  }

  .mobile-nav-item.active .icon-wrap {
    opacity: 0;
    visibility: hidden;
  }

  .mobile-nav-item i {
    font-size: 1.35rem;
    color: #b0b5be;
    transition: color 0.25s ease;
  }

  [data-theme="dark"] .mobile-nav-item i {
    color: #4a4f5a;
  }

  .mobile-nav-item .nav-label {
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.2px;
    color: #b0b5be;
    transition: color 0.25s ease;
  }

  [data-theme="dark"] .mobile-nav-item .nav-label {
    color: #4a4f5a;
  }

  .mobile-nav-item.active .nav-label {
    color: #12151a;
    font-weight: 700;
  }

  [data-theme="dark"] .mobile-nav-item.active .nav-label {
    color: #e8eaf0;
  }

  .mobile-nav-item:not(.active):active .icon-wrap {
    transform: scale(0.9);
  }

  /* ===== MORE SHEET ===== */

  .mobile-more-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: 999;
    opacity: 0;
    transition: opacity 0.3s ease;
  }

  .mobile-more-overlay.visible {
    display: block;
    opacity: 1;
  }

  .mobile-more-sheet {
    position: absolute;
    bottom: 7rem;
    left: 1.25rem;
    right: 1.25rem;
    background: var(--surface-main);
    border-radius: 24px;
    padding: 0.75rem 0;
    max-height: calc(100svh - 9rem);
    overflow-y: auto;
    transform: translateY(120%);
    transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.4s ease;
    opacity: 0;
  }

  .mobile-more-overlay.visible .mobile-more-sheet {
    transform: translateY(0);
    opacity: 1;
  }

  /* Profile */
  .mobile-more-profile {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    margin: 0 0.5rem 0.25rem;
    border-radius: 14px;
  }

  .mobile-more-profile .avatar {
    width: 38px;
    height: 38px;
    min-width: 38px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.8rem;
    font-weight: 700;
    background: var(--text-main);
    color: var(--surface-main);
  }

  .mobile-more-profile-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .mobile-more-profile-name {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--text-main);
  }

  .mobile-more-profile-plan {
    font-size: 0.68rem;
    font-weight: 500;
    color: var(--text-light);
    font-family: var(--font-mono);
  }

  /* Group labels */
  .mobile-more-group-label {
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-light);
    padding: 0.75rem 1.25rem 0.35rem;
  }

  /* Items */
  .mobile-more-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.65rem 1.25rem;
    background: none;
    border: none;
    border-radius: 0;
    cursor: pointer;
    font-family: var(--font-main);
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--text-main);
    text-align: left;
    transition: background 0.15s ease;
  }

  .mobile-more-item:active {
    background: var(--surface-hover);
  }

  .mobile-more-item.active {
    color: var(--primary-color);
  }

  .mobile-more-item-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-hover);
    flex-shrink: 0;
  }

  .mobile-more-item.active .mobile-more-item-icon {
    background: rgba(234, 179, 8, 0.12);
  }

  .mobile-more-item-icon i {
    font-size: 1.15rem;
    color: var(--text-muted);
  }

  .mobile-more-item.active .mobile-more-item-icon i {
    color: var(--primary-color);
  }

  /* Danger item */
  .mobile-more-item.danger {
    color: var(--danger);
  }

  .mobile-more-item.danger .mobile-more-item-icon i {
    color: var(--danger);
  }

  .mobile-more-item.danger:active {
    background: rgba(245, 90, 66, 0.08);
  }

  /* Divider */
  .mobile-more-divider {
    height: 1px;
    background: var(--border-color);
    margin: 0.35rem 1.25rem;
  }

  /* Bottom padding for main content */
  .main-content {
    margin-left: 0;
    padding: 1rem;
    padding-bottom: calc(80px + env(safe-area-inset-bottom, 0));
  }

  .crisp-client {
    transform: translateY(-5.5rem);
  }
}
```

- [ ] **Step 2: Run the dev server and test visually on mobile viewport**

Run: `npm run dev`
Open in browser at mobile width (390px). Verify:
- Bar is full-width, flush bottom/left/right
- Bubble floats above bar for active item
- Circular cutout visible in bar
- Click items to see animation
- More sheet opens with grouped items
- Light/dark theme works

- [ ] **Step 3: Commit**

```bash
git add apps/crm/style.css
git commit -m "style(mobile-nav): replace pill nav styles with bubble navbar + redesigned more sheet"
```

---

### Task 6: Update tests

**Files:**
- Modify: `apps/crm/src/components/layout/__tests__/MobileNav.test.tsx`

- [ ] **Step 1: Rewrite tests for new markup**

```tsx
// apps/crm/src/components/layout/__tests__/MobileNav.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../../../context/AuthContext'

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}))

const mockedUseAuth = vi.mocked(useAuth)

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
  // Mock canvas getContext since jsdom doesn't support it
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

  // Lazy import to avoid hoisting issues with canvas mock
  const MobileNav = require('../MobileNav').default

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
  })

  it('marks active item and shows profile in more sheet', async () => {
    setAuth()
    renderMobileNav('/analytics')

    // Active label should be visible
    const labels = document.querySelectorAll('.mobile-nav-item')
    const analyticsItem = Array.from(labels).find(el => el.textContent?.includes('Analytics'))
    expect(analyticsItem?.classList.contains('active')).toBe(true)

    // Open more sheet
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
```

- [ ] **Step 2: Run tests**

Run: `npm run test -- --run apps/crm/src/components/layout/__tests__/MobileNav.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 3: Run the full test suite**

Run: `npm run test -- --run`
Expected: All tests PASS

- [ ] **Step 4: Run typecheck**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/layout/__tests__/MobileNav.test.tsx
git commit -m "test(mobile-nav): update tests for bubble navbar markup and all sidebar routes"
```

---

### Task 7: Visual QA and polish

**Files:**
- May touch: `apps/crm/style.css`, `apps/crm/src/components/layout/MobileNav.tsx`, `apps/crm/src/components/layout/mobile-nav-canvas.ts`

- [ ] **Step 1: Test on dev server**

Run: `npm run dev`

Test in browser with mobile viewport (390px width):
1. All 4 primary items show icons + labels
2. Active item has bubble floating above bar with cutout
3. Clicking items triggers drop→rise animation
4. "Mais" button opens more sheet with all grouped routes
5. More sheet groups match Sidebar (Visão Geral, CRM, Gestão, Analytics, Configurações)
6. Active page is highlighted in more sheet with yellow
7. Theme toggle works (canvas redraws with correct color)
8. Sign out works
9. Dark mode styling is correct
10. No visual artifacts in the cutout gap

- [ ] **Step 2: Test edge cases**

1. Navigate directly to a non-primary route (e.g., `/leads`) — no bubble should show (activeIndex = -1)
2. Resize window — bar stays flush to edges
3. Rapid clicking between items — animation shouldn't break (animatingRef guard)
4. Safe area on notched devices — bottom padding should account for it

- [ ] **Step 3: Fix any issues found, commit**

```bash
git add -u
git commit -m "fix(mobile-nav): visual polish and edge case fixes"
```

---

Plan complete and saved to `docs/superpowers/plans/2026-04-26-bubble-mobile-navbar.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?