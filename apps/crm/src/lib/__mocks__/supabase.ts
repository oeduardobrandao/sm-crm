import { createSupabaseQueryMock } from '../../../../../test/shared/supabaseMock';

const queryMock = createSupabaseQueryMock();

let currentUser: { id: string } | null = { id: 'user-1' };
let currentProfile: Record<string, unknown> | null = {
  id: 'user-1',
  nome: 'Eduardo Souza',
  role: 'owner',
  conta_id: 'conta-1',
  active_workspace_id: 'conta-1',
};
let profileResponses: Array<Promise<Record<string, unknown> | null>> = [];
let currentSession = {
  access_token: 'token-de-teste',
  user: currentUser,
};

const subscription = {
  unsubscribe: () => undefined,
};

type AuthChangeCallback = (event: string, session: { user: { id: string } | null } | null) => void;
let authChangeCallback: AuthChangeCallback | null = null;

// Minimal postgres_changes realtime stand-in for AuthContext's live-revocation
// subscription. Only supports a single active UPDATE listener at a time,
// which is all AuthProvider ever registers.
type PostgresChangesCallback = (payload: { new: Record<string, unknown> }) => void;
type PostgresChangesFilter = {
  event: string;
  schema: string;
  table: string;
  filter: string;
};
// Only set from inside subscribe(): a channel that registers a callback via
// on() but never calls subscribe() must NOT route emits to it. A real
// (unsubscribed) supabase-js channel delivers nothing either — deleting the
// `.subscribe()` call in AuthContext must make tests that rely on the
// subscription fail, not silently pass.
let workspaceMemberUpdateCallback: PostgresChangesCallback | null = null;
let workspaceMemberUpdateFilter: PostgresChangesFilter | null = null;
export const removedChannelCalls: unknown[] = [];

function makeChannelMock() {
  let pendingCallback: PostgresChangesCallback | null = null;
  let pendingFilter: PostgresChangesFilter | null = null;
  const channel = {
    on(
      _event: 'postgres_changes',
      filter: PostgresChangesFilter,
      callback: PostgresChangesCallback,
    ) {
      pendingCallback = callback;
      pendingFilter = filter;
      return channel;
    },
    subscribe() {
      workspaceMemberUpdateCallback = pendingCallback;
      workspaceMemberUpdateFilter = pendingFilter;
      return channel;
    },
  };
  return channel;
}

export const supabase = {
  from: (table: string) => queryMock.from(table),
  rpc: (name: string, params: Record<string, unknown>) => queryMock.rpc(name, params),
  channel: (_name: string) => makeChannelMock(),
  removeChannel: (ch: unknown) => {
    removedChannelCalls.push(ch);
    return Promise.resolve('ok');
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
  workspaceMemberUpdateCallback = null;
  workspaceMemberUpdateFilter = null;
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

export function __setCurrentUser(user: { id: string } | null) {
  currentUser = user;
  currentSession = user ? { access_token: 'token-de-teste', user } : null;
}

export function __setCurrentProfile(profile: Record<string, unknown> | null) {
  currentProfile = profile;
}

export function __queueCurrentProfileResponse(response: Promise<Record<string, unknown> | null>) {
  profileResponses.push(response);
}

export function __setCurrentSession(
  session: { access_token: string; user: { id: string } | null } | null,
) {
  currentSession = session;
}

export async function healPendingInvite() {}

export function __emitAuthChange(event: string, session: { user: { id: string } | null } | null) {
  authChangeCallback?.(event, session);
}

export function __emitWorkspaceMemberUpdate(newRow: Record<string, unknown>) {
  workspaceMemberUpdateCallback?.({ new: newRow });
}

// Only non-null once subscribe() has actually been called — see the comment
// above workspaceMemberUpdateCallback.
export function __getWorkspaceMemberSubscription(): PostgresChangesFilter | null {
  return workspaceMemberUpdateFilter;
}
