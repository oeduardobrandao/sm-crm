import { assert, assertEquals } from "./assert.ts";
import {
  classifyPublishError,
  NON_RETRYABLE_CODES,
  PUBLISH_ERROR_COPY,
} from "../_shared/publish-error-codes.ts";
import { throwGraphError } from "../_shared/instagram-graph.ts";
import {
  buildCollaboratorFailureFields,
  normalizeCollaborators,
  refusedCollaborators,
} from "../_shared/instagram-collaborators.ts";

// signGetUrl presigns locally (no network) but reads R2 env lazily: dummy creds
// so the container helpers can build media URLs under test.
Deno.env.set("R2_ACCOUNT_ID", "acct");
Deno.env.set("R2_ACCESS_KEY_ID", "akid");
Deno.env.set("R2_SECRET_ACCESS_KEY", "secret");
Deno.env.set("R2_BUCKET", "bucket");

const {
  createSingleImageContainer,
  createVideoContainer,
  createCarouselParentContainer,
  createContainerForPost,
  advanceCarouselContainer,
} = await import("../_shared/instagram-publish-utils.ts");

// ─── Graph stub ───────────────────────────────────────────────────
// POST -> {id: c-N}; GET (status poll) -> FINISHED. Records every call.
function stubGraph() {
  const original = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  const calls: Array<{ url: string; body: any }> = [];
  let n = 0;
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (!init?.body) {
      return Promise.resolve(new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 }));
    }
    n += 1;
    return Promise.resolve(new Response(JSON.stringify({ id: `c-${n}` }), { status: 200 }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

type MediaLink = {
  sort_order: number;
  files: { id: number; kind: string; r2_key: string; thumbnail_r2_key: string | null };
};

function link(sort: number, id: number, kind: string, thumb: string | null = null): MediaLink {
  return {
    sort_order: sort,
    files: { id, kind, r2_key: `${kind}/${id}.${kind === "video" ? "mp4" : "jpg"}`, thumbnail_r2_key: thumb },
  };
}

// Stateful db stub (same shape as instagram-publish-carousel-children_test.ts):
// carousel_children reads back what set_carousel_child_field / update wrote.
// `mediaReads` counts post_file_links reads so guards can prove no fetch happened.
// deno-lint-ignore no-explicit-any
function makeDb(opts: { children?: any; media?: MediaLink[] }) {
  let children = opts.children ?? null;
  const counters = { mediaReads: 0 };
  // deno-lint-ignore no-explicit-any
  const db: any = {
    from(table: string) {
      return {
        select() { return this; },
        eq() { return this; },
        order() {
          counters.mediaReads += 1;
          return Promise.resolve({ data: opts.media ?? [] });
        },
        single() {
          return Promise.resolve({ data: table === "workflow_posts" ? { carousel_children: children } : null });
        },
        update(vals: Record<string, unknown>) {
          if ("carousel_children" in vals) children = vals.carousel_children;
          return { eq() { return Promise.resolve({ data: null }); } };
        },
      };
    },
    // deno-lint-ignore no-explicit-any
    rpc(fn: string, params: any) {
      if (fn === "set_carousel_child_field" && Array.isArray(children)) {
        // deno-lint-ignore no-explicit-any
        children = children.map((c: any, i: number) =>
          i === params.p_index ? { ...c, [params.p_field]: params.p_value } : c
        );
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { db, counters };
}

const base = { igUserId: "ig", token: "tok", postId: 1, caption: "cap" };

async function rejects(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected the call to throw");
}

// ─── normalizeCollaborators ───────────────────────────────────────

Deno.test("normalizeCollaborators: null/undefined/non-array → []", () => {
  assertEquals(normalizeCollaborators(null), []);
  assertEquals(normalizeCollaborators(undefined), []);
  assertEquals(normalizeCollaborators("ana"), []);
  assertEquals(normalizeCollaborators({ 0: "ana" }), []);
});

Deno.test("normalizeCollaborators: keeps only strings, in order", () => {
  assertEquals(normalizeCollaborators(["a", 3, null]), ["a"]);
  assertEquals(normalizeCollaborators(["dra.julia", "clinicaviva"]), ["dra.julia", "clinicaviva"]);
});

// ─── refusedCollaborators ─────────────────────────────────────────

Deno.test("refusedCollaborators: picks the names Meta lists", () => {
  assertEquals(
    refusedCollaborators(["ana", "clinicaviva"], "Os seguintes usuários não podem ser acessados: clinicaviva"),
    ["clinicaviva"],
  );
});

Deno.test("refusedCollaborators: exact token only (ana never matches anamaria)", () => {
  assertEquals(refusedCollaborators(["ana"], "Os seguintes usuários não podem ser acessados: anamaria"), []);
});

Deno.test("refusedCollaborators: no message → []", () => {
  assertEquals(refusedCollaborators(["ana"], undefined), []);
  assertEquals(refusedCollaborators(["ana"], null), []);
  assertEquals(refusedCollaborators(["ana"], ""), []);
});

Deno.test("refusedCollaborators: case-insensitive match", () => {
  assertEquals(
    refusedCollaborators(["clinicaviva"], "Os seguintes usuários não podem ser acessados: CLINICAVIVA"),
    ["clinicaviva"],
  );
});

Deno.test("refusedCollaborators: several names, list order, dotted usernames", () => {
  assertEquals(
    refusedCollaborators(
      ["dra.julia", "ana", "nutri.ana"],
      "Os seguintes usuários não podem ser acessados: nutri.ana, dra.julia",
    ),
    ["dra.julia", "nutri.ana"],
  );
});

Deno.test("refusedCollaborators: a sentence-ending period does not hide the name", () => {
  assertEquals(
    refusedCollaborators(["clinicaviva"], "Os seguintes usuários não podem ser acessados: clinicaviva."),
    ["clinicaviva"],
  );
});

// ─── buildCollaboratorFailureFields ───────────────────────────────

Deno.test("buildCollaboratorFailureFields: COLLABORATOR_INVALID stores the refused subset", () => {
  assertEquals(
    buildCollaboratorFailureFields("COLLABORATOR_INVALID", ["a", "b"], "Os seguintes usuários não podem ser acessados: b"),
    { ig_collaborators_refused: ["b"] },
  );
});

Deno.test("buildCollaboratorFailureFields: COLLABORATOR_INVALID with no match stores []", () => {
  assertEquals(
    buildCollaboratorFailureFields("COLLABORATOR_INVALID", ["a"], undefined),
    { ig_collaborators_refused: [] },
  );
});

Deno.test("buildCollaboratorFailureFields: any other code → {}", () => {
  assertEquals(buildCollaboratorFailureFields("IG_TRANSIENT", ["a", "b"], "b"), {});
  assertEquals(buildCollaboratorFailureFields("UNKNOWN", ["a"], "a"), {});
});

// ─── classify + throwGraphError ───────────────────────────────────

Deno.test("classifyPublishError: subcode 2207018 → COLLABORATOR_INVALID", () => {
  assertEquals(
    classifyPublishError({ graphCode: 110, graphSubcode: 2207018, message: "Invalid user id" }),
    "COLLABORATOR_INVALID",
  );
});

Deno.test("COLLABORATOR_INVALID is non-retryable and has the spec copy", () => {
  assert(NON_RETRYABLE_CODES.includes("COLLABORATOR_INVALID"));
  assertEquals(PUBLISH_ERROR_COPY.COLLABORATOR_INVALID, {
    titulo: "O Instagram recusou um colaborador",
    explicacao: "Confira se o @ está certo e se o perfil é público. Edite os colaboradores e tente novamente.",
  });
});

Deno.test("throwGraphError keeps error_user_msg as graphUserMsg (and classifies)", () => {
  let thrown: unknown;
  try {
    throwGraphError({
      error: { message: "Invalid user id", code: 110, error_subcode: 2207018, error_user_msg: "x" },
    });
  } catch (e) {
    thrown = e;
  }
  // deno-lint-ignore no-explicit-any
  const err = thrown as any;
  assertEquals(err.message, "Invalid user id");
  assertEquals(err.graphUserMsg, "x");
  assertEquals(err.graphCode, 110);
  assertEquals(err.graphSubcode, 2207018);
  assertEquals(classifyPublishError(err), "COLLABORATOR_INVALID");
});

Deno.test("throwGraphError: no error_user_msg → graphUserMsg undefined", () => {
  try {
    throwGraphError({ error: { message: "boom", code: 1 } });
  } catch (e) {
    // deno-lint-ignore no-explicit-any
    assertEquals((e as any).graphUserMsg, undefined);
  }
});

// ─── Builders ─────────────────────────────────────────────────────

Deno.test("createSingleImageContainer: collaborators sent as a JSON array only when non-empty", async () => {
  const f = stubGraph();
  try {
    await createSingleImageContainer("ig", "tok", "https://i/1.jpg", "cap", { collaborators: ["a", "b"] });
    await createSingleImageContainer("ig", "tok", "https://i/1.jpg", "cap", { collaborators: [] });
    await createSingleImageContainer("ig", "tok", "https://i/1.jpg", "cap");
    await createSingleImageContainer("ig", "tok", "https://i/1.jpg", "cap", { timeoutMs: 5_000 });
    assertEquals(f.calls[0].body.collaborators, ["a", "b"]);
    assertEquals(f.calls[0].body.image_url, "https://i/1.jpg");
    for (const c of f.calls.slice(1)) assert(!("collaborators" in c.body), "empty/absent must omit the key");
  } finally {
    f.restore();
  }
});

Deno.test("createVideoContainer: collaborators alongside cover/trial opts, omitted when empty", async () => {
  const f = stubGraph();
  try {
    await createVideoContainer("ig", "tok", "https://v/1.mp4", "cap", {
      coverUrl: "https://v/cover.jpg",
      collaborators: ["a", "b"],
      timeoutMs: 5_000,
    });
    await createVideoContainer("ig", "tok", "https://v/1.mp4", "cap", { collaborators: [] });
    await createVideoContainer("ig", "tok", "https://v/1.mp4", "cap");
    assertEquals(f.calls[0].body.collaborators, ["a", "b"]);
    assertEquals(f.calls[0].body.cover_url, "https://v/cover.jpg");
    assertEquals(f.calls[0].body.media_type, "REELS");
    assert(!("collaborators" in f.calls[1].body));
    assert(!("collaborators" in f.calls[2].body));
  } finally {
    f.restore();
  }
});

Deno.test("createCarouselParentContainer: collaborators only when non-empty", async () => {
  const f = stubGraph();
  try {
    await createCarouselParentContainer("ig", "tok", ["k1", "k2"], "cap", { collaborators: ["a", "b"] });
    await createCarouselParentContainer("ig", "tok", ["k1", "k2"], "cap", { collaborators: [], timeoutMs: 5_000 });
    await createCarouselParentContainer("ig", "tok", ["k1", "k2"], "cap");
    assertEquals(f.calls[0].body.collaborators, ["a", "b"]);
    assertEquals(f.calls[0].body.children, "k1,k2");
    assert(!("collaborators" in f.calls[1].body));
    assert(!("collaborators" in f.calls[2].body));
  } finally {
    f.restore();
  }
});

// ─── createContainerForPost ───────────────────────────────────────

Deno.test("createContainerForPost: feed image carries collaborators", async () => {
  const f = stubGraph();
  try {
    const { db } = makeDb({ media: [link(0, 1, "image")] });
    await createContainerForPost(db, { ...base, useCover: false, tipo: "feed", collaborators: ["a", "b"] });
    assertEquals(f.calls.length, 1);
    assertEquals(f.calls[0].body.collaborators, ["a", "b"]);
  } finally {
    f.restore();
  }
});

Deno.test("createContainerForPost: reels with cover carries collaborators", async () => {
  const f = stubGraph();
  try {
    const { db } = makeDb({ media: [link(0, 1, "video", "thumb/1.jpg")] });
    const res = await createContainerForPost(db, { ...base, useCover: true, tipo: "reels", collaborators: ["a"] });
    assertEquals(f.calls[0].body.collaborators, ["a"]);
    assert(f.calls[0].body.cover_url, "cover still applied");
    assert(res.coverVideoUrl, "cover video url returned");
  } finally {
    f.restore();
  }
});

Deno.test("createContainerForPost: coverless retry (useCover:false) still sends collaborators", async () => {
  const f = stubGraph();
  try {
    const { db } = makeDb({ media: [link(0, 1, "video", "thumb/1.jpg")] });
    await createContainerForPost(db, { ...base, useCover: false, tipo: "reels", collaborators: ["a"] });
    assert(!("cover_url" in f.calls[0].body), "cover dropped on retry");
    assertEquals(f.calls[0].body.collaborators, ["a"]);
  } finally {
    f.restore();
  }
});

Deno.test("createContainerForPost: collaborators null (old claim RPC) → no collaborators key", async () => {
  const f = stubGraph();
  try {
    const { db } = makeDb({ media: [link(0, 1, "image")] });
    await createContainerForPost(db, { ...base, useCover: false, tipo: "feed", collaborators: null });
    await createContainerForPost(db, { ...base, useCover: false, tipo: "feed" });
    for (const c of f.calls) assert(!("collaborators" in c.body));
  } finally {
    f.restore();
  }
});

Deno.test("createContainerForPost: trial + collaborators throws before any fetch", async () => {
  const f = stubGraph();
  try {
    const ctx = makeDb({ media: [link(0, 1, "video")] });
    const err = await rejects(() =>
      createContainerForPost(ctx.db, {
        ...base,
        useCover: false,
        tipo: "reels",
        trialStrategy: "auto",
        collaborators: ["a"],
      })
    );
    assertEquals(err.message, "Reels de teste não aceitam colaboradores.");
    assertEquals(f.calls.length, 0);
    assertEquals(ctx.counters.mediaReads, 0, "guard runs before fetchPostMedia");
  } finally {
    f.restore();
  }
});

Deno.test("createContainerForPost: stories + collaborators throws before any fetch", async () => {
  const f = stubGraph();
  try {
    const ctx = makeDb({ media: [link(0, 1, "image")] });
    const err = await rejects(() =>
      createContainerForPost(ctx.db, { ...base, useCover: false, tipo: "stories", collaborators: ["a"] })
    );
    assertEquals(err.message, "Stories não aceitam colaboradores.");
    assertEquals(f.calls.length, 0);
    assertEquals(ctx.counters.mediaReads, 0);
  } finally {
    f.restore();
  }
});

Deno.test("createContainerForPost: stories with an empty list still publish (no collaborators key)", async () => {
  const f = stubGraph();
  try {
    const { db } = makeDb({ media: [link(0, 1, "image")] });
    await createContainerForPost(db, { ...base, useCover: false, tipo: "stories", collaborators: [] });
    assertEquals(f.calls[0].body.media_type, "STORIES");
    assert(!("collaborators" in f.calls[0].body));
  } finally {
    f.restore();
  }
});

// ─── advanceCarouselContainer ─────────────────────────────────────

Deno.test("advanceCarouselContainer: parent carries collaborators, children never do", async () => {
  const f = stubGraph();
  try {
    const { db } = makeDb({ children: null, media: [link(0, 11, "image"), link(1, 12, "image")] });
    const res = await advanceCarouselContainer(db, {
      ...base,
      maxPolls: 1,
      intervalMs: 0,
      collaborators: ["a", "b"],
    });
    assert(res.allReady);
    const posts = f.calls.filter((c) => c.body);
    const childBodies = posts.filter((c) => c.body.is_carousel_item);
    const parentBodies = posts.filter((c) => c.body.media_type === "CAROUSEL");
    assertEquals(childBodies.length, 2);
    for (const c of childBodies) assert(!("collaborators" in c.body), "child must not carry collaborators");
    assertEquals(parentBodies.length, 1);
    assertEquals(parentBodies[0].body.collaborators, ["a", "b"]);
  } finally {
    f.restore();
  }
});

Deno.test("advanceCarouselContainer: retry with persisted children sends the NEW list on the new parent only", async () => {
  // Review Focus 2: a carousel failed COLLABORATOR_INVALID after its children
  // were persisted; the user fixed the list and retried. The children are
  // reused (no new child POST), and the new parent carries the new list.
  const f = stubGraph();
  try {
    const persisted = [
      { file_id: 11, kind: "image", container_id: "kid-1", ready: true },
      { file_id: 12, kind: "image", container_id: "kid-2", ready: true },
    ];
    const { db } = makeDb({ children: persisted, media: [link(0, 11, "image"), link(1, 12, "image")] });
    const res = await advanceCarouselContainer(db, { ...base, collaborators: ["nova.conta"] });
    assert(res.allReady);
    const posts = f.calls.filter((c) => c.body);
    assertEquals(posts.length, 1, "only the parent is created");
    assertEquals(posts[0].body.media_type, "CAROUSEL");
    assertEquals(posts[0].body.children, "kid-1,kid-2");
    assertEquals(posts[0].body.collaborators, ["nova.conta"]);
  } finally {
    f.restore();
  }
});

Deno.test("advanceCarouselContainer: no collaborators (null) → parent omits the key", async () => {
  const f = stubGraph();
  try {
    const persisted = [
      { file_id: 11, kind: "image", container_id: "kid-1", ready: true },
      { file_id: 12, kind: "image", container_id: "kid-2", ready: true },
    ];
    const { db } = makeDb({ children: persisted, media: [link(0, 11, "image"), link(1, 12, "image")] });
    await advanceCarouselContainer(db, { ...base, collaborators: null });
    const parent = f.calls.find((c) => c.body?.media_type === "CAROUSEL");
    assert(parent && !("collaborators" in parent.body));
  } finally {
    f.restore();
  }
});

Deno.test("advanceCarouselContainer: trial + collaborators throws the collaborator message first, no fetch", async () => {
  const f = stubGraph();
  try {
    const ctx = makeDb({ children: null, media: [link(0, 11, "image"), link(1, 12, "image")] });
    const err = await rejects(() =>
      advanceCarouselContainer(ctx.db, { ...base, trialStrategy: "manual", collaborators: ["a"] })
    );
    assertEquals(err.message, "Reels de teste não aceitam colaboradores.");
    assertEquals(f.calls.length, 0);
    assertEquals(ctx.counters.mediaReads, 0);
  } finally {
    f.restore();
  }
});

// ─── Handler publish-now: first attempt, coverless retry, failure writer ──

Deno.env.set("TOKEN_ENCRYPTION_KEY", "test-token-key");
const { createSupabaseQueryMock } = await import("../../../test/shared/supabaseMock.ts");
const { createPublishHandler } = await import("../instagram-publish/handler.ts");

async function encryptedToken(value = "ig-token") {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode("test-token-key".padEnd(32, "0").slice(0, 32)),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = new Uint8Array(12);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(value)));
  const combined = new Uint8Array(iv.length + data.length);
  combined.set(iv);
  combined.set(data, iv.length);
  return btoa(String.fromCharCode(...combined));
}

const imageLink = {
  sort_order: 0,
  files: {
    id: 2, kind: "image", mime_type: "image/jpeg", size_bytes: 1000,
    width: 1080, height: 1080, duration_seconds: null, r2_key: "img/2.jpg", thumbnail_r2_key: null,
  },
};
const reelLink = {
  sort_order: 0,
  files: {
    id: 3, kind: "video", mime_type: "video/mp4", size_bytes: 10_000_000,
    width: 1080, height: 1920, duration_seconds: 30, r2_key: "vid/3.mp4", thumbnail_r2_key: "thumb/3.jpg",
  },
};

async function seedPublishNow(
  db: ReturnType<typeof createSupabaseQueryMock>,
  tipo: string,
  fileLink: unknown,
  collaborators: unknown,
) {
  db.withAuth({ id: "actor-1" });
  const postRow = {
    id: 1, status: "aprovado_cliente", workflow_id: 9, cliente_id: 5,
    scheduled_at: "2030-01-01T12:00:00Z", ig_caption: "legenda", instagram_container_id: null,
    publish_retry_count: 0, tipo, ig_trial_strategy: null, ig_collaborators: collaborators,
  };
  db.queue("workflow_posts", "select", { data: postRow, error: null }); // handler access check
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("effective_plan_feature", { data: true, error: null });
  db.queue("workflow_posts", "select", { data: postRow, error: null }); // validateForScheduling
  db.queue("post_file_links", "select", { data: [fileLink], error: null }); // validateForScheduling
  db.queue("instagram_accounts", "select", {
    data: {
      encrypted_access_token: await encryptedToken(),
      instagram_user_id: "ig-user",
      token_expires_at: "2030-01-01T12:00:00Z",
      authorization_status: "connected",
    },
    error: null,
  });
  db.queueRpc("record_post_status_change", { data: null, error: null }); // processing marker
  db.queue("post_file_links", "select", { data: [fileLink], error: null }); // createContainerForPost
}

function publishNowRequest() {
  return new Request("http://x/instagram-publish/publish-now/1", {
    method: "POST",
    headers: { authorization: "Bearer t" },
  });
}

function makeHandler(db: ReturnType<typeof createSupabaseQueryMock>) {
  return createPublishHandler({
    buildCorsHeaders: () => ({}),
    createDb: () => db as never,
    createServiceDb: () => db as never,
  });
}

Deno.test("publish-now: COLLABORATOR_INVALID is recorded with the refused names, response stays generic", async () => {
  const db = createSupabaseQueryMock();
  await seedPublishNow(db, "feed", imageLink, ["ana", "clinicaviva"]);
  const original = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  const bodies: any[] = [];
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    if (init?.body) bodies.push(JSON.parse(String(init.body)));
    return Promise.resolve(
      new Response(
        JSON.stringify({
          error: {
            message: "Invalid user id",
            code: 110,
            error_subcode: 2207018,
            error_user_msg: "Os seguintes usuários não podem ser acessados: clinicaviva",
          },
        }),
        { status: 400 },
      ),
    );
  }) as typeof fetch;
  let res: Response;
  try {
    res = await makeHandler(db)(publishNowRequest());
  } finally {
    globalThis.fetch = original;
  }

  assertEquals(res.status, 500);
  const text = await res.text();
  assert(!text.includes("clinicaviva"), "Meta's text never reaches the client");
  assertEquals(bodies[0].collaborators, ["ana", "clinicaviva"], "first attempt carries collaborators");

  const failIdx = db.calls.findIndex((c) =>
    c.table === "rpc:record_post_status_change" &&
    (c.payload as Record<string, unknown>).p_new_status === "falha_publicacao"
  );
  assert(failIdx >= 0, "status flips to falha_publicacao");
  const failFields = (db.calls[failIdx].payload as { p_fields: Record<string, unknown> }).p_fields;
  assertEquals(failFields.publish_error_code, "COLLABORATOR_INVALID");
  assert(!("ig_collaborators_refused" in failFields), "column is outside the RPC allowlist");

  const refusedIdx = db.calls.findIndex((c) =>
    c.table === "workflow_posts" && c.operation === "update" &&
    JSON.stringify(c.payload) === JSON.stringify({ ig_collaborators_refused: ["clinicaviva"] })
  );
  assert(refusedIdx > failIdx, "refused set written separately after the RPC");
});

Deno.test("publish-now: other failures never write ig_collaborators_refused", async () => {
  const db = createSupabaseQueryMock();
  await seedPublishNow(db, "feed", imageLink, ["ana"]);
  const original = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ error: { message: "Please retry your request later", code: 2 } }), {
        status: 500,
      }),
    )) as typeof fetch;
  try {
    await makeHandler(db)(publishNowRequest());
  } finally {
    globalThis.fetch = original;
  }
  const wrote = db.calls.some((c) =>
    c.table === "workflow_posts" && c.operation === "update" &&
    "ig_collaborators_refused" in (c.payload as object)
  );
  assertEquals(wrote, false);
});

