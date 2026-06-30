/** Tuned for a dark backdrop; resolution kept modest for perf. */
export const LIQUID_GL_OPTIONS = {
  snapshot: '#admin-snapshot', // wrapper that includes backdrop + content, excludes the canvas
  target: '.liquidGL',
  resolution: 1.2,
  refraction: 0.012,
  bevelDepth: 0.08,
  bevelWidth: 0.15,
  frost: 0.04,
  shadow: true,
  specular: true,
  reveal: 'fade',
  tilt: true,
  tiltFactor: 4,
  magnify: 1.05,
} as const;
