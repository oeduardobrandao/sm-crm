import { createSupabaseQueryMock } from '../../../../../test/shared/supabaseMock';

const queryMock = createSupabaseQueryMock();

let currentUser: { id: string; email?: string } | null = { id: 'user-1' };
let currentProfile: Record<string, unknown> | null = {
  id: 'user-1',
  nome: 'Eduardo Souza',
  role: 'owner',
  conta_id: 'conta-1',
  active_workspace_id: 'conta-1',
};
let profileResponses: Array<Promise<Record<string, unknown> | null>> = [];
// Queued responses for supabase.functions.invoke(). Defaults to `{ data: null,
// error: null }` when nothing is queued -- the same shape a real timeout or a
// genuine function error resolves to, which is exactly what the Crisp
// identify effect's fallback-to-unsigned-push path needs to exercise by
// default without every other test having to opt in. A queued entry may also
// be a caller-held Promise (not yet resolved) instead of a plain object, so a
// test can control exactly when the invoke call settles -- needed to
// reproduce the sign-out-races-an-in-flight-signing-request window.
let functionsInvokeResponses: Array<
  { data: unknown; error?: unknown } | Promise<{ data: unknown; error?: unknown }>
> = [];
let currentSession = {
  access_token: 'token-de-teste',
  user: currentUser,
};

const subscription = {
  unsubscribe: () => undefined,
};

type AuthChangeCallback = (
  event: string,
  session: { user: { id: string; email?: string } | null } | null,
) => void;
let authChangeCallback: AuthChangeCallback | null = null;

// Minimal postgres_changes realtime stand-in, shared by every feature that
// subscribes via supabase.channel(...).on('postgres_changes', ...).subscribe():
// AuthContext's live-revocation channel (UPDATE on workspace_members) and
// useEquipeChatRealtime's message channel (INSERT on equipe_mensagens).
// Listeners register into a shared LIST (keyed by event+table) rather than a
// single slot, so multiple simultaneously-subscribed channels don't clobber
// each other.
type PostgresChangesCallback = (payload: { new: Record<string, unknown> }) => void;
type PostgresChangesFilter = {
  event: string;
  schema: string;
  table: string;
  filter?: string;
};
interface ChannelListener {
  event: string;
  table: string;
  filter: PostgresChangesFilter;
  callback: PostgresChangesCallback;
  // The channel object this listener belongs to — lets removeChannel() (see
  // below) deregister exactly this channel's entries instead of only
  // recording that removal was requested. A hook that forgets to clean up
  // (or unmounts without calling supabase.removeChannel) must keep routing
  // emits to its now-orphaned listener, and a hook that DOES clean up must
  // stop receiving them — either direction needs this reference to tell them
  // apart.
  channel: unknown;
}
// Only entries whose channel actually called .subscribe() land here — a
// channel that registers a callback via on() but never calls subscribe()
// must NOT route emits to it. A real (unsubscribed) supabase-js channel
// delivers nothing either — deleting a `.subscribe()` call at a call site
// must make tests that rely on the subscription fail, not silently pass.
let activeListeners: ChannelListener[] = [];
const channelCallNames: string[] = [];
export const removedChannelCalls: unknown[] = [];

function findListener(event: string, table: string): ChannelListener | null {
  // Last-registered-wins: mirrors the pre-widening mock, where a fresh
  // subscribe() overwrote the single module-level slot outright.
  for (let i = activeListeners.length - 1; i >= 0; i--) {
    const listener = activeListeners[i];
    if (listener.event === event && listener.table === table) return listener;
  }
  return null;
}

function makeChannelMock(name: string) {
  channelCallNames.push(name);
  const pendingListeners: Array<Omit<ChannelListener, 'channel'>> = [];
  const channel = {
    on(
      _event: 'postgres_changes',
      filter: PostgresChangesFilter,
      callback: PostgresChangesCallback,
    ) {
      pendingListeners.push({ event: filter.event, table: filter.table, filter, callback });
      return channel;
    },
    subscribe() {
      activeListeners.push(...pendingListeners.map((listener) => ({ ...listener, channel })));
      return channel;
    },
  };
  return channel;
}

