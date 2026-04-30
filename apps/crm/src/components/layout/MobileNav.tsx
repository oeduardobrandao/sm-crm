import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { getMoreSheetGroups } from './nav-data'
import { drawNavBar, getItemCenterX, BAR_WIDTH } from './mobile-nav-canvas'
import { useBubbleAnimation, BUBBLE_SIZE } from './use-bubble-animation'
import { Search, MessageCircle } from 'lucide-react'
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
} from '@/components/ui/command'

declare global {
  interface Window {
    $crisp?: Array<unknown[]>;
  }
}

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
  const { t } = useTranslation()
  const [moreOpen, setMoreOpen] = useState(false)
  const [isDark, setIsDark] = useState(document.documentElement.getAttribute('data-theme') === 'dark')
  const [searchOpen, setSearchOpen] = useState(false)

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
    } else {
      if (bubbleRef.current) {
        bubbleRef.current.style.opacity = '0'
      }
      if (canvasRef.current) {
        drawNavBar(canvasRef.current, fillColor, -100, 0)
      }
      activeIndexRef.current = -1
    }
  }, [activeIndex, animate, initBubble, animatingRef, fillColor])

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
                {(profile?.plano as string | undefined)?.toUpperCase() || 'FREE'}
              </div>
            </div>
          </div>

          <div className="mobile-more-divider" />

          {/* Quick actions */}
          <button
            className="mobile-more-item"
            onClick={() => { setMoreOpen(false); setSearchOpen(true); }}
            type="button"
          >
            <div className="mobile-more-item-icon">
              <Search size={18} />
            </div>
            <span>Buscar</span>
          </button>

          <button
            className="mobile-more-item"
            onClick={() => { window.$crisp?.push(['do', 'chat:open']); setMoreOpen(false); }}
            type="button"
          >
            <div className="mobile-more-item-icon">
              <MessageCircle size={18} />
            </div>
            <span>Chat</span>
          </button>

          <div className="mobile-more-divider" />

          {/* Grouped nav items */}
          {moreSheetGroups.map(group => (
            <div key={group.id}>
              <div className="mobile-more-group-label">{t(group.labelKey, group.label)}</div>
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
                    <span>{t(item.labelKey, item.label)}</span>
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
      <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
        <CommandInput placeholder="Buscar..." />
        <CommandList>
          <CommandEmpty>Nenhum resultado.</CommandEmpty>
        </CommandList>
      </CommandDialog>
    </>
  )
}
