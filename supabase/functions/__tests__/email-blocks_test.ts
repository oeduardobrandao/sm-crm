import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import * as B from "../_shared/email/blocks.ts";

const XSS = `<script>alert("x")</script>`;

Deno.test("text blocks escape raw input exactly once", () => {
  const outs = [
    B.heading(XSS), B.paragraph(XSS), B.strong(XSS), B.sectionTitle(XSS), B.eyebrow(XSS),
    B.alert(XSS), B.quote(XSS, XSS), B.badge("info", XSS),
    B.detailRows([{ label: XSS, value: XSS }]),
    B.postList([{ titulo: XSS, tipo: "feed" }]),
    B.featureGrid([{ title: XSS, text: XSS }]),
    B.eventCard({ mes: XSS, dia: XSS, tileColor: "#12151a", titulo: XSS, lines: [XSS] }),
    B.dateList([XSS], 0), B.button("https://a.test", XSS), B.link("https://a.test", XSS),
  ];
  for (const h of outs) {
    assert(!h.includes("<script>"), `raw script leaked: ${h.slice(0, 80)}`);
    assert(h.includes("&lt;script&gt;"), `not escaped: ${h.slice(0, 80)}`);
    assert(!h.includes("&amp;lt;"), `double-escaped: ${h.slice(0, 80)}`);
  }
});

Deno.test("unsafe URLs never become href", () => {
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "", null]) {
    assertEquals(B.button(bad, "Ir"), "");
    assertEquals(B.fallbackLink(bad), "");
    assertEquals(B.link(bad, "Texto"), "Texto");
    const card = B.eventCard({ mes: "OUT", dia: "1", tileColor: "#12151a", titulo: "T", titleHref: bad, lines: [], meetingUrl: bad });
    assert(!card.includes("href="), "card rendered an unsafe href");
  }
});

Deno.test("safe URL is entity-encoded in the attribute", () => {
  assert(B.button("https://a.test/?a=1&b=2", "Ir").includes(`href="https://a.test/?a=1&amp;b=2"`));
});

Deno.test("button: Outlook-safe cell with bgcolor; brand colour guarded and contrast-flipped", () => {
  const ink = B.button("https://a.test", "Ir");
  assert(ink.includes(`bgcolor="#12151a"`) && ink.includes("color: #ffffff;"));
  const light = B.button("https://a.test", "Ir", { brandColor: "#facc15" });
  assert(light.includes(`bgcolor="#facc15"`) && light.includes("color: #171717;"), "light brand must flip text dark");
  const evil = B.button("https://a.test", "Ir", { brandColor: "red;x:url(y)" });
  assert(evil.includes(`bgcolor="#eab308"`) && !evil.includes("url(y)"));
});

Deno.test("dateTile header text flips on a light colour", () => {
  assert(B.dateTile({ mes: "OUT", dia: "15", color: "#facc15" }).includes("color: #171717;"));
  assert(B.dateTile({ mes: "OUT", dia: "15", color: "#12151a" }).includes("color: #ffffff;"));
});

Deno.test("postList: format label + dot, unknown tipo falls back, no emoji", () => {
  const h = B.postList([{ titulo: "A", tipo: "reels" }, { titulo: "B", tipo: "zzz" }]);
  assert(h.includes("Reels") && h.includes("#e1306c"));
  assert(h.includes(">Post<") && h.includes("#64748b"));
  assert(!/[🖼🗂🎬📱]/u.test(h));
});

Deno.test("dateList: one <li> per item, 'e mais N datas' only when N > 0", () => {
  const h = B.dateList(["a", "b"], 3);
  assertEquals((h.match(/<li/g) ?? []).length, 2);
  assert(h.includes("e mais 3 datas"));
  assert(!B.dateList(["a"], 0).includes("e mais"));
  assert(B.dateList(["a"], 1).includes("e mais 1 data<"));
  assert(B.dateList(["a"], 0, true).includes("line-through"));
});

Deno.test("long unbroken strings wrap instead of widening the card", () => {
  const long = "x".repeat(200);
  assert(B.fallbackLink(`https://a.test/${long}`).includes("word-break: break-all"));
  assert(B.postList([{ titulo: long, tipo: "feed" }]).includes("word-break: break-word"));
  assert(B.eventCard({ mes: "OUT", dia: "1", tileColor: "#12151a", titulo: long, lines: [] }).includes("word-break: break-word"));
  assert(B.heading(long).includes("word-break: break-word"));
});

Deno.test("no flex/grid layout in any block", () => {
  const all = [B.steps(["a"]), B.featureGrid([{ title: "a", text: "b" }]), B.callout("x"), B.signature(),
    B.eventCard({ mes: "OUT", dia: "1", tileColor: "#12151a", titulo: "t", lines: ["l"] })].join("");
  assert(!/display:\s*(flex|grid)/.test(all));
});
