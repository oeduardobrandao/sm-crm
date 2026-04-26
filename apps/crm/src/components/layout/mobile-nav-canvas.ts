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