Deno.test("publish-now: coverless retry drops the cover but keeps collaborators", async () => {
  const db = createSupabaseQueryMock();
  await seedPublishNow(db, "reels", reelLink, ["ana"]);
  db.queueRpc("mark_platform_published", { data: null, error: null });
  const original = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  const mediaBodies: any[] = [];
  let n = 0;
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (init?.body && url.endsWith("/media")) {
      mediaBodies.push(JSON.parse(String(init.body)));
      n += 1;
      return Promise.resolve(new Response(JSON.stringify({ id: `container-${n}` })));
    }
    if (init?.body && url.includes("media_publish")) {
      return Promise.resolve(new Response(JSON.stringify({ id: "media-1" })));
    }
    if (url.includes("fields=permalink")) {
      return Promise.resolve(new Response(JSON.stringify({ permalink: null })));
    }
    // First container (with cover) fails processing; the coverless one finishes.
    const status = url.includes("/container-1?") ? "ERROR" : "FINISHED";
    return Promise.resolve(new Response(JSON.stringify({ status_code: status })));
  }) as typeof fetch;
  let res: Response;
  try {
    res = await makeHandler(db)(publishNowRequest());
  } finally {
    globalThis.fetch = original;
  }
  assertEquals(res.status, 200);
  assertEquals(mediaBodies.length, 2);
  assert(mediaBodies[0].cover_url, "first attempt has the cover");
  assertEquals(mediaBodies[0].collaborators, ["ana"]);
  assert(!("cover_url" in mediaBodies[1]), "retry drops the cover");
  assertEquals(mediaBodies[1].collaborators, ["ana"], "retry keeps collaborators");
});
