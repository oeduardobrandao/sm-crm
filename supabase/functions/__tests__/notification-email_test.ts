import { assert, assertEquals } from "./assert.ts";
import {
  buildDigestIdempotencyKey,
  digestSubject,
  resolveDigestItem,
} from "../_shared/notification-email.ts";

Deno.test("resolveDigestItem: publish failure reuses getPublishErrorDisplay copy", () => {
  const item = resolveDigestItem({
    type: "post_publish_failed",
    metadata: { publish_error_code: "TOKEN_EXPIRED", client_name: "ACME", post_title: "Lançamento" },
    link: "/entregas?drawer=1&post=2",
  });
  assertEquals(item.priority, 1);
  assertEquals(item.heading, "Conexão com o Instagram expirou");
  assert(item.body!.includes("Reconecte"));
  assertEquals(item.context, "ACME · Lançamento");
  assertEquals(item.link, "/entregas?drawer=1&post=2");
});

Deno.test("resolveDigestItem: mention priority is last, uses actor + excerpt", () => {
  const item = resolveDigestItem({
    type: "mention",
    metadata: { actor_name: "Ana", context_title: "Post A", excerpt: "veja isso" },
    link: "/x",
  });
  assertEquals(item.priority, 5);
  assertEquals(item.heading, "Ana mencionou você");
  assertEquals(item.body, "veja isso");
  assertEquals(item.context, "Post A");
});

Deno.test("resolveDigestItem: unknown/missing metadata degrades gracefully, no throw", () => {
  const item = resolveDigestItem({ type: "task_assigned", metadata: null, link: null });
  assertEquals(item.priority, 4);
  assertEquals(item.link, "/");
  assert(item.heading.length > 0);
});

Deno.test("digestSubject: single vs multiple", () => {
  const one = digestSubject([{ priority: 1, heading: "x", link: "/" }]);
  const many = digestSubject([
    { priority: 1, heading: "x", link: "/" },
    { priority: 2, heading: "y", link: "/" },
    { priority: 5, heading: "z", link: "/" },
  ]);
  assert(!one.includes("—"), "no em dash in subject");
  assertEquals(many, "Você tem 3 novidades no Mesaas");
});

Deno.test("buildDigestIdempotencyKey: stable for same id set, differs when it changes", async () => {
  const a = await buildDigestIdempotencyKey("u1", ["b", "a"]);
  const b = await buildDigestIdempotencyKey("u1", ["a", "b"]); // order-insensitive
  const c = await buildDigestIdempotencyKey("u1", ["a", "b", "c"]);
  assertEquals(a, b);
  assert(a !== c);
  assert(a.startsWith("notif-digest:u1:"));
});
