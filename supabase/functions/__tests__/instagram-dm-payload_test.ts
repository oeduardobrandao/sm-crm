import { assertEquals } from "./assert.ts";
import {
  buildCardMessage,
  buildCardText,
  buildFallbackText,
  buildPrivateReplyMessage,
  parseDmButtons,
  parseDmMedia,
} from "../_shared/instagram-dm-payload.ts";

// ---------- parseDmButtons (defensivo: nunca lança) ----------

Deno.test("parseDmButtons: undefined/null/não-array -> []", () => {
  assertEquals(parseDmButtons(undefined), []);
  assertEquals(parseDmButtons(null), []);
  assertEquals(parseDmButtons("[]"), []);
  assertEquals(parseDmButtons({ title: "x", url: "https://x" }), []);
  assertEquals(parseDmButtons(42), []);
});

Deno.test("parseDmButtons: itens inválidos são descartados em silêncio", () => {
  assertEquals(
    parseDmButtons([
      { title: "Ok", url: "https://a.b" },
      { title: "", url: "https://a.b" }, // título vazio
      { title: "Sem url" }, // sem url
      { url: "https://a.b" }, // sem título
      { title: "Ftp", url: "ftp://a.b" }, // esquema inválido
      { title: "Rel", url: "/caminho" }, // relativa
      { title: "Phish", url: "https://accounts.instagram.com@evil.example/x" }, // userinfo
      { title: "Back", url: "https://good.com\\@evil.com/phish" }, // barra invertida
      "string", // não-objeto
      null,
    ]),
    [{ title: "Ok", url: "https://a.b" }],
  );
});

Deno.test("parseDmButtons: @ no path é válido (perfis do Instagram)", () => {
  assertEquals(
    parseDmButtons([{ title: "Perfil", url: "https://instagram.com/@handle" }]),
    [{ title: "Perfil", url: "https://instagram.com/@handle" }],
  );
});

Deno.test("parseDmButtons: corta em 3 itens, trim e corte de título em 20", () => {
  const many = [1, 2, 3, 4].map((i) => ({ title: `Botão ${i}`, url: `https://a.b/${i}` }));
  assertEquals(parseDmButtons(many).length, 3);
  assertEquals(
    parseDmButtons([{ title: "  Um título muito comprido mesmo  ", url: "https://a.b" }]),
    [{ title: "Um título muito comp", url: "https://a.b" }],
  );
});

// ---------- buildPrivateReplyMessage ----------

Deno.test("buildPrivateReplyMessage: sem botões -> { text }", () => {
  assertEquals(buildPrivateReplyMessage("oi", []), { text: "oi" });
});

Deno.test("buildPrivateReplyMessage: com botões -> button template exato", () => {
  assertEquals(
    buildPrivateReplyMessage("Escolha:", [
      { title: "Agendar", url: "https://agenda.x" },
      { title: "WhatsApp", url: "https://wa.me/55" },
    ]),
    {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "Escolha:",
          buttons: [
            { type: "web_url", url: "https://agenda.x", title: "Agendar" },
            { type: "web_url", url: "https://wa.me/55", title: "WhatsApp" },
          ],
        },
      },
    },
  );
});

// ---------- buildFallbackText ----------

Deno.test("buildFallbackText: anexa Título: url por linha", () => {
  assertEquals(
    buildFallbackText("Olá!", [
      { title: "Agendar", url: "https://agenda.x" },
      { title: "Site", url: "https://site.x" },
    ]),
    "Olá!\n\nAgendar: https://agenda.x\nSite: https://site.x",
  );
});

Deno.test("buildFallbackText: > 1000 chars corta o TEXTO, nunca as URLs", () => {
  const urls = [{ title: "Link", url: `https://a.b/${"x".repeat(80)}` }];
  const out = buildFallbackText("t".repeat(990), urls);
  assertEquals(out.length <= 1000, true);
  assertEquals(out.includes(urls[0].url), true);
  assertEquals(out.startsWith("ttt"), true);
  assertEquals(out.includes("…"), true);
});

Deno.test("buildFallbackText: extremo com só URLs enormes mantém as que cabem", () => {
  const btn = (i: number) => ({ title: `L${i}`, url: `https://a.b/${"y".repeat(400)}${i}` });
  const out = buildFallbackText("", [btn(1), btn(2), btn(3)]);
  assertEquals(out.length <= 1000, true);
  assertEquals(out.length > 0, true);
  assertEquals(out.includes(btn(1).url), true);
  assertEquals(out.includes(btn(2).url), true);
  // a 3ª (não cabe) fica de fora, sem quebrar as anteriores
  assertEquals(out.includes(btn(3).url), false);
});

// ---------- parseDmMedia ----------

Deno.test("parseDmMedia: objeto válido vira DmMedia; malformado/ausente vira null", () => {
  assertEquals(
    parseDmMedia({ key: "automation-media/w1/a.jpg", content_type: "image/jpeg", size_bytes: 1000 }),
    { key: "automation-media/w1/a.jpg", contentType: "image/jpeg", sizeBytes: 1000 },
  );
  assertEquals(parseDmMedia(null), null);
  assertEquals(parseDmMedia(undefined), null);
  assertEquals(parseDmMedia({ key: 7 }), null);
  assertEquals(parseDmMedia("x"), null);
});

// ---------- buildCardMessage ----------

Deno.test("buildCardMessage: generic template com 1 elemento; subtitle e buttons só quando presentes", () => {
  assertEquals(
    buildCardMessage("Título", "Sub", "https://r2/x.jpg", [{ title: "Abrir", url: "https://a.b" }]),
    {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: "Título",
            subtitle: "Sub",
            image_url: "https://r2/x.jpg",
            buttons: [{ type: "web_url", url: "https://a.b", title: "Abrir" }],
          }],
        },
      },
    },
  );
  const noExtras = buildCardMessage("Só título", null, "https://r2/x.jpg", []);
  // deno-lint-ignore no-explicit-any
  const el = (noExtras as any).attachment.payload.elements[0];
  assertEquals(el, { title: "Só título", image_url: "https://r2/x.jpg" });
});

// ---------- buildCardText ----------

Deno.test("buildCardText: junta título e subtítulo; sem subtítulo devolve só o título", () => {
  assertEquals(buildCardText("A", "B"), "A\n\nB");
  assertEquals(buildCardText("A", null), "A");
});
