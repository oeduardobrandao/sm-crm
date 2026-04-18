export interface MockFetchResponseInit {
  ok?: boolean;
  status?: number;
  statusText?: string;
  json?: unknown;
  text?: string;
}

export interface FetchCall {
  input: RequestInfo | URL;
  init?: RequestInit;
}

export function createFetchMock() {
  const calls: FetchCall[] = [];
  const queue: MockFetchResponseInit[] = [];

  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });

    const next = queue.shift() ?? { ok: true, status: 200, statusText: 'OK', json: {} };

    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      statusText: next.statusText ?? 'OK',
      json: async () => {
        if (next.json instanceof Error) throw next.json;
        return next.json ?? {};
      },
      text: async () => next.text ?? '',
    } as Response;
  };

  return {
    fetchMock,
    calls,
    queueResponse(response: MockFetchResponseInit) {
      queue.push(response);
    },
    reset() {
      calls.length = 0;
      queue.length = 0;
    },
  };
}
