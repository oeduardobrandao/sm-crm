# Falha na publicação com causas acionáveis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando um post falha ao publicar no Instagram, o CRM mostra a causa em português com ação sugerida, bloqueia agendamentos que violariam limites de mídia, e notifica in-app quando a falha exige ação humana.

**Architecture:** Um classificador em `_shared/` converte erros do Graph API e internos em um código estável persistido em `workflow_posts.publish_error_code`. O front mapeia código para copy PT + ação. O `validateMedia` existente vira módulo próprio e é espelhado no front para bloquear o botão de agendar. Um trigger de banco gera a notificação in-app.

**Tech Stack:** Deno edge functions, Postgres (migrations + trigger SECURITY DEFINER), React 19 + TanStack Query, Vitest, `deno test`.

**Spec:** `docs/superpowers/specs/2026-08-06-falha-publicacao-causas-acionaveis-design.md`

## Global Constraints

- Copy de UI em português, SEM em-dash (regra da casa; use ponto, dois-pontos ou "·").
- Migrations: prefixo de versão único. O tail de `origin/main` hoje é `20260806000001`. Este plano usa `20260807000001..3`. **Na hora do `gh pr create`, rode `git ls-tree --name-only origin/main:supabase/migrations | tail -5` e renumere acima do tail se algo novo entrou.**
- Toda migration que redefine função copia o corpo da definição MAIS RECENTE no repo (não de definições antigas).
- Rota de cliente é `/clientes/:id` (plural).
- `deno test` suja o `deno.lock` da raiz: rode `git checkout -- deno.lock` depois.
- Antes de considerar o trabalho pronto: `npm run lint`, `npm run format:check`, os 4 `tsc` (`apps/crm`, `apps/hub`, `apps/admin`, `tsconfig.scripts.json`), `npm run test`, `npm run test:functions`.
- Commits pequenos por task, com `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Extrair `instagram-limits.ts` (fonte única das regras de mídia)

**Files:**
- Create: `supabase/functions/_shared/instagram-limits.ts`
- Modify: `supabase/functions/_shared/instagram-publish-utils.ts:50-132` (remover definições movidas; importar e re-exportar)
- Test: `supabase/functions/__tests__/instagram-limits_test.ts`

**Interfaces:**
- Consumes: nada novo.
- Produces: `validateMedia(files: MediaFile[], opts?: { forStories?: boolean }): ValidationError[]`, `CAROUSEL_MAX_ITEMS`, `MediaFile`, `ValidationError` e as constantes `IMAGE_MAX_BYTES`, `VIDEO_MAX_BYTES`, `IMAGE_MIN_DIM`, `IMAGE_AR_MIN`, `STORY_IMAGE_AR_MIN`, `IMAGE_AR_MAX`, `VIDEO_AR_MIN`, `VIDEO_AR_MAX`, `VIDEO_MIN_DURATION`, `VIDEO_MAX_DURATION`, `STORY_VIDEO_MAX_DURATION`, `ALLOWED_IMAGE_MIMES`, `ALLOWED_VIDEO_MIMES` — todos EXPORTADOS (Task 9 compara no teste de paridade).

- [ ] **Step 1: Criar o módulo movendo o código verbatim**

Copiar de `instagram-publish-utils.ts` linhas 50-132 para `supabase/functions/_shared/instagram-limits.ts`, adicionando `export` em tudo (o conteúdo é idêntico ao atual; NÃO alterar nenhum limite):

```ts
// supabase/functions/_shared/instagram-limits.ts
// Fonte única dos limites de mídia da publicação via Instagram API.
// Módulo puro (sem APIs Deno): também é importado pelo teste de paridade
// do front (apps/crm/src/pages/entregas/__tests__/instagramLimits.test.ts).

export interface MediaFile {
  id: number;
  kind: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  r2_key: string;
  sort_order: number;
}

export interface ValidationError {
  file_id: number;
  message: string;
}

export const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const ALLOWED_VIDEO_MIMES = new Set(["video/mp4", "video/quicktime"]);
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 250 * 1024 * 1024;
export const IMAGE_MIN_DIM = 320;
export const IMAGE_AR_MIN = 3 / 4;
export const STORY_IMAGE_AR_MIN = 9 / 16;
export const IMAGE_AR_MAX = 1.91;
export const VIDEO_AR_MIN = 9 / 16;
export const VIDEO_AR_MAX = 1.25;
export const VIDEO_MIN_DURATION = 3;
export const VIDEO_MAX_DURATION = 90;
export const STORY_VIDEO_MAX_DURATION = 60;

/** Instagram Content Publishing API caps carousels at 10 items.
 *  (The native app allows 20, but the Graph API does not.) Stories are exempt
 *  — they publish as sequential segments, not a single carousel container. */
export const CAROUSEL_MAX_ITEMS = 10;

export function validateMedia(files: MediaFile[], opts?: { forStories?: boolean }): ValidationError[] {
  // ... corpo IDÊNTICO ao atual de instagram-publish-utils.ts:86-132, sem mudanças ...
}
```

(O corpo de `validateMedia` é o das linhas 86-132 atuais, colado sem alteração.)

- [ ] **Step 2: Substituir em `instagram-publish-utils.ts` por import + re-export**

Remover as linhas 50-132 (interfaces, constantes, `CAROUSEL_MAX_ITEMS`, `validateMedia`) e adicionar no topo, logo após o import de `./r2.ts`:

```ts
import { CAROUSEL_MAX_ITEMS, validateMedia } from "./instagram-limits.ts";
import type { MediaFile, ValidationError } from "./instagram-limits.ts";

export { CAROUSEL_MAX_ITEMS, validateMedia };
export type { MediaFile, ValidationError };
```

Atenção: `MediaFile` e `ValidationError` hoje são interfaces NÃO exportadas usadas por `validateForScheduling` e `ScheduleValidationResult`; o import de tipo acima cobre os usos internos.

- [ ] **Step 3: Escrever o teste Deno**

`supabase/functions/__tests__/instagram-limits_test.ts`:

```ts
import { assertEquals } from "./assert.ts";
import {
  validateMedia,
  CAROUSEL_MAX_ITEMS,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
} from "../_shared/instagram-limits.ts";

function img(overrides: Partial<Parameters<typeof validateMedia>[0][0]> = {}) {
  return {
    id: 1, kind: "image", mime_type: "image/jpeg", size_bytes: 1024,
    width: 1080, height: 1350, duration_seconds: null, r2_key: "k", sort_order: 0,
    ...overrides,
  };
}
function vid(overrides: Partial<Parameters<typeof validateMedia>[0][0]> = {}) {
  return {
    id: 2, kind: "video", mime_type: "video/mp4", size_bytes: 1024,
    width: 1080, height: 1920, duration_seconds: 30, r2_key: "k", sort_order: 0,
    ...overrides,
  };
}

Deno.test("instagram-limits: mídia válida passa sem erros", () => {
  assertEquals(validateMedia([img(), vid()]), []);
});

Deno.test("instagram-limits: imagem acima de 8 MB é recusada", () => {
  const errors = validateMedia([img({ size_bytes: IMAGE_MAX_BYTES + 1 })]);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message, "Imagem excede 8 MB (limite do Instagram)");
});

Deno.test("instagram-limits: vídeo acima de 250 MB é recusado", () => {
  const errors = validateMedia([vid({ size_bytes: VIDEO_MAX_BYTES + 1 })]);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message, "Vídeo excede 250 MB (limite do Instagram)");
});

Deno.test("instagram-limits: story valida duração de 60s", () => {
  const ok = validateMedia([vid({ duration_seconds: 75 })]);
  assertEquals(ok, []); // feed aceita até 90s
  const errors = validateMedia([vid({ duration_seconds: 75 })], { forStories: true });
  assertEquals(errors.length, 1);
});

