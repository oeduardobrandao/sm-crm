export type Adjustment = {
  width: number;
  height: number;
  mode: 'crop' | 'fit';
  zoom: number;
  /** Normalized position across the available overflow, 0 = left/top. */
  x: number;
  y: number;
  background: 'blur' | 'solid';
  color: string;
};

export const FEED_PRESETS = [
  { label: '1:1', width: 1080, height: 1080 },
  { label: '4:5', width: 1080, height: 1350 },
  { label: '3:4', width: 1080, height: 1440 },
  // Round height UP: 1080 / 565 exceeds the API's 1.91 upper bound.
  { label: '1,91:1', width: 1080, height: 566 },
];
export const PORTRAIT_PRESET = { label: '9:16', width: 1080, height: 1920 };
export function getPresets(kind: 'image' | 'video', forStories: boolean) {
  return kind === 'video' || forStories ? [PORTRAIT_PRESET] : FEED_PRESETS;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function getPlacement(
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  mode: Adjustment['mode'],
  zoom: number,
  x: number,
  y: number,
) {
  if (![sourceWidth, sourceHeight, width, height].every((v) => Number.isFinite(v) && v > 0)) {
    throw new Error('Dimensões inválidas');
  }
  const scale =
    mode === 'fit'
      ? Math.min(width / sourceWidth, height / sourceHeight)
      : Math.max(width / sourceWidth, height / sourceHeight) * clamp(zoom, 1, 3);
  const w = sourceWidth * scale;
  const h = sourceHeight * scale;
  return {
    x: (width - w) * (mode === 'fit' ? 0.5 : clamp(x, 0, 1)),
    y: (height - h) * (mode === 'fit' ? 0.5 : clamp(y, 0, 1)),
    width: w,
    height: h,
  };
}

export function videoArguments(
  a: Adjustment,
  sw: number,
  sh: number,
  duration: number,
  maxBytes: number,
) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Duração inválida');
  const color = /^#[0-9a-f]{6}$/i.test(a.color) ? a.color.slice(1) : '12151a';
  // Crop before scaling: a very narrow input must not allocate a 100,000-pixel
  // intermediate frame. The last crop absorbs source-pixel rounding without stretch.
  const cropFilter = (zoom: number, x: number, y: number) => {
    const p = getPlacement(sw, sh, a.width, a.height, 'crop', zoom, x, y);
    const cw = Math.min(sw, Math.max(1, Math.ceil((a.width * sw) / p.width)));
    const ch = Math.min(sh, Math.max(1, Math.ceil((a.height * sh) / p.height)));
    const cx = Math.floor((sw - cw) * clamp(x, 0, 1));
    const cy = Math.floor((sh - ch) * clamp(y, 0, 1));
    return `crop=${cw}:${ch}:${cx}:${cy}:exact=1,scale=${a.width}:${a.height}:force_original_aspect_ratio=increase,crop=${a.width}:${a.height}`;
  };
  let filter: string;
  if (a.mode === 'crop') {
    filter = `[0:v]${cropFilter(a.zoom, a.x, a.y)},setsar=1[v]`;
  } else if (a.background === 'solid') {
    filter = `[0:v]scale=${a.width}:${a.height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${a.width}:${a.height}:(ow-iw)/2:(oh-ih)/2:color=0x${color},setsar=1[v]`;
  } else {
    filter = `[0:v]split[bg][fg];[bg]${cropFilter(1.08, 0.5, 0.5)},boxblur=20:2[blur];[fg]scale=${a.width}:${a.height}:force_original_aspect_ratio=decrease:force_divisible_by=2[front];[blur][front]overlay=(W-w)/2:(H-h)/2,setsar=1[v]`;
  }
  // Leave room for audio/container overhead; validate actual bytes after encoding.
  const bitrate = Math.floor(Math.min(8_000_000, (maxBytes * 8 * 0.88) / duration - 128_000));
  if (bitrate < 100_000) throw new Error('Não foi possível ajustar o vídeo ao limite de tamanho.');
  return [
    '-i',
    'input',
    '-filter_complex',
    filter,
    '-map',
    '[v]',
    '-map',
    '0:a:0?',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '30',
    '-b:v',
    String(bitrate),
    '-maxrate',
    String(Math.min(25_000_000, bitrate * 2)),
    '-bufsize',
    String(bitrate * 2),
    '-g',
    '60',
    '-flags',
    '+cgop',
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    '-use_editlist',
    '0',
    '-map_metadata',
    '-1',
    'output.mp4',
  ];
}
