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