Deno.test("instagram-limits: CAROUSEL_MAX_ITEMS é 10", () => {
  assertEquals(CAROUSEL_MAX_ITEMS, 10);
});
```

- [ ] **Step 4: Rodar os testes**

Run: `npm run test:functions` (a suíte toda: os testes existentes de `instagram-publish-gate_test.ts` provam que o re-export não quebrou `validateForScheduling`).
Expected: tudo verde. Depois: `git checkout -- deno.lock`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/instagram-limits.ts supabase/functions/_shared/instagram-publish-utils.ts supabase/functions/__tests__/instagram-limits_test.ts
git commit -m "refactor(instagram): extrai limites de mídia para módulo puro _shared/instagram-limits"
```

---

### Task 2: Classificador `publish-error-codes.ts` + `throwGraphError` enriquecido

**Files:**
- Create: `supabase/functions/_shared/publish-error-codes.ts`
- Modify: `supabase/functions/_shared/instagram-publish-utils.ts:241-245` (`throwGraphError`)
- Test: `supabase/functions/__tests__/publish-error-codes_test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type PublishErrorCode = "TOKEN_EXPIRED" | "MEDIA_TOO_LARGE" | "CAROUSEL_LIMIT" | "NO_MEDIA" | "MEDIA_UNSUPPORTED" | "CONTAINER_EXPIRED" | "RATE_LIMIT" | "IG_TRANSIENT" | "INTERNAL" | "UNKNOWN"`
  - `NON_RETRYABLE_CODES: readonly PublishErrorCode[]`
  - `classifyPublishError(err: unknown): PublishErrorCode`
  - Erros do Graph passam a carregar `graphCode?: number`, `graphSubcode?: number`, `fbtraceId?: string`.

- [ ] **Step 1: Escrever os testes que falham**

`supabase/functions/__tests__/publish-error-codes_test.ts`:

```ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `deno test supabase/functions/__tests__/publish-error-codes_test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar o classificador**

`supabase/functions/_shared/publish-error-codes.ts`:

```ts
// Classificação estável de erros de publicação do Instagram.
// A ORDEM das regras importa: a Meta devolve "reduce the amount of data"
// com graphCode 1, o mesmo código do erro transiente genérico.

export type PublishErrorCode =
  | "TOKEN_EXPIRED"
  | "MEDIA_TOO_LARGE"
  | "CAROUSEL_LIMIT"
  | "NO_MEDIA"
  | "MEDIA_UNSUPPORTED"
  | "CONTAINER_EXPIRED"
  | "RATE_LIMIT"
  | "IG_TRANSIENT"
  | "INTERNAL"
  | "UNKNOWN";

/** Códigos que o auto-retry do cron não resolve: exigem ação do usuário. */
export const NON_RETRYABLE_CODES: readonly PublishErrorCode[] = [
  "TOKEN_EXPIRED",
  "MEDIA_TOO_LARGE",
  "CAROUSEL_LIMIT",
  "NO_MEDIA",
  "MEDIA_UNSUPPORTED",
] as const;

const RATE_LIMIT_GRAPH_CODES = new Set([4, 9, 17, 32, 613]);

interface ClassifiableError {
  message?: string;
  code?: string;
  graphCode?: number;
  graphSubcode?: number;
}

export function classifyPublishError(err: unknown): PublishErrorCode {
  const e = (err ?? {}) as ClassifiableError;
  const msg = (typeof e.message === "string" ? e.message : String(err ?? "")).toLowerCase();
  const graphCode = typeof e.graphCode === "number" ? e.graphCode : undefined;

  if (e.code === "TOKEN_EXPIRED" || graphCode === 190) return "TOKEN_EXPIRED";
  if (msg.includes("reduce the amount of data")) return "MEDIA_TOO_LARGE";
  if (
    msg.includes("carrossel do instagram aceita no máximo") ||
    msg.includes("too little or too many attachments")
  ) return "CAROUSEL_LIMIT";
  if (
    msg.includes("no media files found") ||
    msg.includes("stories require exactly one media file")
  ) return "NO_MEDIA";
  if (
    msg.includes("container failed processing") ||
    msg.includes("falhou no processamento do instagram")
  ) return "MEDIA_UNSUPPORTED";
  if (msg.includes("does not exist, cannot be loaded due to missing permissions")) {
    return "CONTAINER_EXPIRED";
  }
  if (graphCode !== undefined && RATE_LIMIT_GRAPH_CODES.has(graphCode)) return "RATE_LIMIT";
  if (graphCode === 1 || graphCode === 2 || msg.includes("retry your request later")) {
    return "IG_TRANSIENT";
  }
  if (
    msg.includes("ciphertext") ||
    msg.includes("tag length") ||
    msg.includes("mark_platform_published failed") ||
    msg.includes("record_post_status_change") ||
    msg.includes("failed to persist") ||
    msg.includes("failed to mark story post")
  ) return "INTERNAL";
  return "UNKNOWN";
}
```

- [ ] **Step 4: Enriquecer `throwGraphError`**

Em `instagram-publish-utils.ts` (função nas linhas 241-245 antes da Task 1; localizar por nome):

```ts
function throwGraphError(data: any): never {
  const err: any = new Error(data.error.message);
  if (data.error.code === 190) err.code = 'TOKEN_EXPIRED';
  if (typeof data.error.code === "number") err.graphCode = data.error.code;
  if (typeof data.error.error_subcode === "number") err.graphSubcode = data.error.error_subcode;
  if (typeof data.error.fbtrace_id === "string") err.fbtraceId = data.error.fbtrace_id;
  throw err;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `deno test supabase/functions/__tests__/publish-error-codes_test.ts`
Expected: PASS. Depois `npm run test:functions` inteiro + `git checkout -- deno.lock`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/publish-error-codes.ts supabase/functions/_shared/instagram-publish-utils.ts supabase/functions/__tests__/publish-error-codes_test.ts
git commit -m "feat(instagram): classificador de erros de publicação com códigos estáveis"
```

---

### Task 3: Migration da coluna `publish_error_code` + RPCs que a escrevem/limpam

**Files:**
- Create: `supabase/migrations/20260807000001_publish_error_code.sql`

**Interfaces:**
- Consumes: nada.
- Produces: coluna `workflow_posts.publish_error_code text NULL`; `record_post_status_change` aceita `publish_error_code` em `p_fields`; `mark_platform_published` zera `publish_error_code` no sucesso do Instagram.

- [ ] **Step 1: Escrever a migration**

Conteúdo de `supabase/migrations/20260807000001_publish_error_code.sql`:

