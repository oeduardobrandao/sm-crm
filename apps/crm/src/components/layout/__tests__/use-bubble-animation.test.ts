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
