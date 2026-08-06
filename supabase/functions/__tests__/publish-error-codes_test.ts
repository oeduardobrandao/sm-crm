import { assertEquals } from "./assert.ts";
import { classifyPublishError, NON_RETRYABLE_CODES } from "../_shared/publish-error-codes.ts";

function graphErr(message: string, graphCode?: number): Error {
  const e = new Error(message) as Error & { graphCode?: number };
  e.graphCode = graphCode;
  return e;
}

// Casos reais de produção (workflow_posts.publish_error, 2026-08-06)
Deno.test("classify: token expirado via graphCode 190", () => {
  assertEquals(classifyPublishError(graphErr("Error validating access token", 190)), "TOKEN_EXPIRED");
});

Deno.test("classify: token expirado via err.code legado", () => {
  const e = new Error("x") as Error & { code?: string };
  e.code = "TOKEN_EXPIRED";
  assertEquals(classifyPublishError(e), "TOKEN_EXPIRED");
});

Deno.test("classify: 'reduce the amount of data' vence o transiente mesmo com graphCode 1", () => {
  assertEquals(
    classifyPublishError(graphErr("Please reduce the amount of data you're asking for, then retry your request", 1)),
    "MEDIA_TOO_LARGE",
  );
});

Deno.test("classify: post sem mídia", () => {
  assertEquals(classifyPublishError(new Error("No media files found")), "NO_MEDIA");
});

Deno.test("classify: carrossel acima do limite (mensagem nossa)", () => {
  assertEquals(
    classifyPublishError(new Error("Carrossel do Instagram aceita no máximo 10 itens (este post tem 12).")),
    "CAROUSEL_LIMIT",
  );
});

Deno.test("classify: carrossel inválido (mensagem da Meta)", () => {
  assertEquals(
    classifyPublishError(graphErr("Unsupported post type. The post has too little or too many attachments to qualify as a carousel", 100)),
    "CAROUSEL_LIMIT",
  );
});

Deno.test("classify: container falhou no processamento", () => {
  assertEquals(classifyPublishError(new Error("Container failed processing on Instagram's side")), "MEDIA_UNSUPPORTED");
  assertEquals(classifyPublishError(new Error("Container falhou no processamento do Instagram")), "MEDIA_UNSUPPORTED");
  assertEquals(classifyPublishError(new Error("Story segment 2 falhou no processamento do Instagram")), "MEDIA_UNSUPPORTED");
});

Deno.test("classify: formato de vídeo não suportado via graphSubcode 2207026", () => {
  const e = new Error("Media type not supported") as Error & { graphSubcode?: number };
  e.graphSubcode = 2207026;
  assertEquals(classifyPublishError(e), "MEDIA_UNSUPPORTED");
});

Deno.test("classify: container expirado (objeto não existe)", () => {
  assertEquals(
    classifyPublishError(graphErr("Unsupported post request. Object with ID '26843423545300150' does not exist, cannot be loaded due to missing permissions, or does not support this operation", 100)),
    "CONTAINER_EXPIRED",
  );
  // sem graphCode (erro antigo persistido): ainda classifica pela mensagem
  assertEquals(
    classifyPublishError(new Error("Object with ID 'x' does not exist, cannot be loaded due to missing permissions")),
    "CONTAINER_EXPIRED",
  );
});

Deno.test("classify: rate limit por graphCode", () => {
  for (const code of [4, 9, 17, 32, 613]) {
    assertEquals(classifyPublishError(graphErr("Application request limit reached", code)), "RATE_LIMIT");
  }
});

Deno.test("classify: transiente da Meta", () => {
  assertEquals(
    classifyPublishError(graphErr("An unexpected error has occurred. Please retry your request later.", 2)),
    "IG_TRANSIENT",
  );
  assertEquals(
    classifyPublishError(new Error("An unexpected error has occurred. Please retry your request later.")),
    "IG_TRANSIENT",
  );
});

Deno.test("classify: erros internos", () => {
  assertEquals(classifyPublishError(new Error("Tag length overflows ciphertext")), "INTERNAL");
  assertEquals(classifyPublishError(new Error("mark_platform_published failed for post 1: boom")), "INTERNAL");
  assertEquals(classifyPublishError(new Error("Failed to persist story segment container_id: x")), "INTERNAL");
});

Deno.test("classify: fallback UNKNOWN", () => {
  assertEquals(classifyPublishError(new Error("algo inédito")), "UNKNOWN");
  assertEquals(classifyPublishError(undefined), "UNKNOWN");
  assertEquals(classifyPublishError("string solta"), "UNKNOWN");
});

Deno.test("NON_RETRYABLE_CODES: exatamente os 5 códigos que o cron não deve reprocessar", () => {
  assertEquals(
    [...NON_RETRYABLE_CODES].sort(),
    ["CAROUSEL_LIMIT", "MEDIA_TOO_LARGE", "MEDIA_UNSUPPORTED", "NO_MEDIA", "TOKEN_EXPIRED"],
  );
});
