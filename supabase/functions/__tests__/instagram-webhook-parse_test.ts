import { assertEquals } from "./assert.ts";
import { parseWebhookDelivery } from "../instagram-webhook/parse.ts";

const value = (id: string) => ({
  id,
  from: { id: "u1", username: "fulano" },
  media: { id: "media9" },
  text: "quero a promo",
});

Deno.test("forma entry[].changes[]: múltiplas entries e múltiplos changes", () => {
  const out = parseWebhookDelivery({
    object: "instagram",
    entry: [
      { id: "acc1", time: 1723640400, changes: [
        { field: "comments", value: value("c1") },
        { field: "comments", value: value("c2") },
        { field: "mentions", value: { id: "x" } },
      ]},
      { id: "acc2", time: 1723640401, changes: [{ field: "comments", value: value("c3") }] },
    ],
  });
  assertEquals(out.map((e) => [e.igUserId, e.commentId]), [["acc1", "c1"], ["acc1", "c2"], ["acc2", "c3"]]);
  assertEquals(out[0].commenterId, "u1");
  assertEquals(out[0].mediaId, "media9");
});

Deno.test("forma entry[].field/value (fixture de comentário próprio da Meta)", () => {
  const out = parseWebhookDelivery({
    object: "instagram",
    entry: [{ id: "acc1", time: 1723640400, field: "comments", value: value("c4") }],
  });
  assertEquals(out.length, 1);
  assertEquals(out[0].commentId, "c4");
});

Deno.test("payload sem comentários, malformado ou vazio -> []", () => {
  assertEquals(parseWebhookDelivery({ object: "instagram", entry: [] }), []);
  assertEquals(parseWebhookDelivery({}), []);
  assertEquals(parseWebhookDelivery(null), []);
  assertEquals(parseWebhookDelivery({ entry: [{ id: "a", changes: [{ field: "story_insights", value: {} }] }] }), []);
});

Deno.test("value sem from/parent_id não quebra; timestamp epoch vira ISO", () => {
  const out = parseWebhookDelivery({
    entry: [{ id: "acc1", time: 1723640400, changes: [{ field: "comments", value: { id: "c5", created_time: 1723640400 } }] }],
  });
  assertEquals(out[0].commenterId, undefined);
  assertEquals(out[0].timestamp, new Date(1723640400 * 1000).toISOString());
});

Deno.test("timestamp string: ISO válida normaliza, malformada vira undefined", () => {
  const out = parseWebhookDelivery({
    entry: [{ id: "acc1", time: 1723640400, changes: [
      { field: "comments", value: { id: "c_iso", timestamp: "2026-08-14T17:27:00+0000" } },
      { field: "comments", value: { id: "c_bad", timestamp: "not-a-date" } },
    ]}],
  });
  assertEquals(out.length, 2);
  assertEquals(out[0].timestamp, new Date("2026-08-14T17:27:00+0000").toISOString());
  assertEquals(out[1].timestamp, undefined);
});

Deno.test("malformed timestamp (NaN, Infinity, out-of-range): vira undefined; change envenenado não derruba a entrega", () => {
  const out = parseWebhookDelivery({
    entry: [{ id: "acc1", time: 1723640400, changes: [
      { field: "comments", value: { id: "c_nan", created_time: NaN } },
      { field: "comments", value: { id: "c_inf", created_time: 1e20 } },
      { field: "comments", value: { id: "c_valid", created_time: 1723640400 } },
    ]}],
  });
  assertEquals(out.length, 3);
  assertEquals(out[0].timestamp, undefined);
  assertEquals(out[1].timestamp, undefined);
  assertEquals(out[2].timestamp, new Date(1723640400 * 1000).toISOString());
});
