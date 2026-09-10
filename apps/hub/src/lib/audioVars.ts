import type { CSSProperties } from 'react';

/** Hub tokens for the shared player + recorder (whitelabel-aware). */
export const HUB_AUDIO_VARS = {
  '--audio-btn-bg': 'var(--hub-primary)',
  '--audio-btn-fg': 'var(--hub-primary-fg)',
  '--audio-btn2-bg': 'transparent',
  '--audio-btn2-fg': 'var(--hub-tx2)',
  '--audio-btn2-bd': 'var(--hub-bd2)',
  '--audio-btn2-hover': 'var(--hub-soft)',
  '--audio-track': 'var(--hub-bd)',
  '--audio-fill': 'var(--hub-txt)',
  '--audio-muted': 'var(--hub-tx3)',
  '--audio-radius': 'var(--hub-r-ctl)',
} as CSSProperties;
