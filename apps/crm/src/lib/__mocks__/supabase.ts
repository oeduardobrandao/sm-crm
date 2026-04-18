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
let currentSession = {
  access_token: 'token-de-teste',
  user: currentUser,
};

const subscription = {
  unsubscribe: () => undefined,
};

export const supabase = {
  from: (table: string) => queryMock.from(table),
  rpc: (name: string, params: Record<string, unknown>) => queryMock.rpc(name, params),
  auth: {
    async getSession() {
      return { data: { session: currentSession }, error: null };
    },
    async getUser() {
      return { data: { user: currentUser }, error: null };
    },
    onAuthStateChange() {
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
  return currentProfile;
}

export async function signOut() {
  return supabase.auth.signOut();
}

export function __resetSupabaseMock() {
  queryMock.reset();
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

export function __queueSupabaseResult(table: string, operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert', ...responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>) {
  queryMock.queue(table, operation, ...responses);
}

export function __queueSupabaseRpc(name: string, ...responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>) {
  queryMock.queueRpc(name, ...responses);
}

export function __getSupabaseCalls() {
  return queryMock.calls;
}

export function __setCurrentUser(user: { id: string } | null) {
  currentUser = user;
  currentSession = user
    ? { access_token: 'token-de-teste', user }
    : null;
}

export function __setCurrentProfile(profile: Record<string, unknown> | null) {
  currentProfile = profile;
}

export function __setCurrentSession(session: { access_token: string; user: { id: string } | null } | null) {
  currentSession = session;
}
