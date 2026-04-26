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
