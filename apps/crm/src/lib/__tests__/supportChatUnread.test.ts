import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetSupportChatUnreadForTests,
  ensureCrispListeners,
  markSupportChatRead,
  useSupportChatUnread,
} from '../supportChatUnread';

type Handler = () => void;
let handlers: Record<string, Handler[]>;

beforeEach(() => {
  __resetSupportChatUnreadForTests();
  handlers = {};
  const queue: unknown[][] = [];
  queue.push = (...items: unknown[][]) => {
    for (const item of items) {
      if (item[0] === 'on') (handlers[item[1] as string] ??= []).push(item[2] as Handler);
    }
    return Array.prototype.push.apply(queue, items);
  };
  window.$crisp = queue;
});

afterEach(() => {
  delete window.$crisp;
});

describe('supportChatUnread', () => {
  it('registers the Crisp listeners once across calls', () => {
    ensureCrispListeners();
    ensureCrispListeners();
    expect(handlers['message:received']).toHaveLength(1);
    expect(handlers['chat:opened']).toHaveLength(1);
    expect(handlers['chat:closed']).toHaveLength(1);
  });

  it('tracks unread from Crisp events and clears on read', () => {
    ensureCrispListeners();
    const { result } = renderHook(() => useSupportChatUnread());
    expect(result.current).toBe(false);
    act(() => handlers['message:received'][0]());
    expect(result.current).toBe(true);
    act(() => handlers['chat:opened'][0]());
    expect(result.current).toBe(false);
    act(() => handlers['message:received'][0]());
    act(() => markSupportChatRead());
    expect(result.current).toBe(false);
  });

  it('hides the widget when the chat closes', () => {
    ensureCrispListeners();
    handlers['chat:closed'][0]();
    expect((window.$crisp as unknown[][]).some((i) => i[0] === 'do' && i[1] === 'chat:hide')).toBe(
      true,
    );
  });
});
