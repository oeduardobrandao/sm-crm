import { assert, assertEquals } from "./assert.ts";
import type { CrispProfile, CrispProfileWrite } from "../_shared/crisp.ts";
import {
  buildPerson,
  type CrispCronDeps,
  mergeSegments,
  runCrispSyncCron,
} from "../crisp-sync-cron/handler.ts";

const CANDIDATE = {
  user_id: "u-1",
  email: "ana@example.com",
  nome: "Ana Silva",
  phone: "+5511999998888",
  papel: "owner",
  plano: "Pro",
  assinatura: "active",
  plan_source: "stripe",
  workspaces: "Agência A",
  workspace_count: 1,
  clientes: 7,
  cliente_desde: "2026-01-15",
  primary_workspace_id: "ws-1",
  segments: ["owner", "pagante"],
  fingerprint: "fp-1",
  people_id: null,
};

function makeDeps(over: Partial<CrispCronDeps> = {}, rpcData: Record<string, unknown[]> = {}) {
  const calls = {
    recorded: [] as string[],
    confirmed: [] as Array<{ userId: string; peopleId: string | null; fingerprint: string }>,
    created: [] as CrispProfileWrite[],
    saved: [] as Array<{ peopleId: string; p: CrispProfileWrite }>,
    data: [] as Array<{ peopleId: string; data: Record<string, unknown> }>,
    deletedRefs: [] as string[],
    markedDeleted: [] as string[],
    reported: [] as unknown[],
  };

  const base: CrispCronDeps = {
    rpc: (name: string) => Promise.resolve({ data: rpcData[name] ?? [], error: null }),
    recordContact: (userId: string) => {
      calls.recorded.push(userId);
      return Promise.resolve(true);
    },
    confirmSync: (userId, peopleId, fingerprint) => {
      calls.confirmed.push({ userId, peopleId, fingerprint });
      return Promise.resolve(true);
    },
    markContactDeleted: (id: string) => {
      calls.markedDeleted.push(id);
      return Promise.resolve();
    },
    getProfile: () => Promise.resolve(null),
    createProfile: (p) => {
      calls.created.push(p);
      return Promise.resolve("p-new");
    },
    saveProfile: (peopleId, p) => {
      calls.saved.push({ peopleId, p });
      return Promise.resolve();
    },
    saveData: (peopleId, data) => {
      calls.data.push({ peopleId, data });
      return Promise.resolve();
    },
    deleteProfile: (ref: string) => {
      calls.deletedRefs.push(ref);
      return Promise.resolve();
    },
    adminUrlFor: (id) => (id ? `https://app.example.com/admin/workspaces/${id}` : null),
    report: (d) => {
      calls.reported.push(d);
      return Promise.resolve();
    },
  };

  return { deps: { ...base, ...over } as CrispCronDeps, calls };
}

Deno.test("mergeSegments drops stale managed tags and keeps operator tags", () => {
  assertEquals(
    mergeSegments(["pagante", "vip", "trial"], ["owner", "free"]),
    ["vip", "owner", "free"],
  );
});

Deno.test("buildPerson omits phone entirely when it is blank", () => {
  assertEquals(buildPerson({ ...CANDIDATE, phone: "   " }), { nickname: "Ana Silva" });
  assertEquals(buildPerson({ ...CANDIDATE, phone: null }), { nickname: "Ana Silva" });
});

Deno.test("buildPerson falls back to the email local-part when nome is blank", () => {
  // Crisp requires a nickname and profiles.nome is nullable, so a confirmed
  // user with no name must not produce a guaranteed 4xx.
  assertEquals(buildPerson({ ...CANDIDATE, nome: null, phone: null }), { nickname: "ana" });
  assertEquals(buildPerson({ ...CANDIDATE, nome: "  ", phone: null }), { nickname: "ana" });
});

Deno.test("deletions run before upserts and use people_id when known", async () => {
  const order: string[] = [];
  const { deps, calls } = makeDeps(
    {
      deleteProfile: (ref: string) => {
        order.push(`delete:${ref}`);
        return Promise.resolve();
      },
      createProfile: () => {
        order.push("create");
        return Promise.resolve("p-new");
      },
    },
    {
      get_crisp_contact_deletions: [
        { id: "cc-1", synced_email: "old@example.com", synced_people_id: "p-old" },
      ],
      get_crisp_sync_candidates: [CANDIDATE],
    },
  );

  const result = await runCrispSyncCron(deps);

  assertEquals(order, ["delete:p-old", "create"]);
  assertEquals(calls.markedDeleted, ["cc-1"]);
  assertEquals(result.deleted, 1);
  assertEquals(result.upserted, 1);
  assertEquals(result.failed, 0);
});

Deno.test("a failing deletion does not abort the upsert sweep", async () => {
  const { deps, calls } = makeDeps(
    { deleteProfile: () => Promise.reject(new Error("Crisp DELETE /people/profile/:ref failed: 503")) },
    {
      get_crisp_contact_deletions: [
        { id: "cc-1", synced_email: "old@example.com", synced_people_id: null },
      ],
      get_crisp_sync_candidates: [CANDIDATE],
    },
  );

  const result = await runCrispSyncCron(deps);

  assertEquals(result.deleted, 0);
  assertEquals(result.upserted, 1);
  assertEquals(result.failed, 1);
  assertEquals(calls.reported.length, 1);
});