```sql
-- =====================================================================
-- 20260807000001_publish_error_code.sql
-- Coluna de classificação estável do erro de publicação (Instagram).
-- Sem CHECK constraint de propósito: um código novo emitido pelo
-- classificador não pode quebrar o insert do cron.
-- =====================================================================

ALTER TABLE workflow_posts ADD COLUMN IF NOT EXISTS publish_error_code text;

-- ---------- record_post_status_change: allowlist ganha publish_error_code
-- Corpo copiado da definição mais recente (20260606000001_post_status_events.sql),
-- com UMA adição: o case de publish_error_code. Este arquivo passa a ser a
-- definição canônica; a próxima migration que tocar esta função deve copiar daqui.
create or replace function record_post_status_change(
  p_post_id     bigint,
  p_new_status  text,
  p_source      text   default 'system',
  p_actor       uuid   default null,
  p_approval_id bigint default null,
  p_fields      jsonb  default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_source not in ('workspace_user', 'client', 'system') then
    raise exception 'record_post_status_change: invalid source %', p_source;
  end if;

  perform set_config('app.actor_id',         coalesce(p_actor::text, ''),       true);
  perform set_config('app.event_source',     coalesce(p_source, ''),            true);
  perform set_config('app.post_approval_id', coalesce(p_approval_id::text, ''), true);

  update workflow_posts set
    status = p_new_status,
    instagram_container_id = case when p_fields ? 'instagram_container_id'
      then (p_fields->>'instagram_container_id') else instagram_container_id end,
    instagram_media_id = case when p_fields ? 'instagram_media_id'
      then (p_fields->>'instagram_media_id') else instagram_media_id end,
    instagram_permalink = case when p_fields ? 'instagram_permalink'
      then (p_fields->>'instagram_permalink') else instagram_permalink end,
    published_at = case when p_fields ? 'published_at'
      then (p_fields->>'published_at')::timestamptz else published_at end,
    scheduled_at = case when p_fields ? 'scheduled_at'
      then (p_fields->>'scheduled_at')::timestamptz else scheduled_at end,
    publish_processing_at = case when p_fields ? 'publish_processing_at'
      then (p_fields->>'publish_processing_at')::timestamptz else publish_processing_at end,
    publish_error = case when p_fields ? 'publish_error'
      then (p_fields->>'publish_error') else publish_error end,
    publish_error_code = case when p_fields ? 'publish_error_code'
      then (p_fields->>'publish_error_code') else publish_error_code end,
    publish_retry_count = case when p_fields ? 'publish_retry_count'
      then (p_fields->>'publish_retry_count')::int else publish_retry_count end
  where id = p_post_id;
end;
$$;

revoke all on function record_post_status_change(bigint, text, text, uuid, bigint, jsonb) from public;
grant execute on function record_post_status_change(bigint, text, text, uuid, bigint, jsonb) to service_role;

-- ---------- mark_platform_published: sucesso do IG limpa também o código
-- Corpo copiado da definição mais recente (20260720000005_tiktok_publishing.sql),
-- com UMA adição no branch do Instagram: publish_error_code = NULL.
-- Este arquivo passa a ser a definição canônica.
CREATE OR REPLACE FUNCTION mark_platform_published(
  p_post_id  bigint,
  p_platform text,
  p_source   text  DEFAULT 'system',
  p_actor    uuid  DEFAULT NULL,
  p_fields   jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_platform text;
  v_ig_media text;
  v_tt_status text;
  ig_done boolean;
  tt_done boolean;
BEGIN
  IF p_platform NOT IN ('instagram','tiktok') THEN
    RAISE EXCEPTION 'mark_platform_published: invalid platform %', p_platform;
  END IF;

  SELECT platform, instagram_media_id, tiktok_publish_status
    INTO v_platform, v_ig_media, v_tt_status
  FROM workflow_posts WHERE id = p_post_id FOR UPDATE;

  IF p_platform = 'instagram' THEN
    UPDATE workflow_posts SET
      instagram_media_id    = COALESCE(p_fields->>'instagram_media_id', instagram_media_id),
      instagram_permalink   = COALESCE(p_fields->>'instagram_permalink', instagram_permalink),
      published_at          = COALESCE((p_fields->>'published_at')::timestamptz, published_at),
      publish_processing_at = NULL,
      publish_error         = NULL,
      publish_error_code    = NULL,
      publish_retry_count   = 0
    WHERE id = p_post_id;
    v_ig_media := COALESCE(p_fields->>'instagram_media_id', v_ig_media);
  ELSE
    UPDATE workflow_posts SET
      tiktok_publish_status = 'published',
      tiktok_post_id        = COALESCE(p_fields->>'tiktok_post_id', tiktok_post_id),
      tiktok_post_url       = COALESCE(p_fields->>'tiktok_post_url', tiktok_post_url),
      published_at          = COALESCE(published_at, (p_fields->>'published_at')::timestamptz),
      tiktok_publish_processing_at = NULL,
      tiktok_publish_error  = NULL
    WHERE id = p_post_id;
    v_tt_status := 'published';
  END IF;

  ig_done := (v_platform = 'tiktok')    OR v_ig_media IS NOT NULL;
  tt_done := (v_platform = 'instagram') OR v_tt_status = 'published';

  IF ig_done AND tt_done THEN
    PERFORM record_post_status_change(p_post_id, 'postado', p_source, p_actor, NULL, '{}'::jsonb);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION mark_platform_published(bigint, text, text, uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION mark_platform_published(bigint, text, text, uuid, jsonb) TO service_role;
```

- [ ] **Step 2: Verificar unicidade do prefixo**

Run: `ls supabase/migrations | grep 20260807 && git ls-tree --name-only origin/main:supabase/migrations | grep 20260807`
Expected: só o arquivo novo local; nada em origin/main.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260807000001_publish_error_code.sql
git commit -m "feat(db): coluna publish_error_code + RPCs gravam e limpam o código"
```

---

### Task 4: Escritores do backend gravam/limpam o código

**Files:**
- Modify: `supabase/functions/instagram-publish-cron/index.ts:63-87` (`markFailed`) e call sites nas linhas 316, 331, 346; linhas 154-161 e 258-265 (story fallbacks limpam código)
- Modify: `supabase/functions/instagram-publish/handler.ts:132-167` (cancel/retry limpam código) e 332-355 (catch do publish-now grava código)

**Interfaces:**
- Consumes: `classifyPublishError`, `PublishErrorCode`, `NON_RETRYABLE_CODES` (Task 2); coluna e RPCs (Task 3).
- Produces: toda escrita de `falha_publicacao` carrega `publish_error_code`; toda limpeza de `publish_error` limpa `publish_error_code` junto.

- [ ] **Step 1: Reescrever `markFailed` no cron**

Em `instagram-publish-cron/index.ts`, adicionar o import e trocar a função:

```ts
import { classifyPublishError } from "../_shared/publish-error-codes.ts";
```

```ts
// deno-lint-ignore no-explicit-any
async function markFailed(
  db: any,
  postId: number,
  retryCount: number,
  err: unknown,
  clientId?: number,
) {
  const errorCode = classifyPublishError(err);
  const message = err instanceof Error ? err.message : String(err);
  const fields: Record<string, unknown> = {
    status: "falha_publicacao",
    publish_retry_count: retryCount + 1,
    publish_error: message.slice(0, 500),
    publish_error_code: errorCode,
    publish_processing_at: null,
  };
  // Um container expirado nunca volta a funcionar; sem limpar, o retry
  // automático (processRetry) reusaria o mesmo id e falharia 3x igual.
  if (errorCode === "CONTAINER_EXPIRED") fields.instagram_container_id = null;
  await db.from("workflow_posts").update(fields).eq("id", postId);

  if (errorCode === "TOKEN_EXPIRED" && clientId) {
    await db.from("instagram_accounts").update({ authorization_status: "expired" }).eq("client_id", clientId);
  }
}
```

Nos 3 call sites (fases 1, 2 e 3), trocar
`await markFailed(db, post.post_id, post.publish_retry_count, err.message, post.client_id, err.code);`
por
`await markFailed(db, post.post_id, post.publish_retry_count, err, post.client_id);`

- [ ] **Step 2: Story fallbacks do cron limpam o código**

Nos dois updates de fallback que já setam `publish_error: null` (fase 2 ~linha 154 e fase 3 ~linha 258), adicionar `publish_error_code: null,` na mesma lista de campos.

- [ ] **Step 3: Handler `instagram-publish`: cancel, retry e catch**

Em `instagram-publish/handler.ts`:

1. Import no topo: `import { classifyPublishError } from "../_shared/publish-error-codes.ts";`
2. Action `cancel` (p_fields ~linha 141): adicionar `publish_error_code: null,` junto de `publish_error: null`.
3. Action `retry` (p_fields ~linha 159): adicionar `publish_error_code: null,`.
4. Story fallback do publish-now (p_fields ~linha 229, `publish_error: null`): adicionar `publish_error_code: null,`.
5. Catch do publish-now (~linha 332): trocar o bloco por:

```ts
      } catch (err: any) {
        console.error(`[IG-PUBLISH-NOW] Failed for post ${postId}:`, err.message);
        const errorCode = classifyPublishError(err);
        await svcDb.rpc("record_post_status_change", {
          p_post_id: postId,
          p_new_status: "falha_publicacao",
          p_source: "workspace_user",
          p_actor: actorId,
          p_fields: {
            publish_error: (err.message ?? "Unknown error").slice(0, 500),
            publish_error_code: errorCode,
            publish_processing_at: null,
            ...(errorCode === "CONTAINER_EXPIRED" ? { instagram_container_id: null } : {}),
          },
        });

        if (errorCode === 'TOKEN_EXPIRED') {
          try {
            const { data: wf } = await svcDb.from("workflows").select("cliente_id").eq("id", post.workflow_id).single();
            if (wf?.cliente_id) {
              await svcDb.from("instagram_accounts").update({ authorization_status: "expired" }).eq("client_id", wf.cliente_id);
            }
          } catch (_) { /* best-effort */ }
        }

        return internalServerError(json, "instagram-publish:publish-now", err);
      }
