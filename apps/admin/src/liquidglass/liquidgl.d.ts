export {};

interface LiquidGLOptions {
  snapshot?: string | HTMLElement;
  target?: string;
  resolution?: number;
  refraction?: number;
  bevelDepth?: number;
  bevelWidth?: number;
  frost?: number;
  shadow?: boolean;
  specular?: boolean;
  reveal?: string;
  tilt?: boolean;
  tiltFactor?: number;
  magnify?: number;
  on?: { init?: (instance: unknown) => void };
}

interface LiquidGLStatic {
  (options: LiquidGLOptions): unknown;
  registerDynamic: (selector: string | HTMLElement) => void;
  syncWith?: (scroller: unknown) => void;
}

declare global {
  interface Window {
    liquidGL?: LiquidGLStatic;
    html2canvas?: unknown;
  }
}
