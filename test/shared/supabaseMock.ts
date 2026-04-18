export type SupabaseOperation = 'select' | 'insert' | 'update' | 'delete' | 'upsert' | 'rpc';

export interface SupabaseResult<T = unknown> {
  data?: T;
  error?: unknown;
  count?: number | null;
}

type SupabaseResponse<T = unknown> =
  | SupabaseResult<T>
  | Promise<SupabaseResult<T>>
  | (() => SupabaseResult<T> | Promise<SupabaseResult<T>>);

export interface QueryCall {
  table: string;
  operation: SupabaseOperation;
  payload?: unknown;
  options?: unknown;
  selectArgs: unknown[][];
  modifiers: Array<{ method: string; args: unknown[] }>;
}

function cloneResult<T>(value: SupabaseResult<T>): SupabaseResult<T> {
  return {
    data: value.data,
    error: value.error ?? null,
    count: value.count ?? null,
  };
}

function defaultResult(operation: SupabaseOperation): SupabaseResult {
  if (operation === 'select') {
    return { data: [], error: null, count: null };
  }

  return { data: null, error: null, count: null };
}

class QueryBuilder {
  private operation: SupabaseOperation | null = null;
  private payload: unknown;
  private options: unknown;
  private readonly selectArgs: unknown[][] = [];
  private readonly modifiers: Array<{ method: string; args: unknown[] }> = [];

  constructor(
    private readonly state: MockState,
    private readonly table: string,
  ) {}

  select(...args: unknown[]) {
    if (!this.operation) {
      this.operation = 'select';
    }
    this.selectArgs.push(args);
    return this;
  }

  insert(payload: unknown, options?: unknown) {
    this.operation = 'insert';
    this.payload = payload;
    this.options = options;
    return this;
  }

  update(payload: unknown) {
    this.operation = 'update';
    this.payload = payload;
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  upsert(payload: unknown, options?: unknown) {
    this.operation = 'upsert';
    this.payload = payload;
    this.options = options;
    return this;
  }

  eq(...args: unknown[]) {
    this.modifiers.push({ method: 'eq', args });
    return this;
  }

  gt(...args: unknown[]) {
    this.modifiers.push({ method: 'gt', args });
    return this;
  }

  gte(...args: unknown[]) {
    this.modifiers.push({ method: 'gte', args });
    return this;
  }

  lt(...args: unknown[]) {
    this.modifiers.push({ method: 'lt', args });
    return this;
  }

  lte(...args: unknown[]) {
    this.modifiers.push({ method: 'lte', args });
    return this;
  }

  in(...args: unknown[]) {
    this.modifiers.push({ method: 'in', args });
    return this;
  }

  not(...args: unknown[]) {
    this.modifiers.push({ method: 'not', args });
    return this;
  }

  order(...args: unknown[]) {
    this.modifiers.push({ method: 'order', args });
    return this;
  }

  limit(...args: unknown[]) {
    this.modifiers.push({ method: 'limit', args });
    return this;
  }

  single() {
    this.modifiers.push({ method: 'single', args: [] });
    return this.execute();
  }

  maybeSingle() {
    this.modifiers.push({ method: 'maybeSingle', args: [] });
    return this.execute();
  }

  then<TResult1 = SupabaseResult, TResult2 = never>(
    onfulfilled?: ((value: SupabaseResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ) {
    return this.execute().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null) {
    return this.execute().finally(onfinally ?? undefined);
  }

  private async execute(): Promise<SupabaseResult> {
    const operation = this.operation ?? 'select';
    const key = `${this.table}:${operation}`;
    const queue = this.state.responses.get(key);
    const next = queue?.length ? queue.shift() : undefined;
    const resolved = typeof next === 'function'
      ? await next()
      : next
        ? await next
        : defaultResult(operation);

    this.state.calls.push({
      table: this.table,
      operation,
      payload: this.payload,
      options: this.options,
      selectArgs: [...this.selectArgs],
      modifiers: [...this.modifiers],
    });

    return cloneResult(resolved);
  }
}

interface MockState {
  calls: QueryCall[];
  responses: Map<string, SupabaseResponse[]>;
  rpcResponses: Map<string, SupabaseResponse[]>;
}

function createState(): MockState {
  return {
    calls: [],
    responses: new Map(),
    rpcResponses: new Map(),
  };
}

export function createSupabaseQueryMock() {
  const state = createState();

  return {
    from(table: string) {
      return new QueryBuilder(state, table);
    },
    rpc(name: string, params: Record<string, unknown>) {
      const queue = state.rpcResponses.get(name);
      const next = queue?.length ? queue.shift() : undefined;
      const resultPromise = typeof next === 'function'
        ? Promise.resolve(next())
        : Promise.resolve(next ?? { data: true, error: null, count: null });

      state.calls.push({
        table: `rpc:${name}`,
        operation: 'rpc',
        payload: params,
        options: undefined,
        selectArgs: [],
        modifiers: [],
      });

      return resultPromise.then(cloneResult);
    },
    queue(table: string, operation: SupabaseOperation, ...responses: SupabaseResponse[]) {
      const key = `${table}:${operation}`;
      const existing = state.responses.get(key) ?? [];
      existing.push(...responses);
      state.responses.set(key, existing);
    },
    queueRpc(name: string, ...responses: SupabaseResponse[]) {
      const existing = state.rpcResponses.get(name) ?? [];
      existing.push(...responses);
      state.rpcResponses.set(name, existing);
    },
    reset() {
      state.calls.length = 0;
      state.responses.clear();
      state.rpcResponses.clear();
    },
    get calls() {
      return state.calls;
    },
  };
}