export const supabase = {
  from: (table: string) => queryMock.from(table),
  rpc: (name: string, params: Record<string, unknown>) => queryMock.rpc(name, params),
  channel: (name: string) => makeChannelMock(name),
  removeChannel: (ch: unknown) => {
    removedChannelCalls.push(ch);
    // Real cleanup, not just a call-count record: drop this channel's own
    // listeners from activeListeners so a subsequent emit no longer routes
    // to it. Without this, a hook that forgot to unsubscribe on unmount
    // would still pass an "unmount calls removeChannel" test that only
    // checks the call count, while still silently reacting to events after
    // teardown.
    activeListeners = activeListeners.filter((listener) => listener.channel !== ch);
    return Promise.resolve('ok');
  },
  functions: {
    async invoke(_name: string, _options?: Record<string, unknown>) {
      const queued = functionsInvokeResponses.shift();
      if (queued) return queued;
      return { data: null, error: null };
    },
  },
  auth: {
    async getSession() {
      return { data: { session: currentSession }, error: null };
    },
    async getUser() {
      return { data: { user: currentUser }, error: null };
    },
    onAuthStateChange(callback: AuthChangeCallback) {
      authChangeCallback = callback;
      return { data: { subscription } };
    },
    async signInWithPassword() {
      return { data: { session: currentSession }, error: null };
    },
    async signUp() {
      return { data: {}, error: null };
    },
    async resetPasswordForEmail() {
      return { data: {}, error: null };
    },
    async updateUser() {
      return { data: { user: currentUser }, error: null };
    },
    async signOut() {
      currentSession = null;
      currentUser = null;
      return { error: null };
    },
  },
};

export function clearProfileCache() {
  currentProfile = null;
}

export async function getCurrentUser() {
  return currentUser;
}

export async function getCurrentProfile(force = false) {
  void force;
  const queuedResponse = profileResponses.shift();
  if (queuedResponse) return queuedResponse;
  return currentProfile;
}

export async function signOut() {
  return supabase.auth.signOut();
}

export function __resetSupabaseMock() {
  queryMock.reset();
  profileResponses = [];
  functionsInvokeResponses = [];
  activeListeners = [];
  channelCallNames.length = 0;
  removedChannelCalls.length = 0;
  currentUser = { id: 'user-1' };
  currentProfile = {
    id: 'user-1',
    nome: 'Eduardo Souza',
    role: 'owner',
    conta_id: 'conta-1',
    active_workspace_id: 'conta-1',
  };
  currentSession = {
    access_token: 'token-de-teste',
    user: currentUser,
  };
}

export function __queueSupabaseResult(
  table: string,
  operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert',
  ...responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>
) {
  queryMock.queue(table, operation, ...responses);
}

export function __queueSupabaseRpc(
  name: string,
  ...responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>
) {
  queryMock.queueRpc(name, ...responses);
}

export function __getSupabaseCalls() {
  return queryMock.calls;
}

export function __setCurrentUser(user: { id: string; email?: string } | null) {
  currentUser = user;
  currentSession = user ? { access_token: 'token-de-teste', user } : null;
}

export function __setCurrentProfile(profile: Record<string, unknown> | null) {
  currentProfile = profile;
}

export function __queueCurrentProfileResponse(response: Promise<Record<string, unknown> | null>) {
  profileResponses.push(response);
}

export function __queueFunctionsInvokeResponse(
  response: { data: unknown; error?: unknown } | Promise<{ data: unknown; error?: unknown }>,
) {
  functionsInvokeResponses.push(response);
}

export function __setCurrentSession(
  session: { access_token: string; user: { id: string } | null } | null,
) {
  currentSession = session;
}

export async function healPendingInvite() {}

export function __emitAuthChange(
  event: string,
  session: { user: { id: string; email?: string } | null } | null,
) {
  authChangeCallback?.(event, session);
}

export function __emitWorkspaceMemberUpdate(newRow: Record<string, unknown>) {
  findListener('UPDATE', 'workspace_members')?.callback({ new: newRow });
}

// Only non-null once subscribe() has actually been called — see the comment
// above activeListeners.
export function __getWorkspaceMemberSubscription(): PostgresChangesFilter | null {
  return findListener('UPDATE', 'workspace_members')?.filter ?? null;
}

// equipe-chat realtime (useEquipeChatRealtime): single INSERT listener on
// equipe_mensagens, same routing rules as the workspace_members pair above.
export function __emitEquipeMensagemInsert(row: unknown) {
  findListener('INSERT', 'equipe_mensagens')?.callback({ new: row as Record<string, unknown> });
}

export function __getEquipeMensagemSubscription(): PostgresChangesFilter | null {
  return findListener('INSERT', 'equipe_mensagens')?.filter ?? null;
}

export function __getChannelCalls(): string[] {
  return [...channelCallNames];
}
