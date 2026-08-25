import { assert, assertEquals } from "./assert.ts";
import { fetchOwnerContacts } from "../platform-admin/owner-contact.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

interface Member {
  workspace_id: string;
  user_id: string;
  joined_at: string;
}
interface Profile {
  id: string;
  nome: string | null;
  telefone: string | null;
  marketing_opt_in: boolean | null;
}
interface Workspace {
  id: string;
  created_by: string | null;
}

function makeFakeSvc(opts: {
  members: Member[];
  profiles: Profile[];
  getUserById: (id: string) => Promise<{ data: { user: { id: string; email: string } | null } }>;
  workspaces?: Workspace[];
  membersError?: Error;
  profilesError?: Error;
  workspacesError?: Error;
}) {
  const db = {
    from(table: string) {
      if (table === "workspace_members") {
        return {
          select: () => ({
            in: (_col: string, ids: string[]) => ({
              eq: (_col2: string, _role: string) => ({
                order: (col1: string, o1: { ascending: boolean }) => ({
                  order: (col2: string, o2: { ascending: boolean }) => {
                    if (opts.membersError) {
                      return Promise.resolve({ data: null, error: opts.membersError });
                    }
                    const filtered = opts.members.filter((m) => ids.includes(m.workspace_id));
                    const sorted = [...filtered].sort((a, b) => {
                      const av = String((a as unknown as Record<string, unknown>)[col1]);
                      const bv = String((b as unknown as Record<string, unknown>)[col1]);
                      const c1 = av.localeCompare(bv) * (o1.ascending ? 1 : -1);
                      if (c1 !== 0) return c1;
                      const av2 = String((a as unknown as Record<string, unknown>)[col2]);
                      const bv2 = String((b as unknown as Record<string, unknown>)[col2]);
                      return av2.localeCompare(bv2) * (o2.ascending ? 1 : -1);
                    });
                    return Promise.resolve({ data: sorted, error: null });
                  },
                }),
              }),
            }),
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            in: (_col: string, ids: string[]) => {
              if (opts.profilesError) {
                return Promise.resolve({ data: null, error: opts.profilesError });
              }
              return Promise.resolve({
                data: opts.profiles.filter((p) => ids.includes(p.id)),
                error: null,
              });
            },
          }),
        };
      }
      if (table === "workspaces") {
        return {
          select: () => ({
            in: (_col: string, ids: string[]) => {
              if (opts.workspacesError) {
                return Promise.resolve({ data: null, error: opts.workspacesError });
              }
              return Promise.resolve({
                data: (opts.workspaces ?? []).filter((w) => ids.includes(w.id)),
                error: null,
              });
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    auth: { admin: { getUserById: (id: string) => opts.getUserById(id) } },
  };
  return db as unknown as SupabaseClient;
}

Deno.test("picks the earliest-joined_at owner when a workspace has two owner rows", async () => {
  const svc = makeFakeSvc({
    members: [
      { workspace_id: "ws-1", user_id: "user-late", joined_at: "2026-02-01T00:00:00Z" },
      { workspace_id: "ws-1", user_id: "user-early", joined_at: "2026-01-01T00:00:00Z" },
    ],
    profiles: [
      { id: "user-late", nome: "Late Owner", telefone: null, marketing_opt_in: false },
      { id: "user-early", nome: "Early Owner", telefone: null, marketing_opt_in: true },
    ],
    getUserById: (id) => Promise.resolve({ data: { user: { id, email: `${id}@example.com` } } }),
  });

  const result = await fetchOwnerContacts(svc, ["ws-1"]);
  assertEquals(result.get("ws-1"), {
    name: "Early Owner",
    email: "user-early@example.com",
    telefone: null,
    marketing_opt_in: true,
  });
});

Deno.test("prefers the workspace creator over the earliest-joined_at owner", async () => {
  const svc = makeFakeSvc({
    members: [
      { workspace_id: "ws-1", user_id: "user-early", joined_at: "2026-01-01T00:00:00Z" },
      { workspace_id: "ws-1", user_id: "user-late", joined_at: "2026-02-01T00:00:00Z" },
    ],
    profiles: [
      { id: "user-early", nome: "Early Owner", telefone: null, marketing_opt_in: false },
      { id: "user-late", nome: "Late Owner", telefone: null, marketing_opt_in: true },
    ],
    workspaces: [{ id: "ws-1", created_by: "user-late" }],
    getUserById: (id) => Promise.resolve({ data: { user: { id, email: `${id}@example.com` } } }),
  });

  const result = await fetchOwnerContacts(svc, ["ws-1"]);
  assertEquals(result.get("ws-1"), {
    name: "Late Owner",
    email: "user-late@example.com",
    telefone: null,
    marketing_opt_in: true,
  });
});

Deno.test("falls back to earliest-joined_at when created_by is null or not an owner", async () => {
  const svcNullCreator = makeFakeSvc({
    members: [
      { workspace_id: "ws-1", user_id: "user-late", joined_at: "2026-02-01T00:00:00Z" },
      { workspace_id: "ws-1", user_id: "user-early", joined_at: "2026-01-01T00:00:00Z" },
    ],
    profiles: [
      { id: "user-late", nome: "Late Owner", telefone: null, marketing_opt_in: false },
      { id: "user-early", nome: "Early Owner", telefone: null, marketing_opt_in: true },
    ],
    workspaces: [{ id: "ws-1", created_by: null }],
    getUserById: (id) => Promise.resolve({ data: { user: { id, email: `${id}@example.com` } } }),
  });

  const resultNullCreator = await fetchOwnerContacts(svcNullCreator, ["ws-1"]);
  assertEquals(resultNullCreator.get("ws-1")?.name, "Early Owner");

  const svcNonOwnerCreator = makeFakeSvc({
    members: [
      { workspace_id: "ws-1", user_id: "user-late", joined_at: "2026-02-01T00:00:00Z" },
      { workspace_id: "ws-1", user_id: "user-early", joined_at: "2026-01-01T00:00:00Z" },
    ],
    profiles: [
      { id: "user-late", nome: "Late Owner", telefone: null, marketing_opt_in: false },
      { id: "user-early", nome: "Early Owner", telefone: null, marketing_opt_in: true },
    ],
    // created_by points at a user who has no owner-role row for this workspace at all.
    workspaces: [{ id: "ws-1", created_by: "user-not-a-member" }],
    getUserById: (id) => Promise.resolve({ data: { user: { id, email: `${id}@example.com` } } }),
  });

  const resultNonOwnerCreator = await fetchOwnerContacts(svcNonOwnerCreator, ["ws-1"]);
  assertEquals(resultNonOwnerCreator.get("ws-1")?.name, "Early Owner");
});

Deno.test("a workspace with no owner-role row has no entry in the result map", async () => {
  const svc = makeFakeSvc({
    members: [{ workspace_id: "ws-1", user_id: "user-1", joined_at: "2026-01-01T00:00:00Z" }],
    profiles: [{ id: "user-1", nome: "Alice", telefone: null, marketing_opt_in: false }],
    getUserById: (id) => Promise.resolve({ data: { user: { id, email: "alice@example.com" } } }),
  });

  const result = await fetchOwnerContacts(svc, ["ws-1", "ws-2"]);
  assert(result.has("ws-1"), "ws-1 should have an owner entry");
  assert(!result.has("ws-2"), "ws-2 has no owner-role member and should have no entry");
});

Deno.test("empty workspaceIds returns an empty map without querying", async () => {
  const svc = makeFakeSvc({
    members: [],
    profiles: [],
    getUserById: () => {
      throw new Error("must not be called");
    },
  });
  const result = await fetchOwnerContacts(svc, []);
  assertEquals(result.size, 0);
});

Deno.test("a single getUserById failure blanks only that owner's email, siblings still resolve", async () => {
  const svc = makeFakeSvc({
    members: [
      { workspace_id: "ws-1", user_id: "user-1", joined_at: "2026-01-01T00:00:00Z" },
      { workspace_id: "ws-2", user_id: "user-2", joined_at: "2026-01-01T00:00:00Z" },
    ],
    profiles: [
      { id: "user-1", nome: "Alice", telefone: null, marketing_opt_in: true },
      { id: "user-2", nome: "Bob", telefone: null, marketing_opt_in: false },
    ],
    getUserById: (id) => {
      if (id === "user-1") return Promise.reject(new Error("network blip"));
      return Promise.resolve({ data: { user: { id, email: "bob@example.com" } } });
    },
  });

  const result = await fetchOwnerContacts(svc, ["ws-1", "ws-2"]);
  assertEquals(result.get("ws-1"), {
    name: "Alice",
    email: null,
    telefone: null,
    marketing_opt_in: true,
  });
  assertEquals(result.get("ws-2"), {
    name: "Bob",
    email: "bob@example.com",
    telefone: null,
    marketing_opt_in: false,
  });
});

Deno.test("workspace_members query failure propagates instead of being swallowed", async () => {
  const svc = makeFakeSvc({
    members: [],
    profiles: [],
    getUserById: () => Promise.resolve({ data: { user: null } }),
    membersError: new Error("db down"),
  });

  let threw = false;
  try {
    await fetchOwnerContacts(svc, ["ws-1"]);
  } catch (err) {
    threw = true;
    assertEquals((err as Error).message, "db down");
  }
  assert(threw, "expected fetchOwnerContacts to throw on a membership-query failure");
});

Deno.test("workspaces query failure propagates instead of being swallowed", async () => {
  const svc = makeFakeSvc({
    members: [{ workspace_id: "ws-1", user_id: "user-1", joined_at: "2026-01-01T00:00:00Z" }],
    profiles: [{ id: "user-1", nome: "Alice", telefone: null, marketing_opt_in: false }],
    getUserById: () => Promise.resolve({ data: { user: null } }),
    workspacesError: new Error("workspaces down"),
  });

  let threw = false;
  try {
    await fetchOwnerContacts(svc, ["ws-1"]);
  } catch (err) {
    threw = true;
    assertEquals((err as Error).message, "workspaces down");
  }
  assert(threw, "expected fetchOwnerContacts to throw on a workspaces-query failure");
});

Deno.test("profiles query failure propagates instead of being swallowed", async () => {
  const svc = makeFakeSvc({
    members: [{ workspace_id: "ws-1", user_id: "user-1", joined_at: "2026-01-01T00:00:00Z" }],
    profiles: [],
    getUserById: () => Promise.resolve({ data: { user: null } }),
    profilesError: new Error("profiles down"),
  });

  let threw = false;
  try {
    await fetchOwnerContacts(svc, ["ws-1"]);
  } catch (err) {
    threw = true;
    assertEquals((err as Error).message, "profiles down");
  }
  assert(threw, "expected fetchOwnerContacts to throw on a profiles-query failure");
});

Deno.test("batches getUserById calls in groups no larger than 8", async () => {
  const N = 10;
  const members: Member[] = Array.from({ length: N }, (_, i) => ({
    workspace_id: `ws-${i}`,
    user_id: `user-${i}`,
    joined_at: "2026-01-01T00:00:00Z",
  }));
  const profiles: Profile[] = members.map((m) => ({
    id: m.user_id,
    nome: `Name ${m.user_id}`,
    telefone: null,
    marketing_opt_in: false,
  }));

  let inFlight = 0;
  let maxInFlight = 0;

  const svc = makeFakeSvc({
    members,
    profiles,
    getUserById: async (id) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return { data: { user: { id, email: `${id}@example.com` } } };
    },
  });

  await fetchOwnerContacts(svc, members.map((m) => m.workspace_id));
  assert(maxInFlight <= 8, `expected concurrency <= 8, got ${maxInFlight}`);
  assert(maxInFlight > 1, "sanity check: batching should still run some calls concurrently");
});