```

- [ ] **Step 4: Grep de contrato**

Run: `grep -rn "publish_error" supabase/functions/ apps/ --include="*.ts" --include="*.tsx" | grep -v tiktok | grep -v __tests__ | grep -v publish_error_code`
Expected: todo local que escreve ou limpa `publish_error` também trata `publish_error_code` (exceto selects de leitura, que a Task 7 cobre). Corrigir qualquer ponto que escapou.

- [ ] **Step 5: Rodar a suíte Deno**

Run: `npm run test:functions` e depois `git checkout -- deno.lock`
Expected: PASS (os gate-tests exercitam schedule/cancel/retry via mock e não afirmam sobre os campos novos).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/instagram-publish-cron/index.ts supabase/functions/instagram-publish/handler.ts
git commit -m "feat(instagram): grava publish_error_code em toda falha e limpa junto com publish_error"
```

---

### Task 5: Migration do claim: retry pula códigos não-retryable

**Files:**
- Create: `supabase/migrations/20260807000002_claim_skip_nonretryable.sql`

**Interfaces:**
- Consumes: coluna `publish_error_code` (Task 3).
- Produces: fase `retry` de `claim_posts_for_publishing` ignora posts com código em (`TOKEN_EXPIRED`,`MEDIA_TOO_LARGE`,`CAROUSEL_LIMIT`,`NO_MEDIA`,`MEDIA_UNSUPPORTED`).

- [ ] **Step 1: Escrever a migration**

Copiar o corpo COMPLETO de `claim_posts_for_publishing` de `supabase/migrations/20260720000005_tiktok_publishing.sql:181-276` (a definição mais recente) para o arquivo novo, com exatamente UMA edição na fase `retry`. Cabeçalho e edição:

```sql
-- =====================================================================
-- 20260807000002_claim_skip_nonretryable.sql
-- Fase 'retry' do claim IG passa a pular códigos não-retryable: um token
-- expirado ou mídia inválida nunca se resolve sozinho, e as 3 tentativas
-- idênticas só queimavam chamadas ao Graph.
-- Corpo copiado de 20260720000005_tiktok_publishing.sql com UMA edição
-- (WHEN 'retry'). Este arquivo passa a ser a definição canônica.
-- =====================================================================
DROP FUNCTION IF EXISTS claim_posts_for_publishing(text, integer);
CREATE OR REPLACE FUNCTION claim_posts_for_publishing(
  ... corpo idêntico ao de 20260720000005 ...
        WHEN 'retry' THEN
          wp.status = 'falha_publicacao'
          AND wp.publish_retry_count < 3
          AND wp.instagram_media_id IS NULL
          AND (wp.publish_error_code IS NULL
               OR wp.publish_error_code NOT IN
                 ('TOKEN_EXPIRED','MEDIA_TOO_LARGE','CAROUSEL_LIMIT','NO_MEDIA','MEDIA_UNSUPPORTED'))
  ... resto idêntico, incluindo REVOKE/GRANT finais ...
$$;
REVOKE ALL ON FUNCTION claim_posts_for_publishing(text, int) FROM public;
GRANT EXECUTE ON FUNCTION claim_posts_for_publishing(text, int) TO service_role;
```

(O implementador cola o corpo inteiro do arquivo-fonte; a única linha nova é o `AND (wp.publish_error_code IS NULL OR ... NOT IN (...))`. A lista de códigos deve bater com `NON_RETRYABLE_CODES` da Task 2.)

- [ ] **Step 2: Conferir a cópia**

Run: `diff <(sed -n '/DROP FUNCTION IF EXISTS claim_posts_for_publishing/,/GRANT EXECUTE ON FUNCTION claim_posts_for_publishing/p' supabase/migrations/20260720000005_tiktok_publishing.sql) <(sed -n '/DROP FUNCTION IF EXISTS claim_posts_for_publishing/,/GRANT EXECUTE ON FUNCTION claim_posts_for_publishing/p' supabase/migrations/20260807000002_claim_skip_nonretryable.sql)`
Expected: diff mostra APENAS a linha nova do `publish_error_code` (e comentários).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260807000002_claim_skip_nonretryable.sql
git commit -m "feat(db): retry do cron de publicação pula erros não-retryable"
```

---

### Task 6: Migration da notificação `post_publish_failed`

**Files:**
- Create: `supabase/migrations/20260807000003_post_publish_failed_notification.sql`

**Interfaces:**
- Consumes: coluna `publish_error_code` (Task 3); helpers `resolve_notification_targets` e `insert_notification_batch` (existentes, 20260430000001).
- Produces: tipo `post_publish_failed` no CHECK; trigger `notify_post_publish_failed` em `workflow_posts`.

- [ ] **Step 1: Escrever a migration**

```sql
-- =====================================================================
-- 20260807000003_post_publish_failed_notification.sql
-- Notificação in-app quando a falha de publicação exige ação humana.
-- =====================================================================

-- ---------- notifications: add 'post_publish_failed' ao type CHECK ----
-- Lista copiada da definição MAIS RECENTE (20260805000002_post_status_automations.sql).
-- Este arquivo passa a ser a definição mais recente; a próxima migration a
-- tocar notifications_type_check deve copiar daqui.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'post_approved', 'post_correction', 'post_message',
    'idea_submitted', 'briefing_answered',
    'step_activated', 'step_completed', 'post_assigned',
    'workflow_completed', 'deadline_approaching',
    'invite_accepted', 'member_role_changed', 'member_removed',
    'post_edit_suggestion', 'task_assigned', 'client_message',
    'mention', 'post_status_automation',
    'post_publish_failed'
  )
);

-- ---------- Trigger -----------------------------------------------------
-- Observa status E publish_retry_count: nas falhas repetidas do auto-retry o
-- status permanece 'falha_publicacao' (só o contador sobe), então um trigger
-- apenas de transição de status jamais dispararia no esgotamento dos retries.
-- Anti-spam:
--   (a) transição para falha com código não-retryable -> notifica já (o cron
--       não vai resolver; a fase retry pula esses códigos, então a transição
--       ocorre uma única vez por ciclo);
--   (b) contador cruzando 3 -> auto-retries esgotados (cruza uma única vez;
--       o "Tentar novamente" manual zera o contador e permite novo ciclo).
-- Padrão trg_notify_*: SECURITY DEFINER + EXCEPTION WHEN OTHERS para nunca
-- reverter a operação de negócio.
CREATE OR REPLACE FUNCTION trg_notify_post_publish_failed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name text;
  v_targets     uuid[];
  v_notify      boolean := false;
