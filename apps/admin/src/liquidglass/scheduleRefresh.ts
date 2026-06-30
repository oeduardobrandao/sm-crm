/** Run `cb` after two animation frames (lets a route's new content paint first). */
export function doubleRaf(
  cb: () => void,
  raf: (cb: FrameRequestCallback) => number = requestAnimationFrame,
): void {
  raf(() => raf(() => cb()));
}
