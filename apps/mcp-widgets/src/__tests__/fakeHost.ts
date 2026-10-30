import { vi } from 'vitest';
import type { Host, ToolCallResult } from '../bridge';

type Responder = ToolCallResult | ((args: Record<string, unknown>) => ToolCallResult);

/** A Host the cards can drive without ext-apps: records every call, answers tools from `results`. */
export function fakeHost(
  data: unknown,
  opts: {
    theme?: 'light' | 'dark';
    meta?: Record<string, unknown>;
    results?: Record<string, Responder>;
    pickImage?: Host['pickImage'];
    refreshImageUrl?: Host['refreshImageUrl'];
  } = {},
) {
  const results = opts.results ?? {};
  const host: Host = {
    data,
    meta: opts.meta,
    theme: opts.theme ?? 'light',
    callTool: vi.fn(async (name: string, args: object) => {
      const r = results[name];
      if (typeof r === 'function') return r(args as Record<string, unknown>);
      return r ?? { content: [{ type: 'text', text: '{}' }] };
    }),
    sendMessage: vi.fn(async () => {}),
    openLink: vi.fn(async () => {}),
    pickImage: opts.pickImage,
    refreshImageUrl: opts.refreshImageUrl,
  };
  return host;
}

export const textResult = (value: unknown, meta?: Record<string, unknown>): ToolCallResult => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
  ...(meta ? { _meta: meta } : {}),
});
