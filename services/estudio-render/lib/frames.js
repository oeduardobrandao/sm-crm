// Frame classification — pure logic, no wasm. Encodes spec §4 (frames → Instagram mapping):
// a frame is publishable when its ASPECT RATIO matches a preset (±0.5%); export always
// happens at the preset's pixel size regardless of on-canvas frame size. Non-preset aspect
// ratios are scratch space. Order: numeric name prefix wins, then left-to-right x.

const PRESETS = [
  { aspect: '1:1', ratio: 1, width: 1080, height: 1080 },
  { aspect: '4:5', ratio: 4 / 5, width: 1080, height: 1350 },
  { aspect: '9:16', ratio: 9 / 16, width: 1080, height: 1920 },
]
const TOLERANCE = 0.005
const CAROUSEL_MAX = 10 // Instagram Graph API hard cap

function presetFor(frame) {
  if (!frame.width || !frame.height) return null
  const ratio = frame.width / frame.height
  return PRESETS.find((p) => Math.abs(ratio - p.ratio) / p.ratio <= TOLERANCE) ?? null
}

function orderKey(frame) {
  const m = /^(\d+)/.exec(frame.name ?? '')
  // numbered frames sort before unnumbered ones; unnumbered order left-to-right
  return m ? { bucket: 0, key: Number(m[1]) } : { bucket: 1, key: frame.x ?? 0 }
}

/**
 * @param {Array<{id: string, name: string, x: number, width: number, height: number}>} frames
 * @param {'feed'|'carrossel'|'reels'} tipo — the post's current tipo (drives reel-cover rules)
 */
export function classifyFrames(frames, tipo) {
  const errors = []

  const annotated = frames.map((f) => {
    const preset = presetFor(f)
    return {
      id: f.id,
      name: f.name,
      x: f.x,
      aspect: preset?.aspect ?? null,
      exportSize: preset ? { width: preset.width, height: preset.height } : null,
      publishable: !!preset,
    }
  })

  annotated.sort((a, b) => {
    const ka = orderKey(a)
    const kb = orderKey(b)
    return ka.bucket - kb.bucket || ka.key - kb.key
  })
  annotated.forEach((f, i) => {
    f.order = i
  })

  if (tipo === 'reels') {
    // Only the cover publishes for a reel: the first 9:16 frame, everything else is scratch.
    const cover = annotated.find((f) => f.aspect === '9:16')
    for (const f of annotated) f.publishable = f === cover
    if (!cover) errors.push({ code: 'no_cover_frame', message: 'Um reel precisa de um frame 9:16 para a capa.' })
    return {
      validation: { ok: errors.length === 0, errors },
      derived: { format: cover ? 'reel_cover' : null, tipo: 'reels' },
      frames: annotated,
    }
  }

  const publishable = annotated.filter((f) => f.publishable)

  if (publishable.length === 0) {
    errors.push({ code: 'no_publishable_frames', message: 'Nenhum frame com proporção 1:1, 4:5 ou 9:16.' })
  }
  if (publishable.length > CAROUSEL_MAX) {
    errors.push({ code: 'too_many_frames', message: `O Instagram aceita no máximo ${CAROUSEL_MAX} imagens por carrossel.` })
  }
  if (publishable.length > 1 && new Set(publishable.map((f) => f.aspect)).size > 1) {
    errors.push({ code: 'mixed_aspects', message: 'Todos os frames de um carrossel precisam ter a mesma proporção.' })
  }

  const derivedTipo = publishable.length === 0 ? null : publishable.length === 1 ? 'feed' : 'carrossel'
  return {
    validation: { ok: errors.length === 0, errors },
    derived: { format: derivedTipo, tipo: derivedTipo },
    frames: annotated,
  }
}

export { CAROUSEL_MAX, PRESETS }
