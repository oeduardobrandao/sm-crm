// assertStringIncludes is NOT in the local ./assert.ts, which only exports
// assert, assertEquals and readJson. It comes from the pinned std URL, the same
// way invite-email_test.ts imports it. Keep the 0.224.0 pin: Deno's
// min-dep-age check in CI rejects freshly published versions.
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { whatsAppSupportUrl } from "../_shared/whatsapp.ts";

const NUMBER = "5511999999999";

function textOf(url: string): string {
  return decodeURIComponent(new URL(url).searchParams.get("text") ?? "");
}

Deno.test("whatsAppSupportUrl builds a link with the first name", () => {
  const prev = Deno.env.get("WHATSAPP_SUPPORT_NUMBER");
  Deno.env.set("WHATSAPP_SUPPORT_NUMBER", NUMBER);
  try {
    const url = whatsAppSupportUrl({ firstName: "Ana" })!;
    assertStringIncludes(url, `https://wa.me/${NUMBER}?text=`);
    assertEquals(
      textOf(url),
      "Oi! Sou Ana. Acabei de criar minha conta no Mesaas e queria ajuda pra configurar.",
    );
  } finally {
    if (prev !== undefined) Deno.env.set("WHATSAPP_SUPPORT_NUMBER", prev);
    else Deno.env.delete("WHATSAPP_SUPPORT_NUMBER");
  }
});

Deno.test("whatsAppSupportUrl omits the name when absent", () => {
  const prev = Deno.env.get("WHATSAPP_SUPPORT_NUMBER");
  Deno.env.set("WHATSAPP_SUPPORT_NUMBER", NUMBER);
  try {
    const url = whatsAppSupportUrl({ firstName: null })!;
    assertEquals(
      textOf(url),
      "Oi! Acabei de criar minha conta no Mesaas e queria ajuda pra configurar.",
    );
  } finally {
    if (prev !== undefined) Deno.env.set("WHATSAPP_SUPPORT_NUMBER", prev);
    else Deno.env.delete("WHATSAPP_SUPPORT_NUMBER");
  }
});

Deno.test("whatsAppSupportUrl never emits an article before the name", () => {
  const prev = Deno.env.get("WHATSAPP_SUPPORT_NUMBER");
  Deno.env.set("WHATSAPP_SUPPORT_NUMBER", NUMBER);
  try {
    const text = textOf(whatsAppSupportUrl({ firstName: "Ana" })!);
    assertEquals(/Sou\s+(o|a|o\/a)\s/.test(text), false);
  } finally {
    if (prev !== undefined) Deno.env.set("WHATSAPP_SUPPORT_NUMBER", prev);
    else Deno.env.delete("WHATSAPP_SUPPORT_NUMBER");
  }
});

Deno.test("whatsAppSupportUrl fails closed on a missing or malformed number", () => {
  const prev = Deno.env.get("WHATSAPP_SUPPORT_NUMBER");
  try {
    for (const bad of ["", "   ", "+5511999999999", "55 11 99999-9999", "abc"]) {
      Deno.env.set("WHATSAPP_SUPPORT_NUMBER", bad);
      assertEquals(whatsAppSupportUrl({ firstName: "Ana" }), null);
    }
    Deno.env.delete("WHATSAPP_SUPPORT_NUMBER");
    assertEquals(whatsAppSupportUrl({ firstName: "Ana" }), null);
  } finally {
    if (prev !== undefined) Deno.env.set("WHATSAPP_SUPPORT_NUMBER", prev);
    else Deno.env.delete("WHATSAPP_SUPPORT_NUMBER");
  }
});