Deno.test("recordContact refusal skips the person with no vendor call", async () => {
  const { deps, calls } = makeDeps(
    { recordContact: () => Promise.resolve(false) },
    { get_crisp_sync_candidates: [CANDIDATE] },
  );

  const result = await runCrispSyncCron(deps);

  assertEquals(calls.created.length, 0);
  assertEquals(calls.saved.length, 0);
  assertEquals(calls.confirmed.length, 0);
  assertEquals(result.upserted, 0);
  assertEquals(result.failed, 0);
});

Deno.test("a vendor failure never advances the fingerprint", async () => {
  const { deps, calls } = makeDeps(
    { createProfile: () => Promise.reject(new Error("Crisp POST /people/profile failed: 503")) },
    { get_crisp_sync_candidates: [CANDIDATE] },
  );

  const result = await runCrispSyncCron(deps);

  assertEquals(calls.confirmed, []);
  assertEquals(result.upserted, 0);
  assertEquals(result.failed, 1);
});

Deno.test("a create conflict re-reads and updates instead of failing", async () => {
  const existing: CrispProfile = {
    people_id: "p-widget",
    segments: ["vip", "trial"],
    notepad: "ligou em marco",
  };
  const { deps, calls } = makeDeps(
    {
      getProfile: (ref: string) =>
        Promise.resolve(ref === CANDIDATE.email ? existing : null),
      createProfile: () => Promise.resolve(null),
    },
    { get_crisp_sync_candidates: [CANDIDATE] },
  );

  const result = await runCrispSyncCron(deps);

  assertEquals(result.failed, 0);
  assertEquals(result.upserted, 1);
  assertEquals(calls.saved[0].peopleId, "p-widget");
  assertEquals(calls.confirmed[0].peopleId, "p-widget");
});

Deno.test("a PUT preserves every field the GET returned", async () => {
  // The regression test for the review finding: naming only notepad/company
  // erased everything else the vendor holds.
  const existing: CrispProfile = {
    people_id: "p-1",
    segments: ["vip", "trial", "free"],
    notepad: "cliente antigo",
    company: { name: "Agência A" },
    address: "Rua X, 123",
    description: "indicado pelo Joao",
    person: { nickname: "Antigo", avatar: "https://img.example/a.png" },
    // A field this repo has never heard of. It must survive anyway.
    some_future_crisp_field: { anything: true },
  };
  const { deps, calls } = makeDeps(
    { getProfile: () => Promise.resolve(existing) },
    { get_crisp_sync_candidates: [CANDIDATE] },
  );

  await runCrispSyncCron(deps);

  const written = calls.saved[0].p;
  assertEquals(written.notepad, "cliente antigo");
  assertEquals(written.company, { name: "Agência A" });
  assertEquals(written.address, "Rua X, 123");
  assertEquals(written.description, "indicado pelo Joao");
  assertEquals(written.some_future_crisp_field, { anything: true });
  // Nested preservation: the avatar survives, the nickname is overridden.
  assertEquals(written.person.avatar, "https://img.example/a.png");
  assertEquals(written.person.nickname, "Ana Silva");
  // people_id is the route parameter, not a body field.
  assert(!("people_id" in written), "people_id must not be echoed into the body");
  // `vip` kept (operator tag), `trial`/`free` dropped (stale managed tags),
  // `owner`/`pagante` added.
  assertEquals(written.segments, ["vip", "owner", "pagante"]);
});

Deno.test("data carries admin_url and the workspace context", async () => {
  const { deps, calls } = makeDeps({}, { get_crisp_sync_candidates: [CANDIDATE] });

  await runCrispSyncCron(deps);

  const data = calls.data[0].data;
  assertEquals(data.admin_url, "https://app.example.com/admin/workspaces/ws-1");
  assertEquals(data.plano, "Pro");
  assertEquals(data.assinatura, "active");
  assertEquals(data.clientes, 7);
  assertEquals(data.cliente_desde, "2026-01-15");
});

Deno.test("admin_url is omitted when APP_BASE_URL is unavailable", async () => {
  const { deps, calls } = makeDeps(
    { adminUrlFor: () => null },
    { get_crisp_sync_candidates: [CANDIDATE] },
  );

  await runCrispSyncCron(deps);

  assert(!("admin_url" in calls.data[0].data), "admin_url should be absent");
});

Deno.test("a confirm that matches no row deletes the profile it just wrote", async () => {
  // The mid-flight sweep race: the deletion sweep swept this person while our
  // vendor write was in flight, so the profile we just created is an orphan
  // that get_crisp_contact_deletions can never select. It must be deleted here
  // or the person's PII is stranded at the vendor permanently.
  const { deps, calls } = makeDeps(
    { confirmSync: () => Promise.resolve(false) },
    { get_crisp_sync_candidates: [CANDIDATE] },
  );

  const result = await runCrispSyncCron(deps);

  assertEquals(calls.deletedRefs, ["p-new"]);
  assertEquals(result.upserted, 0);
  assertEquals(result.failed, 1);
});

Deno.test("an empty candidate list performs zero vendor calls and succeeds", async () => {
  const { deps, calls } = makeDeps();

  const result = await runCrispSyncCron(deps);

  assertEquals(calls.created.length, 0);
  assertEquals(calls.saved.length, 0);
  assertEquals(calls.reported.length, 0);
  assertEquals(result, { upserted: 0, deleted: 0, failed: 0 });
});

Deno.test("an RPC error is reported and does not throw", async () => {
  const { deps, calls } = makeDeps({
    rpc: (name: string) =>
      name === "get_crisp_sync_candidates"
        ? Promise.resolve({ data: null, error: { message: "boom" } })
        : Promise.resolve({ data: [], error: null }),
  });

  const result = await runCrispSyncCron(deps);

  assertEquals(result.failed, 1);
  assertEquals(calls.reported.length, 1);
});