BEGIN
  BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status
       AND NEW.publish_error_code IN
         ('TOKEN_EXPIRED','MEDIA_TOO_LARGE','CAROUSEL_LIMIT','NO_MEDIA','MEDIA_UNSUPPORTED') THEN
      v_notify := true;
    ELSIF COALESCE(OLD.publish_retry_count, 0) < 3
       AND COALESCE(NEW.publish_retry_count, 0) >= 3 THEN
      v_notify := true;
    END IF;

    IF v_notify THEN
      SELECT c.nome INTO v_client_name
        FROM workflows w
        JOIN clientes c ON c.id = w.cliente_id
       WHERE w.id = NEW.workflow_id;

      v_targets := resolve_notification_targets(NEW.conta_id, NEW.responsavel_id, ARRAY['owner','admin']);

      PERFORM insert_notification_batch(
        NEW.conta_id,
        v_targets,
        'post_publish_failed',
        '/entregas?drawer=' || NEW.workflow_id,
        jsonb_build_object(
          'post_id',            NEW.id,
          'workflow_id',        NEW.workflow_id,
          'post_title',         NEW.titulo,
          'client_name',        v_client_name,
          'publish_error_code', NEW.publish_error_code
        ),
        NULL
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_post_publish_failed failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_post_publish_failed ON workflow_posts;
CREATE TRIGGER notify_post_publish_failed
  AFTER UPDATE OF status, publish_retry_count ON workflow_posts
  FOR EACH ROW
  WHEN (NEW.status = 'falha_publicacao')
  EXECUTE FUNCTION trg_notify_post_publish_failed();
```

- [ ] **Step 2: Conferir a lista de tipos contra a definição mais recente**

Run: `grep -A 12 "notifications_type_check CHECK" supabase/migrations/20260805000002_post_status_automations.sql`
Expected: os 18 tipos existentes batem 1:1 com a lista nova (que adiciona só `post_publish_failed`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260807000003_post_publish_failed_notification.sql
git commit -m "feat(db): notificação in-app post_publish_failed com anti-spam de retries"
```

---

### Task 7: Front: tipos, selects e renderer de notificação

**Files:**
- Modify: `apps/crm/src/store/posts.ts:36` (interface `WorkflowPost`), `:164` (`ScheduledPost`), `:185-186` (`POST_CONTEXT_COLUMNS`), `:203` (`mapPostContextRow`) e o select do drawer (~linha 436; localizar por `post_file_links`)
- Modify: `apps/crm/src/store/notifications.ts:3-21` (`NotificationType`)
- Modify: `apps/crm/src/lib/notification-config.ts` (novo case no switch)

**Interfaces:**
- Consumes: coluna `publish_error_code` (Task 3); tipo de notificação (Task 6).
- Produces: `WorkflowPost.publish_error_code?: string | null` e `ScheduledPost.publish_error_code: string | null` disponíveis em todo o front; notificação renderizada.

- [ ] **Step 1: Tipos e selects em `store/posts.ts`**

1. Em `WorkflowPost` (após `publish_error`, linha 36): `publish_error_code?: string | null;`
2. Em `ScheduledPost` (após `publish_error`, linha 164): `publish_error_code: string | null;`
3. Em `POST_CONTEXT_COLUMNS` (linha 185): adicionar `publish_error_code` logo após `publish_error`.
4. Em `mapPostContextRow` (linha ~203): `publish_error_code: row.publish_error_code ?? null,`
5. Localizar TODOS os outros selects de `workflow_posts` no arquivo que incluem `publish_error` (`grep -n "publish_error" apps/crm/src/store/posts.ts`) e adicionar `publish_error_code` neles (inclui o select usado pelo drawer, ~linha 436).

- [ ] **Step 2: Tipo e renderer da notificação**

1. `apps/crm/src/store/notifications.ts`: adicionar `| 'post_publish_failed'` à union `NotificationType`.
2. `apps/crm/src/lib/notification-config.ts`: adicionar case no switch (antes do `default:`), seguindo o shape do case `task_assigned` existente:

```ts
    case 'post_publish_failed':
      return {
        icon: AlertCircle,
        tone: 'danger',
        title: 'Falha na publicação',
        body: m.client_name
          ? `${s(m.client_name, 'Cliente')} · ${s(m.post_title, 'Post')}`
          : s(m.post_title, 'Post'),
      };
```

Adicionar `AlertCircle` ao import de `lucide-react` se ainda não estiver lá. Conferir o helper de string usado no arquivo (`s(...)`) e o nome exato da variável de metadata (`m`) contra os cases vizinhos.

- [ ] **Step 3: Typecheck e testes existentes**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit && npm run test -- notification`
Expected: typecheck limpo; se houver teste de `notification-config` cobrindo exaustividade de tipos, atualizar com o tipo novo.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/store/posts.ts apps/crm/src/store/notifications.ts apps/crm/src/lib/notification-config.ts
git commit -m "feat(crm): publish_error_code no tipo Post e notificação post_publish_failed"
```

---

### Task 8: Mapa de copy `publishErrorCopy.ts`

**Files:**
- Create: `apps/crm/src/pages/entregas/publishErrorCopy.ts`
- Test: `apps/crm/src/pages/entregas/__tests__/publishErrorCopy.test.ts`

**Interfaces:**
- Consumes: nada (módulo puro).
- Produces:
  - `type PublishErrorCode` (união dos 10 códigos, igual à do backend)
  - `type PublishErrorAction = 'reconnect' | 'retry' | 'media' | 'support'`
  - `interface PublishErrorDisplay { titulo: string; explicacao: string; acao: PublishErrorAction; mostrarDetalhes: boolean }`
  - `getPublishErrorDisplay(code: string | null | undefined): PublishErrorDisplay` (fallback `UNKNOWN`)

- [ ] **Step 1: Escrever o teste que falha**

`apps/crm/src/pages/entregas/__tests__/publishErrorCopy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  PUBLISH_ERROR_COPY,
  getPublishErrorDisplay,
  type PublishErrorCode,
} from '../publishErrorCopy';

const ALL_CODES: PublishErrorCode[] = [
  'TOKEN_EXPIRED', 'MEDIA_TOO_LARGE', 'CAROUSEL_LIMIT', 'NO_MEDIA',
  'MEDIA_UNSUPPORTED', 'CONTAINER_EXPIRED', 'RATE_LIMIT', 'IG_TRANSIENT',
  'INTERNAL', 'UNKNOWN',
];

describe('publishErrorCopy', () => {
  it('todo código tem copy completa', () => {
    for (const code of ALL_CODES) {
      const d = PUBLISH_ERROR_COPY[code];
      expect(d.titulo.length, code).toBeGreaterThan(0);
      expect(d.explicacao.length, code).toBeGreaterThan(0);
      expect(['reconnect', 'retry', 'media', 'support']).toContain(d.acao);
    }
  });

  it('nenhuma copy contém em-dash', () => {
    for (const code of ALL_CODES) {
      const d = PUBLISH_ERROR_COPY[code];
      expect(d.titulo, code).not.toMatch(/—/);
      expect(d.explicacao, code).not.toMatch(/—/);
    }
  });

  it('INTERNAL não expõe detalhes técnicos', () => {
    expect(PUBLISH_ERROR_COPY.INTERNAL.mostrarDetalhes).toBe(false);
    expect(PUBLISH_ERROR_COPY.INTERNAL.acao).toBe('support');
  });

  it('código nulo ou desconhecido cai em UNKNOWN', () => {
    expect(getPublishErrorDisplay(null)).toEqual(PUBLISH_ERROR_COPY.UNKNOWN);
    expect(getPublishErrorDisplay(undefined)).toEqual(PUBLISH_ERROR_COPY.UNKNOWN);
    expect(getPublishErrorDisplay('CODIGO_FUTURO')).toEqual(PUBLISH_ERROR_COPY.UNKNOWN);
  });

  it('TOKEN_EXPIRED direciona para reconexão', () => {
    expect(PUBLISH_ERROR_COPY.TOKEN_EXPIRED.acao).toBe('reconnect');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- publishErrorCopy`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

`apps/crm/src/pages/entregas/publishErrorCopy.ts`:

```ts
// Copy acionável em PT para cada código de falha de publicação.
// Espelha o enum de supabase/functions/_shared/publish-error-codes.ts.
// Regra da casa: sem em-dash em copy de UI.

export type PublishErrorCode =
  | 'TOKEN_EXPIRED'
  | 'MEDIA_TOO_LARGE'
  | 'CAROUSEL_LIMIT'
  | 'NO_MEDIA'
  | 'MEDIA_UNSUPPORTED'
  | 'CONTAINER_EXPIRED'
  | 'RATE_LIMIT'
  | 'IG_TRANSIENT'
  | 'INTERNAL'
  | 'UNKNOWN';

export type PublishErrorAction = 'reconnect' | 'retry' | 'media' | 'support';

export interface PublishErrorDisplay {
  titulo: string;
  explicacao: string;
  acao: PublishErrorAction;
  /** false esconde o publish_error cru (ex.: INTERNAL expõe detalhe nosso). */
  mostrarDetalhes: boolean;
}

export const PUBLISH_ERROR_COPY: Record<PublishErrorCode, PublishErrorDisplay> = {
  TOKEN_EXPIRED: {
    titulo: 'Conexão com o Instagram expirou',
    explicacao:
      'A autorização da conta do Instagram expirou ou foi revogada. Reconecte a conta na página do cliente e reagende o post.',
    acao: 'reconnect',
    mostrarDetalhes: false,
  },
  MEDIA_TOO_LARGE: {
    titulo: 'Mídia muito pesada para o Instagram',
    explicacao:
      'O Instagram recusou o arquivo por tamanho. Imagens: até 8 MB. Vídeos: até 250 MB. Ajuste a mídia na galeria e tente novamente.',
    acao: 'media',
    mostrarDetalhes: true,
  },
  CAROUSEL_LIMIT: {
    titulo: 'Carrossel acima do limite do Instagram',
    explicacao:
      'A publicação via API aceita no máximo 10 itens por carrossel. Remova itens na galeria e tente novamente.',
    acao: 'media',
    mostrarDetalhes: true,
  },
  NO_MEDIA: {
    titulo: 'Post sem mídia anexada',
    explicacao:
      'O post foi agendado sem nenhuma imagem ou vídeo. Anexe a mídia na galeria e reagende.',
    acao: 'media',
    mostrarDetalhes: false,
  },
  MEDIA_UNSUPPORTED: {
    titulo: 'Instagram não conseguiu processar a mídia',
    explicacao:
      'O arquivo tem formato, proporção ou duração que o Instagram não aceita. Confira a mídia na galeria e tente novamente.',
    acao: 'media',
    mostrarDetalhes: true,
  },
  CONTAINER_EXPIRED: {
    titulo: 'Publicação preparada expirou no Instagram',
    explicacao:
      'O Instagram descarta publicações preparadas que não são concluídas em 24 horas. Tente novamente para recomeçar do zero.',
    acao: 'retry',
    mostrarDetalhes: true,
  },
  RATE_LIMIT: {
    titulo: 'Limite de publicações do Instagram atingido',
    explicacao:
      'O Instagram limita a quantidade de publicações via API em 24 horas por conta. Aguarde um pouco e tente novamente.',
    acao: 'retry',
    mostrarDetalhes: true,
  },
  IG_TRANSIENT: {
    titulo: 'Instabilidade temporária do Instagram',
    explicacao:
      'O Instagram retornou um erro temporário. Normalmente funciona ao tentar novamente.',
    acao: 'retry',
    mostrarDetalhes: true,
  },
  INTERNAL: {
    titulo: 'Erro interno ao publicar',
    explicacao:
      'Algo falhou do nosso lado, não é um problema do post nem da conta. Tente novamente e, se persistir, fale com o suporte informando o post.',
    acao: 'support',
    mostrarDetalhes: false,
  },
  UNKNOWN: {
    titulo: 'Falha na publicação',
    explicacao:
      'O Instagram retornou um erro não reconhecido. Tente novamente e, se persistir, fale com o suporte.',
    acao: 'retry',
    mostrarDetalhes: true,
  },
};

export function getPublishErrorDisplay(code: string | null | undefined): PublishErrorDisplay {
  if (code && code in PUBLISH_ERROR_COPY) {
    return PUBLISH_ERROR_COPY[code as PublishErrorCode];
  }
  return PUBLISH_ERROR_COPY.UNKNOWN;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -- publishErrorCopy`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/publishErrorCopy.ts apps/crm/src/pages/entregas/__tests__/publishErrorCopy.test.ts
git commit -m "feat(crm): mapa de copy acionável por código de falha de publicação"
```

---

### Task 9: Espelho `instagramLimits.ts` no front + teste de paridade

**Files:**
- Create: `apps/crm/src/pages/entregas/instagramLimits.ts`
- Test: `apps/crm/src/pages/entregas/__tests__/instagramLimits.test.ts`

**Interfaces:**
- Consumes: shape `PostMedia` de `store/posts.ts` (campos `id`, `kind`, `mime_type`, `size_bytes`, `width`, `height`, `duration_seconds`).
- Produces: `validatePostMedia(media: PostMediaLike[], opts?: { forStories?: boolean }): string[]` (mensagens em PT prontas) para a Task 10.

- [ ] **Step 1: Criar o espelho**

`apps/crm/src/pages/entregas/instagramLimits.ts`: copiar as constantes e o corpo de `validateMedia` de `supabase/functions/_shared/instagram-limits.ts` (mesmos nomes, mesmos valores, mesmas mensagens), com um adaptador de tipo:

```ts
// Espelho de supabase/functions/_shared/instagram-limits.ts para o preflight
// do front. O teste de paridade em __tests__/instagramLimits.test.ts importa
// os dois arquivos e falha se divergirem. Alterou lá? Altere aqui.

export interface PostMediaLike {
  id: number;
  kind: 'image' | 'video';
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
}

// ... constantes idênticas às do _shared (exportadas com os mesmos nomes) ...
// ... validateMedia idêntico, tipado sobre PostMediaLike ...

/** Preflight do front: retorna as mensagens em PT prontas para exibir. */
export function validatePostMedia(
  media: PostMediaLike[],
  opts?: { forStories?: boolean },
): string[] {
  return validateMedia(media, opts).map((e) => e.message);
}
```

- [ ] **Step 2: Teste de paridade**

`apps/crm/src/pages/entregas/__tests__/instagramLimits.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as front from '../instagramLimits';
// Import relativo cruzando o monorepo: o módulo _shared é TS puro (sem APIs
// Deno), então o Vitest o transforma normalmente.
import * as shared from '../../../../../../supabase/functions/_shared/instagram-limits';

describe('instagramLimits: paridade front vs _shared', () => {
  it('constantes idênticas', () => {
    expect(front.IMAGE_MAX_BYTES).toBe(shared.IMAGE_MAX_BYTES);
    expect(front.VIDEO_MAX_BYTES).toBe(shared.VIDEO_MAX_BYTES);
    expect(front.IMAGE_MIN_DIM).toBe(shared.IMAGE_MIN_DIM);
    expect(front.IMAGE_AR_MIN).toBe(shared.IMAGE_AR_MIN);
    expect(front.STORY_IMAGE_AR_MIN).toBe(shared.STORY_IMAGE_AR_MIN);
    expect(front.IMAGE_AR_MAX).toBe(shared.IMAGE_AR_MAX);
    expect(front.VIDEO_AR_MIN).toBe(shared.VIDEO_AR_MIN);
    expect(front.VIDEO_AR_MAX).toBe(shared.VIDEO_AR_MAX);
    expect(front.VIDEO_MIN_DURATION).toBe(shared.VIDEO_MIN_DURATION);
    expect(front.VIDEO_MAX_DURATION).toBe(shared.VIDEO_MAX_DURATION);
    expect(front.STORY_VIDEO_MAX_DURATION).toBe(shared.STORY_VIDEO_MAX_DURATION);
    expect(front.CAROUSEL_MAX_ITEMS).toBe(shared.CAROUSEL_MAX_ITEMS);
    expect([...front.ALLOWED_IMAGE_MIMES].sort()).toEqual([...shared.ALLOWED_IMAGE_MIMES].sort());
    expect([...front.ALLOWED_VIDEO_MIMES].sort()).toEqual([...shared.ALLOWED_VIDEO_MIMES].sort());
  });

  it('mesmo veredito para os mesmos arquivos', () => {
    const fixtures = [
      { id: 1, kind: 'image' as const, mime_type: 'image/jpeg', size_bytes: 9 * 1024 * 1024, width: 1080, height: 1350, duration_seconds: null },
      { id: 2, kind: 'video' as const, mime_type: 'video/mp4', size_bytes: 260 * 1024 * 1024, width: 1080, height: 1920, duration_seconds: 30 },
      { id: 3, kind: 'video' as const, mime_type: 'video/mp4', size_bytes: 1024, width: 1080, height: 1920, duration_seconds: 95 },
      { id: 4, kind: 'image' as const, mime_type: 'image/gif', size_bytes: 1024, width: 500, height: 500, duration_seconds: null },
      { id: 5, kind: 'image' as const, mime_type: 'image/jpeg', size_bytes: 1024, width: 1080, height: 1350, duration_seconds: null },
    ];
    const sharedFixtures = fixtures.map((f) => ({ ...f, r2_key: 'k', sort_order: 0 }));
    for (const forStories of [false, true]) {
      expect(front.validateMedia(fixtures, { forStories }).map((e) => e.message)).toEqual(
        shared.validateMedia(sharedFixtures, { forStories }).map((e) => e.message),
      );
    }
  });
});
```

- [ ] **Step 3: Rodar e ver passar**

Run: `npm run test -- instagramLimits`
Expected: PASS. Se o import cruzado falhar por resolução do Vitest, ajustar o alias no `vitest.config` (não mover o arquivo `_shared`).

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/pages/entregas/instagramLimits.ts apps/crm/src/pages/entregas/__tests__/instagramLimits.test.ts
git commit -m "feat(crm): espelho dos limites de mídia do Instagram com teste de paridade"
```

---

### Task 10: `ScheduleButton`: preflight + erro classificado no popover

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/ScheduleButton.tsx` (props L147, bloco `aprovado_cliente` L500-513, bloco `falha_publicacao` L465-498)
- Test: `apps/crm/src/pages/entregas/components/__tests__/ScheduleButton.test.tsx`

**Interfaces:**
- Consumes: `validatePostMedia` (Task 9), `getPublishErrorDisplay` (Task 8), `PostMedia` (store).
- Produces: prop nova opcional `media?: PostMedia[]` (a Task 11 passa a fornecê-la no drawer).

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao `ScheduleButton.test.tsx` (usando `makePost`/`defaultProps` existentes):

```tsx
function makeMedia(overrides?: Partial<PostMedia>): PostMedia {
  return {
    id: 1, post_id: 1, conta_id: 'w', r2_key: 'k', thumbnail_r2_key: null,
    kind: 'image', mime_type: 'image/jpeg', size_bytes: 1024,
    original_filename: 'a.jpg', width: 1080, height: 1350,
    duration_seconds: null, is_cover: false, sort_order: 0,
    uploaded_by: null, created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as PostMedia;
}

describe('preflight de mídia', () => {
  it('bloqueia agendar quando uma imagem excede 8 MB', () => {
    render(
      <ScheduleButton
        post={makePost()}
        media={[makeMedia({ size_bytes: 9 * 1024 * 1024 })]}
        {...defaultProps}
      />,
    );
    const agendar = screen.getByRole('button', { name: /agendar/i });
    expect(agendar).toHaveProperty('disabled', true);
    expect(screen.getByText(/Imagem excede 8 MB/)).toBeTruthy();
  });

  it('não bloqueia quando a mídia é válida', () => {
    render(<ScheduleButton post={makePost()} media={[makeMedia()]} {...defaultProps} />);
    expect(screen.getByRole('button', { name: /agendar/i })).toHaveProperty('disabled', false);
  });

  it('sem a prop media, não bloqueia no cliente (gate fica no servidor)', () => {
    render(<ScheduleButton post={makePost()} {...defaultProps} />);
    expect(screen.getByRole('button', { name: /agendar/i })).toHaveProperty('disabled', false);
  });
});

describe('erro classificado', () => {
  it('mostra copy de token expirado', () => {
    render(
      <ScheduleButton
        post={makePost({
          status: 'falha_publicacao',
          publish_error: 'Error validating access token',
          publish_error_code: 'TOKEN_EXPIRED',
        })}
        {...defaultProps}
      />,
    );
    expect(screen.getByText('Conexão com o Instagram expirou')).toBeTruthy();
    // TOKEN_EXPIRED não expõe o texto cru
    expect(screen.queryByText('Error validating access token')).toBeNull();
  });

  it('código nulo cai em UNKNOWN e mantém o texto cru visível', () => {
    render(
      <ScheduleButton
        post={makePost({ status: 'falha_publicacao', publish_error: 'Token expirado' })}
        {...defaultProps}
      />,
    );
    expect(screen.getByText('Falha na publicação')).toBeTruthy();
    expect(screen.getByText('Token expirado')).toBeTruthy();
  });
});
```

Nota: o teste existente `'shows publish error message when present'` (L317) continua válido (código nulo → UNKNOWN → texto cru visível). Se o título "Falha na publicação" colidir com outro texto no DOM, usar `getAllByText`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- ScheduleButton`
Expected: FAIL (prop `media` e copy não existem).

- [ ] **Step 3: Implementar**

1. Props (L147): adicionar `media?: PostMedia[];` a `ScheduleButtonProps` (import de tipo do store).
2. Bloco `aprovado_cliente` (L500-513):

```tsx
const mediaViolations =
  targetsInstagram && media ? validatePostMedia(media, { forStories: isStoryPost }) : [];
const canSchedule = !!post.scheduled_at && hasRequiredCaption && !accountWarning && tiktokReady && mediaViolations.length === 0;
const canPublishNow = hasRequiredCaption && !accountWarning && tiktokReady && mediaViolations.length === 0;
```

Renderizar as violações junto à lista "Falta: ..." existente (mesmo padrão visual):

```tsx
{mediaViolations.length > 0 && (
  <ul className="text-xs mt-1" style={{ color: 'var(--danger-text)' }}>
    {mediaViolations.map((v) => (
      <li key={v} className="flex items-center gap-1">
        <AlertCircle className="h-3 w-3" /> {v}
      </li>
    ))}
  </ul>
)}
```

3. Bloco `falha_publicacao` (L485-489): substituir o parágrafo do erro cru por:

```tsx
{targetsInstagram && (post.publish_error || post.publish_error_code) && (() => {
  const d = getPublishErrorDisplay(post.publish_error_code);
  return (
    <div className="text-xs mt-1" style={{ color: 'var(--danger-text)' }}>
      <p className="flex items-center gap-1 font-semibold">
        <AlertCircle className="h-3 w-3" /> {d.titulo}
      </p>
      <p className="mt-0.5">{d.explicacao}</p>
      {d.mostrarDetalhes && post.publish_error && (
        <p className="mt-0.5 opacity-75">{post.publish_error}</p>
      )}
    </div>
  );
})()}
```

(O bloco TikTok em L490-494 fica como está.)

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -- ScheduleButton`
Expected: PASS, incluindo os testes pré-existentes do arquivo.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components/ScheduleButton.tsx apps/crm/src/pages/entregas/components/__tests__/ScheduleButton.test.tsx
git commit -m "feat(crm): preflight de mídia e erro classificado no ScheduleButton"
```

---

### Task 11: `PublishErrorBlock` no WorkflowDrawer + mídia para o ScheduleButton

**Files:**
- Create: `apps/crm/src/pages/entregas/components/PublishErrorBlock.tsx`
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` (dentro de `SortablePostItem`: bloco após `drawer-post-meta-row` ~L1280; call site do `ScheduleButton` L1429-1436)
- Test: `apps/crm/src/pages/entregas/components/__tests__/PublishErrorBlock.test.tsx`

**Interfaces:**
- Consumes: `getPublishErrorDisplay` (Task 8), `retryInstagramPublish` de `services/instagram` (existente), `listPostMedia` (existente), `useQuery`.
- Produces: componente `PublishErrorBlock({ post, clienteId, onStatusChange })`.

- [ ] **Step 1: Escrever os testes que falham**

`PublishErrorBlock.test.tsx` (mockar `services/instagram` como no ScheduleButton.test; envolver em `MemoryRouter` por causa do `<Link>`; copiar a factory `makePost` de `ScheduleButton.test.tsx:44-58` para este arquivo):

```tsx
it('TOKEN_EXPIRED: mostra copy e link de reconexão para /clientes/:id', () => {
  render(
    <MemoryRouter>
      <PublishErrorBlock
        post={makePost({ status: 'falha_publicacao', publish_error_code: 'TOKEN_EXPIRED', publish_error: 'raw' })}
        clienteId={42}
      />
    </MemoryRouter>,
  );
  expect(screen.getByText('Conexão com o Instagram expirou')).toBeTruthy();
  const link = screen.getByRole('link', { name: /reconectar instagram/i });
  expect(link.getAttribute('href')).toBe('/clientes/42');
  expect(screen.queryByText('raw')).toBeNull(); // mostrarDetalhes: false
});

it('IG_TRANSIENT: mostra botão tentar novamente e detalhes técnicos', () => {
  render(
    <MemoryRouter>
      <PublishErrorBlock
        post={makePost({ status: 'falha_publicacao', publish_error_code: 'IG_TRANSIENT', publish_error: 'An unexpected error has occurred' })}
        clienteId={42}
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeTruthy();
  fireEvent.click(screen.getByText(/detalhes técnicos/i));
  expect(screen.getByText('An unexpected error has occurred')).toBeTruthy();
});

it('INTERNAL: sem botão e sem detalhes técnicos', () => {
  render(
    <MemoryRouter>
      <PublishErrorBlock
        post={makePost({ status: 'falha_publicacao', publish_error_code: 'INTERNAL', publish_error: 'Tag length overflows ciphertext' })}
        clienteId={42}
      />
    </MemoryRouter>,
  );
  expect(screen.queryByRole('button', { name: /tentar novamente/i })).toBeNull();
  expect(screen.queryByText(/detalhes técnicos/i)).toBeNull();
  expect(screen.queryByText('Tag length overflows ciphertext')).toBeNull();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- PublishErrorBlock`
Expected: FAIL.

- [ ] **Step 3: Implementar o componente**

`PublishErrorBlock.tsx`:

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { retryInstagramPublish } from '../../../services/instagram';
import { getPublishErrorDisplay } from '../publishErrorCopy';
import type { WorkflowPost } from '../../../store/posts';

interface PublishErrorBlockProps {
  post: WorkflowPost;
  clienteId?: number;
  onStatusChange?: () => void;
}

export function PublishErrorBlock({ post, clienteId, onStatusChange }: PublishErrorBlockProps) {
  const [loading, setLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const d = getPublishErrorDisplay(post.publish_error_code);

  async function handleRetry() {
    if (!post.id) return;
    setLoading(true);
    try {
      await retryInstagramPublish(post.id);
      toast.success('Post reagendado. A publicação será tentada novamente.');
      onStatusChange?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao tentar novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="rounded-md border p-3 mb-3 text-sm"
      style={{ borderColor: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 8%, transparent)' }}
    >
      <p className="flex items-center gap-1.5 font-semibold" style={{ color: 'var(--danger-text)' }}>
        <AlertCircle className="h-4 w-4" /> {d.titulo}
      </p>
      <p className="mt-1" style={{ color: 'var(--danger-text)' }}>{d.explicacao}</p>

      {d.acao === 'reconnect' && clienteId != null && (
        <Button asChild size="sm" className="mt-2 text-xs font-semibold">
          <Link to={`/clientes/${clienteId}`}>Reconectar Instagram</Link>
        </Button>
      )}
      {d.acao === 'retry' && (
        <Button
          size="sm"
          className="mt-2 text-xs font-semibold"
          disabled={loading}
          onClick={handleRetry}
          style={{ background: '#f55a42', color: 'white' }}
        >
          <RefreshCw className="h-3 w-3 mr-1" /> Tentar novamente
        </Button>
      )}

      {d.mostrarDetalhes && post.publish_error && (
        <div className="mt-2">
          <button
            type="button"
            className="flex items-center gap-1 text-xs opacity-75"
            style={{ color: 'var(--danger-text)' }}
            onClick={() => setShowDetails((v) => !v)}
          >
            {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Detalhes técnicos
          </button>
          {showDetails && (
            <p className="mt-1 text-xs font-mono opacity-75" style={{ color: 'var(--danger-text)' }}>
              {post.publish_error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Integrar no `WorkflowDrawer`**

Em `SortablePostItem` (WorkflowDrawer.tsx):

1. Query de mídia compartilhando o cache da galeria (dentro de `SortablePostItem`, com `enabled: isExpanded`):

```tsx
const { data: postMedia } = useQuery({
  queryKey: ['post-media', post.id],
  queryFn: () => listPostMedia(post.id!),
  staleTime: 5 * 60 * 1000,
  enabled: isExpanded && !!post.id,
});
```

(Import de `listPostMedia` de `../../../services/postMedia`; `useQuery` já é usado no arquivo.)

2. Logo após o fechamento de `drawer-post-meta-row` (~L1280, junto ao `drawer-external-warning`), renderizar o bloco quando o post falhou no Instagram:

```tsx
{post.status === 'falha_publicacao' && post.platform !== 'tiktok' && (
  <PublishErrorBlock post={post} clienteId={clienteId} onStatusChange={onStatusChange} />
)}
```

Onde `clienteId` é a variável que o drawer já usa para a query de `igAccount` (localizar o nome exato na L253-263; se estiver fora do escopo de `SortablePostItem`, passar por prop a partir do componente pai, que a possui). `onStatusChange` é o mesmo callback já passado ao `ScheduleButton` no call site L1429-1436 (conferir o nome da prop lá).

3. No call site do `ScheduleButton` (L1429-1436), adicionar `media={postMedia}`.

- [ ] **Step 5: Rodar testes e typecheck**

Run: `npm run test -- PublishErrorBlock && npm run test -- WorkflowDrawer && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS / limpo (se existirem testes de WorkflowDrawer que renderizam `SortablePostItem`, podem precisar de `QueryClientProvider`; seguir o wrapper que esses testes já usam).

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/entregas/components/PublishErrorBlock.tsx apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx apps/crm/src/pages/entregas/components/__tests__/PublishErrorBlock.test.tsx
git commit -m "feat(crm): bloco de causa acionável no drawer para falha de publicação"
```

---

### Task 12: Verificação completa

**Files:** nenhum novo (correções pontuais se algo falhar).

- [ ] **Step 1: Greps de contrato**

```bash
grep -rn "publish_error" apps/crm/src apps/hub/src supabase/functions --include="*.ts" --include="*.tsx" | grep -v tiktok_publish_error | grep -v publish_error_code
```

Conferir: nenhum escritor/limpador de `publish_error` ficou sem o par `publish_error_code`; selects de leitura do CRM incluem a coluna nova. (O select do `hub-posts` fica intencionalmente sem a coluna: Hub fora de escopo.)

- [ ] **Step 2: Gates completos (os mesmos do CI)**

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run test:functions
git checkout -- deno.lock
```

Expected: tudo verde. `npm run format` corrige o que o format:check apontar.

- [ ] **Step 3: Verificação de migrations**

```bash
git fetch origin main
git ls-tree --name-only origin/main:supabase/migrations | tail -5
ls supabase/migrations | tail -8
```

Expected: os três prefixos `20260807000001..3` continuam acima do tail de `origin/main` e sem duplicatas. Se main avançou com prefixo igual ou maior, renumerar os três arquivos ANTES do PR.

- [ ] **Step 4: Commit final (se houve correções)**

```bash
git add -A && git commit -m "chore: ajustes de verificação final"
```

---

## Pós-merge (deploy, fora da execução deste plano)

Ordem segura (coluna nova é ignorada por código antigo):

1. `supabase/.temp/project-ref` para conferir o link; `npx supabase db push --linked` no staging; validar; depois prod.
2. `npx supabase functions deploy instagram-publish --no-verify-jwt --use-api` e `npx supabase functions deploy instagram-publish-cron --no-verify-jwt --use-api` (staging, depois prod).
3. Front via merge (Vercel).
4. Smoke em staging: agendar post com imagem > 8 MB (botão bloqueado), forçar uma falha e conferir bloco no drawer + notificação.
