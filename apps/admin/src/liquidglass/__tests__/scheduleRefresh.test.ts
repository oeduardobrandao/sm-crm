import { describe, it, expect } from 'vitest';
import { doubleRaf } from '../scheduleRefresh';

describe('doubleRaf', () => {
  it('invokes the callback after two animation frames', () => {
    const calls: string[] = [];
    const fakeRaf = (cb: FrameRequestCallback) => {
      calls.push('raf');
      cb(0);
      return 0;
    };
    let ran = false;
    doubleRaf(() => {
      ran = true;
    }, fakeRaf);
    expect(calls.length).toBe(2);
    expect(ran).toBe(true);
  });
});
