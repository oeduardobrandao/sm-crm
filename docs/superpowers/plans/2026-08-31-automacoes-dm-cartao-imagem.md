# Cartão com imagem na DM (Fatia 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DM automática como cartão (generic template: imagem + título ≤ 80 + subtítulo ≤ 80 + botões), com upload dedicado no R2, quota de storage, fallback que preserva o CTA e prova empírica na Meta como gate.

**Architecture:** Colunas `dm_media jsonb` + `dm_subtitle` em `instagram_comment_automations` (CHECKs de forma + bind de tenant via `conta_id` na key); function nova `automation-media` (presign → PUT → finalize com `headObject` + quota atômica; delete via `trashObject`); `executeSend` monta a cadeia cartão → button template → texto, com presigned GET gerado no envio. UI: seção de mídia no form, campo de mensagem vira título+subtítulo com mídia anexada, preview em cartão.

**Tech Stack:** Postgres/Supabase migrations, Deno edge functions, Cloudflare R2 (presign + fetch puro), React 19, Vitest + `deno test`.

**Spec:** `docs/superpowers/specs/2026-08-31-automacoes-dm-midia-e-variacoes-design.md`. Leia a spec inteira antes da Task 1.

**Dependência entre PRs:** esta fatia NÃO depende do código da fatia 1, mas toca os mesmos arquivos (`process.ts`, `AutomationFormDialog.tsx`, store, `automations.json`, `65_instagram_automations.sql`). O PR da fatia 1 merga primeiro; este PR rebaseia sobre main depois e resolve os conflitos aqui.

## Global Constraints

- Worktree: rode TUDO no worktree desta fatia; confirme com `pwd` e `git branch --show-current` antes do primeiro comando e em todo commit. NUNCA use paths do repo principal.
- Sem travessão (em-dash) em NENHUMA copy voltada a usuário (i18n, toasts, labels). Use ponto, dois-pontos ou "·".
- Migration: prefixo reservado `20260901000014` (origin/main já tem `20260901000010..12`; acima do `20260901000013` da fatia 1). Antes do `gh pr create`, `git ls-tree origin/main:supabase/migrations | tail -5` e renumere acima do tail novo se main tiver andado, preservando fatia 2 > fatia 1.
- R2: NUNCA use `getR2().send(...)` para PUT/GET/DELETE em handler que grava estado; use as funções de `_shared/r2.ts` (presign + fetch puro + AbortSignal.timeout, o SDK trava no edge runtime).
- Function nova: split `index.ts` (thin, `Deno.serve`) + `handler.ts` (factory com deps injetadas) -- é requisito de testabilidade do harness deste repo.
- `npm run test:functions` suja o `deno.lock` da raiz; `git checkout -- deno.lock` antes de commitar.
- Se algum comando `deno` rodar, cheque `ls node_modules/.deno`; se existir, `npm ci` antes de confiar em checagens npm locais.
- Verificação completa antes do PR: os quatro `tsc` (crm, hub, admin, scripts), `npm run test`, `npm run test:functions`, `npm run lint`, `npm run format:check`.
- Commits pequenos, mensagens em pt, terminando com `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Limites da Meta usados neste plano: imagem jpg/png/gif ≤ 8 MB (8388608 bytes); generic template com `title` ≤ 80 e `subtitle` ≤ 80.

---

### Task 1: Milestone 0 — prova empírica em staging (GATE, requer operador)

**Files:**
- Create: `docs/superpowers/specs/2026-08-31-milestone0-generic-template-staging.md` (registro do resultado)

Esta task NÃO é automatizável de ponta a ponta: precisa de um comentário real numa conta de staging e dos segredos de staging. O implementador prepara o material e PARA, devolvendo ao orquestrador para o operador executar.

- [ ] **Step 1: Preparar o payload e o roteiro**

Escreva no arquivo novo o roteiro abaixo, preenchendo o que for possível por leitura de código (NÃO acesse segredos):

```markdown
# Milestone 0: generic template em private reply (staging)

Objetivo: provar que a Meta aceita `template_type: "generic"` numa private
reply de comentário, antes de qualquer UI. Precedente: com botões, a doc
omitia o requisito de escopo e só o teste real revelou (2026-08-15).

## Pré-requisitos (operador)
- Conta IG de staging com papel no app Meta e automação já funcional
  (a mesma usada na prova dos botões).
- Um comentário NOVO e real em um post dessa conta (private reply é 1 por
  comentário; comentário já respondido devolve already_replied).
- Token de acesso da conta: descriptografar via fluxo interno de staging
  (nunca colar token em chat/issue).

## Chamada
POST https://graph.instagram.com/v23.0/<IG_ID_PROFISSIONAL>/messages
Authorization: Bearer <TOKEN>
Content-Type: application/json

{
  "recipient": { "comment_id": "<COMMENT_ID>" },
  "message": {
    "attachment": {
      "type": "template",
      "payload": {
        "template_type": "generic",
        "elements": [{
          "title": "Chegou! Aqui está o guia.",
          "subtitle": "Qualquer dúvida, me chama por aqui.",
          "image_url": "<URL_PUBLICA_DE_IMAGEM_JPEG>",
          "buttons": [{ "type": "web_url", "url": "https://mesaas.com.br", "title": "Abrir" }]
        }]
      }
    }
  }
}

Confira a versão da Graph API usada em `_shared/instagram-messaging.ts`
(constante GRAPH_BASE) e use a MESMA.

## Variações a testar (cada uma exige comentário novo)
1. Cartão completo (acima).
2. Sem `buttons` (imagem + título + subtítulo apenas).
3. `image_url` de presigned GET do R2 de staging (não só URL pública),
   para provar que a Meta baixa de URL assinada com query string.

## Resultado (preencher)
- [ ] 1 aceito? Renderizou no app iOS/Android como cartão?
- [ ] 2 aceito?
- [ ] 3 aceito?
- Códigos de erro observados (se houver):
```

- [ ] **Step 2: Commit e PARADA obrigatória**

```bash
git add docs/superpowers/specs/2026-08-31-milestone0-generic-template-staging.md
git commit -m "docs(automacoes): roteiro do milestone 0 (generic template em staging)"
```

Reporte ao orquestrador: "Milestone 0 preparado, aguardando execução pelo operador". As Tasks 2-4 (schema, payload, function) PODEM prosseguir em paralelo à espera; as Tasks 5-7 (envio + UI) só entram depois do gate aprovado.

---

### Task 2: Migration + testes SQL

**Files:**
- Create: `supabase/migrations/20260901000014_ig_dm_media_card.sql` (versão reservada; um rename tardio de `...000002` para esta já ocorreu na branch — para leitores futuros, o filename correto é este)
- Modify: `supabase/tests/entitlements/65_instagram_automations.sql` (nova seção ao final; atualizar índice do cabeçalho)

**Interfaces:**
- Consumes: schema atual (`dm_buttons`/CHECKs de `20260819000001`; `effective_plan_limit(uuid, text)` de `20260611150001`; `workspaces.storage_used_bytes`).
- Produces: `instagram_comment_automations.dm_media jsonb` + `dm_subtitle text` com CHECKs (forma, tenant, título ≤ 80 com mídia); `dm_kind` aceita `'card' | 'card_fallback_buttons' | 'card_fallback_text'`; tabela `automation_media_objects (key pk, conta_id, content_type, size_bytes, created_at)`; RPCs `automation_media_finalize(uuid, text, bigint, text) RETURNS boolean` (idempotente por key) e `automation_media_release(uuid, text) RETURNS bigint` (devolve os bytes liberados; 0 se não havia registro); trigger `trg_ica_dm_media_finalized` (dm_media só aceita objeto finalizado da mesma workspace, metadata normalizada do registro) e índice único parcial `ica_dm_media_key_unique` (posse única da key).

- [ ] **Step 1: Escrever a migration**

```sql
-- Cartão com imagem na DM da automação comentário -> DM (generic template).
-- Spec: docs/superpowers/specs/2026-08-31-automacoes-dm-midia-e-variacoes-design.md

-- Forma do dm_media. CASE para ordem de avaliação garantida (racional do
-- validate_ig_dm_buttons, 20260819000001).
CREATE FUNCTION validate_ig_dm_media(m jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN m IS NULL THEN true
    WHEN jsonb_typeof(m) <> 'object' THEN false
    ELSE coalesce(
      (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(m) k)
        <@ ARRAY['content_type', 'height', 'key', 'size_bytes', 'width']
      AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(m) k)
        @> ARRAY['content_type', 'key', 'size_bytes']
      AND jsonb_typeof(m->'key') = 'string'
      AND m->>'key' LIKE 'automation-media/%'
      AND m->>'content_type' IN ('image/jpeg', 'image/png', 'image/gif')
      -- CASE por campo numérico: AND não garante ordem de avaliação, então o
      -- cast poderia rodar antes do type-guard e estourar 22023 cru em vez do
      -- 23514 limpo (mesmo racional do validate_ig_dm_buttons).
      AND CASE WHEN jsonb_typeof(m->'size_bytes') <> 'number' THEN false
               ELSE (m->>'size_bytes')::bigint BETWEEN 1 AND 8388608 END
      AND CASE WHEN m->'width' IS NULL THEN true
               WHEN jsonb_typeof(m->'width') <> 'number' THEN false
               ELSE (m->>'width')::int > 0 END
      AND CASE WHEN m->'height' IS NULL THEN true
               WHEN jsonb_typeof(m->'height') <> 'number' THEN false
               ELSE (m->>'height')::int > 0 END
    , false)
  END
$$;

ALTER TABLE instagram_comment_automations
  ADD COLUMN dm_media jsonb,
  ADD COLUMN dm_subtitle text,
  ADD CONSTRAINT ica_dm_media_valid CHECK (validate_ig_dm_media(dm_media)),
  -- Bind de tenant: RLS protege a LINHA, não o conteúdo do JSON. Sem isto, um
  -- usuário autenticado apontaria a própria automação para a key de OUTRA
  -- workspace e o envio (service role) pré-assinaria o objeto alheio.
  ADD CONSTRAINT ica_dm_media_tenant CHECK (
    dm_media IS NULL
    OR (dm_media->>'key') LIKE 'automation-media/' || conta_id::text || '/%'
  ),
  -- Subtítulo só existe com mídia; 1..80 após btrim.
  ADD CONSTRAINT ica_dm_subtitle_with_media CHECK (
    dm_subtitle IS NULL
    OR (dm_media IS NOT NULL AND char_length(btrim(dm_subtitle)) BETWEEN 1 AND 80)
  ),
  -- Com mídia, dm_message é o TÍTULO do cartão (limite da Meta: 80).
  ADD CONSTRAINT ica_dm_message_len_with_media CHECK (
    dm_media IS NULL OR char_length(dm_message) <= 80
  );

-- dm_kind ganha os valores do cartão. O CHECK original foi criado inline na
-- coluna (20260819000001), então o nome é o auto-gerado.
ALTER TABLE instagram_automation_sends
  DROP CONSTRAINT IF EXISTS instagram_automation_sends_dm_kind_check;
ALTER TABLE instagram_automation_sends
  ADD CONSTRAINT instagram_automation_sends_dm_kind_check CHECK (
    dm_kind IS NULL OR dm_kind IN
      ('text', 'buttons', 'buttons_fallback_text',
       'card', 'card_fallback_buttons', 'card_fallback_text')
  );

-- Quota: dm_media não tem linha própria em tabela de mídia (é jsonb), então
-- não há trigger para manter storage_used_bytes. A fonte de verdade é o
-- registro por objeto abaixo: finalize é IDEMPOTENTE por key (retry não
-- re-reserva) e o release lê o tamanho DAQUI, nunca do request (um cliente
-- não pode forjar bytes para drenar o contador). Chamadas SÓ pela function
-- automation-media (service role). Mesmo lock e mesma fonte de quota do
-- post_media_insert_with_quota (20260611150001). NUNCA criar um
-- "decrement_storage" genérico por cima (ver aviso em 20260811000002).
CREATE TABLE automation_media_objects (
  key text PRIMARY KEY,
  conta_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- RLS ligado sem policies: só as RPCs SECURITY DEFINER (service role) tocam.
ALTER TABLE automation_media_objects ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION automation_media_finalize(p_conta_id uuid, p_key text, p_bytes bigint, p_content_type text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_used bigint;
  v_quota bigint;
BEGIN
  IF p_bytes IS NULL OR p_bytes <= 0 THEN
    RAISE EXCEPTION 'invalid_bytes';
  END IF;
  SELECT storage_used_bytes INTO v_used FROM workspaces WHERE id = p_conta_id FOR UPDATE;
  IF v_used IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found';
  END IF;
  INSERT INTO automation_media_objects (key, conta_id, size_bytes, content_type)
    VALUES (p_key, p_conta_id, p_bytes, p_content_type)
    ON CONFLICT (key) DO NOTHING;
  IF NOT FOUND THEN
    -- Já finalizado (retry de cliente): idempotente, não re-reserva.
    RETURN false;
  END IF;
  v_quota := effective_plan_limit(p_conta_id, 'storage_quota_bytes');
  IF v_quota IS NOT NULL AND v_used + p_bytes > v_quota THEN
    -- O RAISE desfaz o INSERT acima na mesma transação.
    RAISE EXCEPTION 'quota_exceeded' USING errcode = 'P0001';
  END IF;
  UPDATE workspaces SET storage_used_bytes = storage_used_bytes + p_bytes
   WHERE id = p_conta_id;
  RETURN true;
END $$;

CREATE FUNCTION automation_media_release(p_conta_id uuid, p_key text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bytes bigint;
BEGIN
  DELETE FROM automation_media_objects
   WHERE key = p_key AND conta_id = p_conta_id
  RETURNING size_bytes INTO v_bytes;
  IF v_bytes IS NULL THEN
    -- Nunca finalizado, ou já liberado: no-op idempotente.
    RETURN 0;
  END IF;
  -- Anti-corrida attach/delete: se alguma automação referencia a key, aborta
  -- (o RAISE desfaz o DELETE acima). Par com o FOR KEY SHARE do trigger de
  -- attach: ou o attach commita antes (e este EXISTS o vê -> media_in_use),
  -- ou este DELETE commita antes (e o attach falha em media_not_finalized).
  IF EXISTS (SELECT 1 FROM instagram_comment_automations WHERE dm_media->>'key' = p_key) THEN
    RAISE EXCEPTION 'media_in_use' USING errcode = 'P0001';
  END IF;
  UPDATE workspaces
     SET storage_used_bytes = GREATEST(0, storage_used_bytes - v_bytes)
   WHERE id = p_conta_id;
  RETURN v_bytes;
END $$;

REVOKE ALL ON FUNCTION automation_media_finalize(uuid, text, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION automation_media_finalize(uuid, text, bigint, text) TO service_role;
REVOKE ALL ON FUNCTION automation_media_release(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION automation_media_release(uuid, text) TO service_role;

-- Posse única + finalize obrigatório na PRÓPRIA escrita da automação.
-- (1) Uma key só pode ser referenciada por UMA automação: uploads são por
-- automação (key com uuid), e posse única é o que torna o delete do CRM
-- seguro sem contagem de referências -- sem isto, duas automações da mesma
-- workspace poderiam compartilhar a key via PostgREST e o delete de uma
-- quebraria os envios da outra.
CREATE UNIQUE INDEX ica_dm_media_key_unique
  ON instagram_comment_automations ((dm_media->>'key'))
  WHERE dm_media IS NOT NULL;

-- (2) Trigger BEFORE: dm_media só aceita objeto FINALIZADO da mesma
-- workspace, e content_type/size_bytes são NORMALIZADOS do registro do
-- servidor -- uma escrita direta via PostgREST com metadata fabricada (ou
-- apontando para upload que pulou o finalize) não passa. Sem isto, o CHECK
-- de forma valida o JSON mas nada garante que o objeto existe, foi conferido
-- pelo HEAD ou entrou na quota. Roda ANTES dos CHECKs da linha (ordem do
-- Postgres: BEFORE trigger -> CHECKs), então o valor checado é o normalizado.
CREATE FUNCTION enforce_ig_dm_media_finalized()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_obj automation_media_objects;
BEGIN
  IF NEW.dm_media IS NULL THEN
    RETURN NEW;
  END IF;
  -- FOR KEY SHARE: serializa contra o DELETE do automation_media_release
  -- (anti-corrida attach/delete; ver comentário naquela RPC).
  SELECT * INTO v_obj FROM automation_media_objects
   WHERE key = NEW.dm_media->>'key' AND conta_id = NEW.conta_id
   FOR KEY SHARE;
  IF v_obj.key IS NULL THEN
    RAISE EXCEPTION 'media_not_finalized' USING errcode = 'P0001';
  END IF;
  -- width/height são apresentacionais e ficam como o cliente mandou (se
  -- números); o resto vem do registro. jsonb_strip_nulls remove width/height
  -- ausentes para o CHECK de chaves permitidas continuar passando.
  NEW.dm_media = jsonb_strip_nulls(jsonb_build_object(
    'key', v_obj.key,
    'content_type', v_obj.content_type,
    'size_bytes', v_obj.size_bytes,
    'width', CASE WHEN jsonb_typeof(NEW.dm_media->'width') = 'number' THEN NEW.dm_media->'width' END,
    'height', CASE WHEN jsonb_typeof(NEW.dm_media->'height') = 'number' THEN NEW.dm_media->'height' END
  ));
  RETURN NEW;
END $$;

CREATE TRIGGER trg_ica_dm_media_finalized
  BEFORE INSERT OR UPDATE OF dm_media ON instagram_comment_automations
  FOR EACH ROW EXECUTE FUNCTION enforce_ig_dm_media_finalized();
```

Antes de commitar, confirme o nome real do CHECK de `dm_kind` com `grep -n "dm_kind" supabase/migrations/20260819000001_instagram_dm_buttons.sql` (foi inline → nome auto `instagram_automation_sends_dm_kind_check`; o `DROP CONSTRAINT IF EXISTS` protege se divergir, mas nesse caso ajuste o nome no DROP para o real).

- [ ] **Step 2: Testes SQL (nova seção no 65)**

Seguindo o padrão das seções 7-9 (`begin; do $$...$$; rollback;`, roles como nas seções vizinhas), adicione casos: (a) automação válida com `dm_media` completo + `dm_message` de 80 chars + `dm_subtitle` como `authenticated` passa; (b) key com prefixo de OUTRO conta_id → `check_violation`; (c) key fora de `automation-media/` → `check_violation`; (d) `size_bytes` 8388609 → `check_violation`; (e) `content_type` `image/webp` → `check_violation`; (f) chave extra no objeto → `check_violation`; (g) `dm_subtitle` sem `dm_media` → `check_violation`; (h) `dm_message` 81 chars com mídia → `check_violation`; (i) `automation_media_finalize` incrementa `workspaces.storage_used_bytes` e devolve `true` na primeira chamada; a SEGUNDA chamada com a mesma key devolve `false` e NÃO incrementa de novo (idempotência); estoura `quota_exceeded` acima do limite do plano E não deixa linha em `automation_media_objects` (use `workspace_plan_overrides` para fixar um limite baixo, como as suítes de quota existentes fazem — procure o padrão em `supabase/tests/entitlements/` com `grep -l storage_quota_bytes`); (j) `automation_media_release` devolve os bytes do registro e decrementa com piso 0; a segunda chamada devolve 0 e não decrementa; release de key inexistente devolve 0; (k) INSERT/UPDATE de automação com `dm_media` apontando para key SEM registro em `automation_media_objects` → exception `media_not_finalized` (sqlstate P0001); (l) com registro presente, metadata fabricada no jsonb (size_bytes/content_type errados) é NORMALIZADA pelo trigger para os valores do registro (assert no valor salvo); (m) segunda automação referenciando a MESMA key → `unique_violation` (índice `ica_dm_media_key_unique`). Use o molde literal da seção 7 (caso "(b) 4 botões", linhas 372-384 do arquivo) para os casos de rejeição.

- [ ] **Step 3: Rodar se houver Supabase local; senão seguir (CI cobre)**

Como na fatia 1: `supabase start` + `bash scripts/test-entitlements.sh` se Docker disponível.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260901000014_ig_dm_media_card.sql supabase/tests/entitlements/65_instagram_automations.sql
git commit -m "feat(automacoes): schema do cartão com imagem (dm_media, dm_subtitle, quota RPCs)"
```

---

### Task 3: Payload — `parseDmMedia` e `buildCardMessage`

**Files:**
- Modify: `supabase/functions/_shared/instagram-dm-payload.ts`
- Modify: `supabase/functions/__tests__/instagram-dm-payload_test.ts`

**Interfaces:**
- Consumes: `DmButton`, `PrivateReplyMessage`, `parseDmButtons`, `buildFallbackText` existentes.
- Produces: `interface DmMedia { key: string; contentType: string; sizeBytes: number }`; `parseDmMedia(raw: unknown): DmMedia | null` (fail-open); `buildCardMessage(title: string, subtitle: string | null, imageUrl: string, buttons: DmButton[]): PrivateReplyMessage`; `buildCardText(title: string, subtitle: string | null): string` (o texto dos degraus de fallback: `título\n\nsubtítulo` ou só o título). `PrivateReplyMessage` ganha a variante generic template.

- [ ] **Step 1: Testes que falham**

No `instagram-dm-payload_test.ts` (siga o estilo dos testes existentes do arquivo):

```ts
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

Deno.test("buildCardText: junta título e subtítulo; sem subtítulo devolve só o título", () => {
  assertEquals(buildCardText("A", "B"), "A\n\nB");
  assertEquals(buildCardText("A", null), "A");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `deno test supabase/functions/__tests__/instagram-dm-payload_test.ts --no-check 2>&1 | tail -10`
Expected: FAIL (exports inexistentes).

- [ ] **Step 3: Implementar**

Em `instagram-dm-payload.ts`: estenda a union `PrivateReplyMessage` com:

```ts
  | {
    attachment: {
      type: "template";
      payload: {
        template_type: "generic";
        elements: Array<{
          title: string;
          subtitle?: string;
          image_url: string;
          buttons?: Array<{ type: "web_url"; url: string; title: string }>;
        }>;
      };
    };
  }
```

e adicione:

```ts
export interface DmMedia {
  key: string;
  contentType: string;
  sizeBytes: number;
}

// Fail-open como parseDmButtons: o enforcement é o CHECK do banco; aqui só
// convertemos ou descartamos com warn.
export function parseDmMedia(raw: unknown): DmMedia | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    console.warn("[instagram-dm-payload] dm_media malformado; ignorando:", typeof raw);
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.key !== "string" || typeof o.content_type !== "string" || typeof o.size_bytes !== "number") {
    console.warn("[instagram-dm-payload] dm_media sem campos obrigatórios; ignorando");
    return null;
  }
  return { key: o.key, contentType: o.content_type, sizeBytes: o.size_bytes };
}

export function buildCardText(title: string, subtitle: string | null): string {
  return subtitle ? `${title}\n\n${subtitle}` : title;
}

export function buildCardMessage(
  title: string,
  subtitle: string | null,
  imageUrl: string,
  buttons: DmButton[],
): PrivateReplyMessage {
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "generic",
        elements: [{
          title,
          ...(subtitle ? { subtitle } : {}),
          image_url: imageUrl,
          ...(buttons.length > 0
            ? { buttons: buttons.map((b) => ({ type: "web_url" as const, url: b.url, title: b.title })) }
            : {}),
        }],
      },
    },
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `deno test supabase/functions/__tests__/instagram-dm-payload_test.ts`
Expected: PASS (novos + antigos).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/instagram-dm-payload.ts supabase/functions/__tests__/instagram-dm-payload_test.ts
git commit -m "feat(automacoes): payload de generic template (cartão) e parseDmMedia"
```

---

### Task 4: Edge function `automation-media`

**Files:**
- Create: `supabase/functions/automation-media/index.ts`
- Create: `supabase/functions/automation-media/handler.ts`
- Create: `supabase/functions/__tests__/automation-media_test.ts`
- Modify: `supabase/functions/_shared/r2.ts` (novo helper `headObjectSigned`)

**Interfaces:**
- Consumes: `buildCorsHeaders` (`_shared/cors.ts`), `signPutUrl`/`signGetUrl`/`headObject`/`trashObject` (`_shared/r2.ts`), RPCs da Task 2.
- Produces: rotas `POST /automation-media/presign` → `{ upload_url, key }`; `POST /automation-media/finalize` (body `{ key, mime_type, size_bytes, width?, height? }`, idempotente por key via RPC) → `{ dm_media: { key, content_type, size_bytes, width?, height? } }`; `POST /automation-media/sign-view` → `{ url }`; `POST /automation-media/delete` (body `{ key }` — os bytes liberados vêm do registro do servidor, NUNCA do request) → `{ ok: true }`. Export `createAutomationMediaHandler(deps)`. A Task 6 (frontend) consome as quatro rotas.

- [ ] **Step 1: Testes que falham**

Molde: `supabase/functions/__tests__/file-upload-finalize_test.ts` (factory + `createSupabaseQueryMock` + `withAuth` + `authedRequest`). Escreva:

```ts
import { assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createAutomationMediaHandler } from "../automation-media/handler.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

// deno-lint-ignore no-explicit-any
function makeHandler(db: any, opts?: {
  headObject?: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;
  trashed?: string[];
  copies?: Array<{ from: string; to: string }>;
}) {
  return createAutomationMediaHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    signPutUrl: async (key: string) => `https://put.example.com/${key}`,
    signGetUrl: async (key: string) => `https://get.example.com/${key}`,
    headObject: opts?.headObject ?? (async () => ({ contentLength: 5000, contentType: "image/jpeg" })),
    trashObject: async (key: string) => { opts?.trashed?.push(key); },
    copyObject: async (from: string, to: string) => { opts?.copies?.push({ from, to }); },
    randomUUID: () => "fixed-uuid",
  });
}

function req(path: string, body: unknown, token = "valid-jwt") {
  return new Request(`https://example.test/automation-media/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// deno-lint-ignore no-explicit-any
function setupAuth(db: any, contaId = "conta-1") {
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { active_workspace_id: contaId }, error: null });
  db.queue("workspace_members", "select", { data: { user_id: "user-1" }, error: null });
}

Deno.test("presign: gera key no prefixo TMP do tenant e devolve upload_url", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const res = await makeHandler(db)(req("presign", { mime_type: "image/jpeg", size_bytes: 5000 }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.key, "automation-media-tmp/conta-1/fixed-uuid.jpg");
  assertEquals(body.upload_url, "https://put.example.com/automation-media-tmp/conta-1/fixed-uuid.jpg");
});

Deno.test("presign: mime fora da allowlist -> 415; acima de 8MB -> 400; sem auth -> 401", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  assertEquals((await makeHandler(db)(req("presign", { mime_type: "image/webp", size_bytes: 10 }))).status, 415);
  const db2 = createSupabaseQueryMock();
  setupAuth(db2);
  assertEquals(
    (await makeHandler(db2)(req("presign", { mime_type: "image/png", size_bytes: 8388609 }))).status,
    400,
  );
  const db3 = createSupabaseQueryMock();
  db3.withAuth(null, { message: "bad token" });
  assertEquals((await makeHandler(db3)(req("presign", { mime_type: "image/png", size_bytes: 10 }))).status, 401);
});

Deno.test("finalize: copia tmp -> final, HEAD confere a FINAL, finaliza com quota e devolve dm_media com a key final", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("automation_media_objects", "select", { data: null, error: null });
  db.queueRpc("automation_media_finalize", { data: true, error: null });
  const copies: Array<{ from: string; to: string }> = [];
  const trashed: string[] = [];
  const res = await makeHandler(db, { copies, trashed })(req("finalize", {
    key: "automation-media-tmp/conta-1/fixed-uuid.jpg",
    mime_type: "image/jpeg",
    size_bytes: 5000,
    width: 1080,
    height: 1350,
  }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.dm_media, {
    key: "automation-media/conta-1/fixed-uuid.jpg",
    content_type: "image/jpeg",
    size_bytes: 5000,
    width: 1080,
    height: 1350,
  });
  assertEquals(copies, [{
    from: "automation-media-tmp/conta-1/fixed-uuid.jpg",
    to: "automation-media/conta-1/fixed-uuid.jpg",
  }]);
  // A tmp é trasheada após a cópia (best-effort).
  assertEquals(trashed, ["automation-media-tmp/conta-1/fixed-uuid.jpg"]);
  const rpcs = db.calls.filter((c: { table: string }) => c.table === "rpc:automation_media_finalize");
  assertEquals(rpcs[0].payload, {
    p_conta_id: "conta-1",
    p_key: "automation-media/conta-1/fixed-uuid.jpg",
    p_bytes: 5000,
    p_content_type: "image/jpeg",
  });
});

Deno.test("finalize: retry com resposta perdida devolve o canônico do registro sem recopiar", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("automation_media_objects", "select", {
    data: { key: "automation-media/conta-1/fixed-uuid.jpg", content_type: "image/jpeg", size_bytes: 5000 },
    error: null,
  });
  const copies: Array<{ from: string; to: string }> = [];
  const res = await makeHandler(db, { copies })(req("finalize", {
    key: "automation-media-tmp/conta-1/fixed-uuid.jpg",
    mime_type: "image/jpeg",
    size_bytes: 5000,
  }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).dm_media.key, "automation-media/conta-1/fixed-uuid.jpg");
  assertEquals(copies, []);
});

Deno.test("finalize: key tmp de outro tenant -> 400; size divergente do HEAD -> 400; quota -> 413 e trasheia a final", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  assertEquals(
    (await makeHandler(db)(req("finalize", { key: "automation-media-tmp/OUTRA/x.jpg", mime_type: "image/jpeg", size_bytes: 5000 }))).status,
    400,
  );
  const db2 = createSupabaseQueryMock();
  setupAuth(db2);
  db2.queue("automation_media_objects", "select", { data: null, error: null });
  const copies2: Array<{ from: string; to: string }> = [];
  assertEquals(
    (await makeHandler(db2, { copies: copies2, headObject: async () => ({ contentLength: 999, contentType: "image/jpeg" }) })(
      req("finalize", { key: "automation-media-tmp/conta-1/x.jpg", mime_type: "image/jpeg", size_bytes: 5000 }),
    )).status,
    400,
  );
  // Mismatch detectado no HEAD da TMP: nada foi copiado ao prefixo permanente.
  assertEquals(copies2, []);
  const db3 = createSupabaseQueryMock();
  setupAuth(db3);
  db3.queue("automation_media_objects", "select", { data: null, error: null });
  db3.queueRpc("automation_media_finalize", { data: null, error: { message: "quota_exceeded" } });
  const trashed3: string[] = [];
  assertEquals(
    (await makeHandler(db3, { trashed: trashed3 })(req("finalize", { key: "automation-media-tmp/conta-1/x.jpg", mime_type: "image/jpeg", size_bytes: 5000 }))).status,
    413,
  );
  // Upload rejeitado por quota não fica retido: a cópia FINAL vai para o trash
  // (a tmp vira órfã aceita).
  assertEquals(trashed3.includes("automation-media/conta-1/x.jpg"), true);
});

Deno.test("delete: trasheia (nunca hard delete) e libera pelo registro do servidor; prefixo de outro tenant -> 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("instagram_comment_automations", "select", { data: [], error: null });
  db.queueRpc("automation_media_release", { data: 5000, error: null });
  const trashed: string[] = [];
  const res = await makeHandler(db, { trashed })(req("delete", {
    key: "automation-media/conta-1/x.jpg",
  }));
  assertEquals(res.status, 200);
  assertEquals(trashed, ["automation-media/conta-1/x.jpg"]);
  const rpcs = db.calls.filter((c: { table: string }) => c.table === "rpc:automation_media_release");
  assertEquals(rpcs[0].payload, {
    p_conta_id: "conta-1",
    p_key: "automation-media/conta-1/x.jpg",
  });

  const db2 = createSupabaseQueryMock();
  setupAuth(db2);
  assertEquals(
    (await makeHandler(db2)(req("delete", { key: "automation-media/OUTRA/x.jpg" }))).status,
    400,
  );
});

Deno.test("delete: key ainda referenciada por automação -> 409 e nada é trasheado", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("instagram_comment_automations", "select", { data: [{ id: "auto-1" }], error: null });
  const trashed: string[] = [];
  const res = await makeHandler(db, { trashed })(req("delete", { key: "automation-media/conta-1/x.jpg" }));
  assertEquals(res.status, 409);
  assertEquals(trashed, []);
});

Deno.test("sign-view: devolve GET assinado só para key do tenant", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const res = await makeHandler(db)(req("sign-view", { key: "automation-media/conta-1/x.jpg" }));
  assertEquals((await res.json()).url, "https://get.example.com/automation-media/conta-1/x.jpg");
  const db2 = createSupabaseQueryMock();
  setupAuth(db2);
  assertEquals(
    (await makeHandler(db2)(req("sign-view", { key: "automation-media/OUTRA/x.jpg" }))).status,
    400,
  );
});
```

Confira a API real de `withAuth` no `test/shared/supabaseMock.ts` (assinatura `withAuth(user, error?)`) e ajuste `db3.withAuth(null, ...)` se o mock exigir outra forma para "sem usuário".

- [ ] **Step 2: Rodar e ver falhar**

Run: `deno test supabase/functions/__tests__/automation-media_test.ts --no-check 2>&1 | tail -10`
Expected: FAIL (handler inexistente).

- [ ] **Step 3: Implementar handler + index**

Antes do handler, adicione em `_shared/r2.ts` o helper `headObjectSigned` -- mesmo contrato do `headObject` atual (`Promise<{ contentLength: number; contentType: string | null } | null>`, null em qualquer falha) mas via **presign + fetch puro + AbortSignal**, nunca `getR2().send()` (o transport do SDK é o caminho documentado de travamento no edge runtime, e finalize é um handler que grava estado):

```ts
/** Cópia via presign + fetch puro, SEM apagar a origem (metade "copy" do
 * trashObject; reusa exatamente a técnica documentada lá, incluindo o aviso
 * de NÃO enviar x-amz-copy-source como header -- o presigner o embute na
 * query string e duplicá-lo dá 403 SignatureDoesNotMatch, causa raiz do
 * incidente de 2026-08). Lança em falha. */
export async function copyObjectSigned(sourceKey: string, destKey: string): Promise<void> {
  const copySource = `${getBucket()}/${encodeURIComponent(sourceKey).replace(/%2F/g, "/")}`;
  const cmd = new CopyObjectCommand({
    Bucket: getBucket(),
    CopySource: copySource,
    Key: destKey,
  });
  const url = await getSignedUrl(getR2(), cmd, { expiresIn: 300 });
  const res = await fetch(url, { method: "PUT", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`r2 copy failed: ${res.status}${bodyText ? ` ${bodyText.slice(0, 300)}` : ""}`);
  }
}

/** HEAD via presign + fetch puro (mesmo racional de putObject/deleteObject:
 * o transport do SDK trava no edge runtime; este helper é para handlers que
 * gravam estado). null em 404 ou qualquer falha. */
export async function headObjectSigned(
  key: string,
): Promise<{ contentLength: number; contentType: string | null } | null> {
  try {
    const cmd = new HeadObjectCommand({ Bucket: getBucket(), Key: key });
    const url = await getSignedUrl(getR2(), cmd, { expiresIn: 300 });
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return {
      contentLength: Number(res.headers.get("content-length") ?? 0),
      contentType: res.headers.get("content-type"),
    };
  } catch (_e) {
    return null;
  }
}
```

`handler.ts` (factory; roteamento por segmento como `post-media-manage/handler.ts:96-100`; tenant = workspace ativa + membership, padrão do `report-docs/index.ts` -- NÃO o `profiles.conta_id` dos handlers antigos de post-media):

```ts
// supabase/functions/automation-media/handler.ts
// Upload/ciclo de vida da mídia do cartão de DM das automações.
// Spec: docs/superpowers/specs/2026-08-31-automacoes-dm-midia-e-variacoes-design.md
// Contrato de upload: presign -> PUT direto no R2 -> finalize (HEAD confere o
// objeto REAL + reserva quota atômica). delete: trashObject (undo 30d) +
// liberação de quota. Nada aqui grava dm_media na automação: quem grava é o
// CRM via PostgREST, e o CHECK de tenant do banco é o enforcement final.

const MAX_MEDIA_BYTES = 8 * 1024 * 1024; // limite de imagem da Meta
const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
};

export interface AutomationMediaDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  // deno-lint-ignore no-explicit-any
  createDb: () => any;
  signPutUrl: (key: string, mimeType: string) => Promise<string>;
  signGetUrl: (key: string) => Promise<string>;
  headObject: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;
  trashObject: (key: string) => Promise<void>;
  copyObject: (sourceKey: string, destKey: string) => Promise<void>;
  randomUUID?: () => string;
}

export function createAutomationMediaHandler(deps: AutomationMediaDeps) {
  const randomUUID = deps.randomUUID ?? (() => crypto.randomUUID());

  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = (b: unknown, s = 200) =>
      new Response(JSON.stringify(b), {
        status: s,
        headers: { ...cors, "Content-Type": "application/json" },
      });

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const svc = deps.createDb();
    const { data: { user } = { user: null }, error: authErr } = await svc.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);
    // Tenant = workspace ATIVA + membership confirmada, padrão do report-docs
    // (conta_id NÃO é fallback: usuário multi-workspace operaria na workspace
    // errada, e membro removido manteria acesso). Copie o bloco literal de
    // supabase/functions/report-docs/index.ts (resolução de tenant, ~linhas
    // 50-60) e adapte só os nomes -- se o shape real divergir do abaixo, o
    // report-docs vence.
    const { data: profile } = await svc.from("profiles").select("active_workspace_id").eq("id", user.id).single();
    const contaId = profile?.active_workspace_id as string | undefined;
    if (!contaId) return json({ error: "Profile not found" }, 403);
    const { data: member } = await svc
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", contaId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!member) return json({ error: "Forbidden" }, 403);
    const tenantPrefix = `automation-media/${contaId}/`;

    const parts = new URL(req.url).pathname.split("/").filter(Boolean);
    const route = parts[parts.indexOf("automation-media") + 1];

    // deno-lint-ignore no-explicit-any
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    if (route === "presign") {
      const mime = String(body.mime_type ?? "");
      const size = Number(body.size_bytes ?? 0);
      if (!(mime in ALLOWED_MIME)) return json({ error: "unsupported file type" }, 415);
      if (!Number.isFinite(size) || size <= 0 || size > MAX_MEDIA_BYTES) {
        return json({ error: "invalid size" }, 400);
      }
      // Upload SEMPRE no prefixo tmp. A key FINAL (a única que dm_media
      // aceita) nunca recebe PUT pré-assinado: o finalize copia tmp -> final,
      // então sobrescrever a tmp depois (a URL vive 15 min) não alcança o
      // objeto contabilizado/servido. Tmp abandonada é órfã aceita.
      const key = `automation-media-tmp/${contaId}/${randomUUID()}.${ALLOWED_MIME[mime]}`;
      const upload_url = await deps.signPutUrl(key, mime);
      return json({ upload_url, key });
    }

    if (route === "finalize") {
      const tmpKey = String(body.key ?? "");
      const mime = String(body.mime_type ?? "");
      const size = Number(body.size_bytes ?? 0);
      const tmpPrefix = `automation-media-tmp/${contaId}/`;
      if (!tmpKey.startsWith(tmpPrefix)) return json({ error: "invalid key" }, 400);
      if (!(mime in ALLOWED_MIME)) return json({ error: "unsupported file type" }, 415);
      if (!Number.isFinite(size) || size <= 0 || size > MAX_MEDIA_BYTES) {
        return json({ error: "invalid size" }, 400);
      }
      const key = `${tenantPrefix}${tmpKey.slice(tmpPrefix.length)}`;
      // Retry idempotente: se a resposta do finalize anterior se perdeu, a key
      // final JÁ tem registro -- devolve o canônico sem recopiar (recopiar a
      // tmp, que pode ter sido sobrescrita pela URL de PUT ainda válida,
      // corromperia a final já verificada).
      const { data: existing } = await svc
        .from("automation_media_objects")
        .select("key, content_type, size_bytes")
        .eq("key", key)
        .eq("conta_id", contaId)
        .maybeSingle();
      // Guard em existing?.key (não `if (existing)`): o maybeSingle real devolve
      // null sem linha, mas o mock do harness devolve [] por default, que é
      // truthy -- e uma linha real sempre tem key NOT NULL. O guard vale para
      // os dois contratos.
      if (existing?.key) {
        const w = Number.isFinite(Number(body.width)) && Number(body.width) > 0 ? Number(body.width) : undefined;
        const h = Number.isFinite(Number(body.height)) && Number(body.height) > 0 ? Number(body.height) : undefined;
        return json({
          dm_media: {
            key: existing.key,
            content_type: existing.content_type,
            size_bytes: existing.size_bytes,
            ...(w ? { width: w } : {}),
            ...(h ? { height: h } : {}),
          },
        });
      }
      // Valida a TMP antes de copiar (falha barata, nada chega ao prefixo
      // permanente) e revalida a FINAL depois (a URL de PUT da tmp segue viva:
      // uma sobrescrita entre o HEAD e a cópia não pode sobreviver). Qualquer
      // falha PÓS-cópia trasheia a final -- sem isso, requests repetidos com
      // mismatch acumulariam objetos não medidos fora da quota.
      const tmpHead = await deps.headObject(tmpKey);
      if (!tmpHead) return json({ error: "object not found" }, 400);
      if (tmpHead.contentLength !== size) return json({ error: "size mismatch" }, 400);
      if (tmpHead.contentType && tmpHead.contentType !== mime) {
        return json({ error: "content-type mismatch" }, 400);
      }
      try {
        await deps.copyObject(tmpKey, key);
      } catch (e) {
        console.error("[automation-media] copy tmp->final:", e instanceof Error ? e.message : String(e));
        return json({ error: "object not found" }, 400);
      }
      const failFinal = async (err: string) => {
        await deps.trashObject(key).catch(() => {});
        return json({ error: err }, 400);
      };
      const head = await deps.headObject(key);
      if (!head) return await failFinal("object not found");
      if (head.contentLength !== size) return await failFinal("size mismatch");
      if (head.contentType && head.contentType !== mime) return await failFinal("content-type mismatch");

      const { error: rpcErr } = await svc.rpc("automation_media_finalize", {
        p_conta_id: contaId,
        p_key: key,
        p_bytes: size,
        p_content_type: mime,
      });
      if (rpcErr) {
        const msg = String(rpcErr.message ?? "");
        if (msg.includes("quota_exceeded")) {
          // Não deixa o upload rejeitado retido fora da contabilidade.
          await deps.trashObject(key).catch((e) =>
            console.error("[automation-media] trash pós-quota:", e instanceof Error ? e.message : String(e))
          );
          return json({ error: "quota_exceeded" }, 413);
        }
        console.error("[automation-media] finalize:", msg);
        return json({ error: "internal" }, 500);
      }
      // Tmp cumpriu o papel; trash best-effort (falha vira órfã tmp, aceita).
      await deps.trashObject(tmpKey).catch(() => {});
      const width = Number.isFinite(Number(body.width)) && Number(body.width) > 0 ? Number(body.width) : undefined;
      const height = Number.isFinite(Number(body.height)) && Number(body.height) > 0 ? Number(body.height) : undefined;
      return json({
        dm_media: {
          key,
          content_type: mime,
          size_bytes: size,
          ...(width ? { width } : {}),
          ...(height ? { height } : {}),
        },
      });
    }

    if (route === "sign-view") {
      const key = String(body.key ?? "");
      if (!key.startsWith(tenantPrefix)) return json({ error: "invalid key" }, 400);
      return json({ url: await deps.signGetUrl(key) });
    }

    if (route === "delete") {
      const key = String(body.key ?? "");
      if (!key.startsWith(tenantPrefix)) return json({ error: "invalid key" }, 400);
      // Pre-check rápido de referência: devolve 409 sem tocar R2/RPC quando a
      // key ainda está anexada. NÃO é a garantia (corrida entre este select e
      // a RPC existe); a garantia transacional é o ref-check DENTRO da RPC.
      const { data: refs, error: refErr } = await svc
        .from("instagram_comment_automations")
        .select("id")
        .eq("dm_media->>key", key)
        .limit(1);
      if (refErr) {
        console.error("[automation-media] ref pre-check:", refErr.message);
        return json({ error: "internal" }, 500);
      }
      if ((refs ?? []).length > 0) return json({ error: "media_in_use" }, 409);
      // ORDEM: release ANTES do trash. A RPC faz, na mesma transação, o
      // ref-check anti-corrida (media_in_use se alguma automação referencia)
      // e remove o registro -- a partir daí nenhum attach novo passa no
      // trigger, então o trash abaixo nunca apaga objeto referenciado. Os
      // bytes liberados vêm do registro do servidor, nunca do request.
      const { error: rpcErr } = await svc.rpc("automation_media_release", {
        p_conta_id: contaId,
        p_key: key,
      });
      if (rpcErr) {
        const msg = String(rpcErr.message ?? "");
        if (msg.includes("media_in_use")) return json({ error: "media_in_use" }, 409);
        console.error("[automation-media] release:", msg);
        return json({ error: "internal" }, 500);
      }
      try {
        await deps.trashObject(key);
      } catch (e) {
        // Registro já liberado; objeto vira órfão não contabilizado (aceito,
        // reap futuro). Retry do cliente: release devolve 0 e re-trasheia.
        console.error("[automation-media] trashObject:", e instanceof Error ? e.message : String(e));
        return json({ error: "internal" }, 500);
      }
      return json({ ok: true });
    }

    return json({ error: "not found" }, 404);
  };
}
```

`index.ts` (molde: `post-media-manage/index.ts`):

```ts
// supabase/functions/automation-media/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { makeBoundedFetch } from "../_shared/bounded-fetch.ts";
import { copyObjectSigned, headObjectSigned, signGetUrl, signPutUrl, trashObject } from "../_shared/r2.ts";
import { createAutomationMediaHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createAutomationMediaHandler({
  buildCorsHeaders,
  createDb: () =>
    createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      // Handler grava estado: TODA chamada Supabase (Auth/PostgREST/RPC) com
      // teto de tempo, senão um stall deixa R2/quota meio-progredidos sem
      // resposta tratada. Padrão do report-docs; helper promovido a _shared.
      global: { fetch: makeBoundedFetch() },
    }),
  signPutUrl,
  signGetUrl,
  headObject: headObjectSigned,
  trashObject,
  copyObject: copyObjectSigned,
}));
```

Confira o import exato de `createClient` usado nas functions vizinhas (`grep -n "supabase-js" supabase/functions/post-media-finalize/index.ts`) e use o MESMO especificador/versão.

- [ ] **Step 4: Rodar e ver passar**

Run: `deno test supabase/functions/__tests__/automation-media_test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/automation-media/ supabase/functions/__tests__/automation-media_test.ts supabase/functions/_shared/r2.ts
git commit -m "feat(automacoes): edge function automation-media (presign, finalize com quota, trash)"
```

---

### Task 5: `executeSend` — cadeia do cartão (SÓ APÓS o gate do Milestone 0)

**Files:**
- Modify: `supabase/functions/instagram-webhook/process.ts`
- Modify: `supabase/functions/__tests__/instagram-webhook-process_test.ts`

**Interfaces:**
- Consumes: `parseDmMedia`, `buildCardMessage`, `buildCardText`, `buildFallbackText` (Task 3); `signGetUrl` de `_shared/r2.ts`; colunas da Task 2.
- Produces: `SendContext` ganha `signMediaUrl?: (key: string) => Promise<string>` (default `signGetUrl`); `DmKind` ganha `"card" | "card_fallback_buttons" | "card_fallback_text"`; `RevalidatedAutomation` ganha `dm_media: unknown; dm_subtitle: string | null`. O cron reusa `executeSend` sem mudança.

- [ ] **Step 1: Testes que falham**

Ajuste primeiro o fixture `revalidatedAutomation` (linha ~138): adicione `dm_media: null, dm_subtitle: null` ao default. Casos novos no bloco `executeSend`:

```ts
const CARD_MEDIA = {
  key: "automation-media/conta-1/img.jpg",
  content_type: "image/jpeg",
  size_bytes: 5000,
};
// ATENÇÃO: o valor de conta_id do CARD_MEDIA.key deve bater com o conta_id do
// baseClaimedSend (constante CONTA_ID do arquivo) -- ajuste a string acima.

const CARD_BODY = {
  recipient: { comment_id: COMMENT_ID },
  message: {
    attachment: {
      type: "template",
      payload: {
        template_type: "generic",
        elements: [{
          title: "msg",
          subtitle: "sub",
          image_url: `https://signed.example.com/${CARD_MEDIA.key}`,
          buttons: [{ type: "web_url", url: "https://a.b", title: "Abrir" }],
        }],
      },
    },
  },
};

Deno.test("executeSend (card-1): com dm_media envia generic template e grava dm_kind card", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: revalidatedAutomation({
      dm_media: CARD_MEDIA,
      dm_subtitle: "sub",
      dm_buttons: [{ title: "Abrir", url: "https://a.b" }],
      public_reply: null,
    }),
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queueRpc("mark_automation_dm_sent", { data: true, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // fechamento

  const { fetchFn, calls } = routedFetch({ privateReply: () => ({ body: {} }) });

  await executeSend(
    baseSendCtx(db, { fetchFn, signMediaUrl: (k: string) => Promise.resolve(`https://signed.example.com/${k}`) }),
    baseClaimedSend({}),
  );

  const dmCalls = calls.filter((c) => c.url.includes("/messages"));
  assertEquals(JSON.parse(dmCalls[0].body ?? "null"), CARD_BODY);
  const marks = rpcCallsFor(db, "mark_automation_dm_sent");
  assertEquals(marks[0].payload, { p_send_id: SEND_ID, p_dm_kind: "card" });
});

Deno.test("executeSend (card-2): permanent no cartão cai para button template; permanent de novo cai para texto", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: revalidatedAutomation({
      dm_media: CARD_MEDIA,
      dm_subtitle: "sub",
      dm_buttons: [{ title: "Abrir", url: "https://a.b" }],
      public_reply: null,
    }),
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queueRpc("mark_automation_dm_sent", { data: true, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null });

  let attempt = 0;
  const { fetchFn, calls } = routedFetch({
    privateReply: () => {
      attempt++;
      if (attempt <= 2) return { status: 400, ok: false, body: { error: { message: "no", code: 100 } } };
      return { body: {} };
    },
  });

  await executeSend(
    baseSendCtx(db, { fetchFn, signMediaUrl: (k: string) => Promise.resolve(`https://s/${k}`) }),
    baseClaimedSend({}),
  );

  const dmCalls = calls.filter((c) => c.url.includes("/messages"));
  assertEquals(dmCalls.length, 3);
  // 2ª tentativa: button template com o texto do cartão
  const second = JSON.parse(dmCalls[1].body ?? "null");
  assertEquals(second.message.attachment.payload.template_type, "button");
  assertEquals(second.message.attachment.payload.text, "msg\n\nsub");
  // 3ª tentativa: texto puro com links
  const third = JSON.parse(dmCalls[2].body ?? "null");
  assertEquals(typeof third.message.text, "string");
  const marks = rpcCallsFor(db, "mark_automation_dm_sent");
  assertEquals(marks[0].payload, { p_send_id: SEND_ID, p_dm_kind: "card_fallback_text" });
});

Deno.test("executeSend (card-3): sem botões a cadeia é cartão -> texto (2 POSTs) e permanent duplo falha dm_permanent", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: revalidatedAutomation({ dm_media: CARD_MEDIA, dm_subtitle: null, public_reply: null }),
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // failed

  const { fetchFn, calls } = routedFetch({
    privateReply: () => ({ status: 400, ok: false, body: { error: { message: "no", code: 100 } } }),
  });

  await executeSend(
    baseSendCtx(db, { fetchFn, signMediaUrl: (k: string) => Promise.resolve(`https://s/${k}`) }),
    baseClaimedSend({}),
  );

  assertEquals(calls.filter((c) => c.url.includes("/messages")).length, 2);
  const updates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(updates[0].payload, { status: "failed", error_code: "dm_permanent" });
});

Deno.test("executeSend (card-4): falha ao pré-assinar a mídia agenda retry (transient), sem POST", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: revalidatedAutomation({ dm_media: CARD_MEDIA, dm_subtitle: null, public_reply: null }),
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // retry

  const { fetchFn, calls } = routedFetch({ privateReply: unreachable("privateReply") });

  await executeSend(
    baseSendCtx(db, { fetchFn, signMediaUrl: () => Promise.reject(new Error("r2 down")) }),
    baseClaimedSend({ attempts: 0 }),
  );

  assertEquals(calls.length, 0);
  const updates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(updates[0].payload, {
    status: "retry",
    next_attempt_at: new Date(FIXED_NOW.getTime() + BACKOFF_SECONDS[0] * 1000).toISOString(),
    attempts: 1,
  });
});

Deno.test("executeSend (card-5): key fora do prefixo do tenant ignora a mídia e envia como hoje", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: revalidatedAutomation({
      dm_media: { ...CARD_MEDIA, key: "automation-media/OUTRA-CONTA/img.jpg" },
      dm_subtitle: null,
      public_reply: null,
    }),
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queueRpc("mark_automation_dm_sent", { data: true, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null });

  const { fetchFn, calls } = routedFetch({ privateReply: () => ({ body: {} }) });

  await executeSend(
    baseSendCtx(db, { fetchFn, signMediaUrl: unreachable("signMediaUrl") as never }),
    baseClaimedSend({}),
  );

  const dmCalls = calls.filter((c) => c.url.includes("/messages"));
  assertEquals(JSON.parse(dmCalls[0].body ?? "null").message, { text: "msg" });
  const marks = rpcCallsFor(db, "mark_automation_dm_sent");
  assertEquals(marks[0].payload, { p_send_id: SEND_ID, p_dm_kind: "text" });
});
```

Confira `revalidatedAutomation` defaults (dm_message do fixture é `"msg"`? veja linha ~138 e use o valor real nos asserts) e a constante `CONTA_ID`. Confira também que `baseSendCtx(db, opts)` (linha ~177) faz spread das opts extras no contexto (`{ ...opts }`); se ele só aceitar campos nomeados, estenda-o para repassar `signMediaUrl`.

Nota de escopo (decisão da spec sobre o agente MCP, já resolvida): `instagram_comment_automations` não tem allowlist de colunas (o gotcha de GRANT por coluna vale só para membros/clientes) e a migration `20260829000002` só recria policies RLS por linha; as colunas novas ficam automaticamente graváveis pelo caminho do agente. Nada a fazer além dos CHECKs, que valem para qualquer gravador.

- [ ] **Step 2: Rodar e ver falhar**

Run: `deno test supabase/functions/__tests__/instagram-webhook-process_test.ts --no-check 2>&1 | tail -20`
Expected: FAIL nos 5 novos.

- [ ] **Step 3: Implementar em `process.ts`**

1. Imports: `parseDmMedia, buildCardMessage, buildCardText` de `../_shared/instagram-dm-payload.ts`; `signGetUrl` de `../_shared/r2.ts`.
2. `DmKind`: `type DmKind = "text" | "buttons" | "buttons_fallback_text" | "card" | "card_fallback_buttons" | "card_fallback_text";`
3. `SendContext`: `signMediaUrl?: (key: string) => Promise<string>;`
4. `RevalidatedAutomation`: `dm_media: unknown; dm_subtitle: string | null;` e incluir `dm_media, dm_subtitle` no `.select(...)` da revalidação.
5. Na montagem de `dmAttempts` (bloco atual em ~471-487), substitua por:

```ts
  let dmDelivered = send.dm_status === "sent";
  let deliveredKind: DmKind | null = null;
  if (!dmDelivered) {
    const buttons = parseDmButtons(automation.dm_buttons);
    const rawMedia = parseDmMedia(automation.dm_media);
    // Defesa em profundidade: espelha o CHECK de tenant do banco. Key fora do
    // prefixo da própria conta NUNCA é pré-assinada; segue como automação sem
    // mídia (o CHECK impede isso de existir, mas o envio não confia só nele).
    const media = rawMedia && rawMedia.key.startsWith(`automation-media/${send.conta_id}/`) ? rawMedia : null;
    if (rawMedia && !media) {
      console.warn(`[instagram-webhook] dm_media com key fora do tenant no send ${send.send_id}; ignorando mídia`);
    }

    const dmAttempts: Array<{ message: PrivateReplyMessage; kind: DmKind }> = [];
    if (media) {
      // Presign no envio; falha aqui é infra nossa (R2), nunca da Graph ->
      // trata como transient (retry com backoff), sem nenhum POST.
      let imageUrl: string;
      try {
        imageUrl = await (ctx.signMediaUrl ?? signGetUrl)(media.key);
      } catch (e) {
        console.error(`[instagram-webhook] presign da mídia falhou no send ${send.send_id}:`, errMessage(e));
        const commentTooOld = new Date(send.comment_created_at).getTime() <= nowDate.getTime() - RETRY_WINDOW_MS;
        if (send.attempts >= MAX_ATTEMPTS || commentTooOld) {
          const { error } = await ctx.svc
            .from("instagram_automation_sends")
            .update({ status: "failed", error_code: "retry_exhausted" })
            .eq("id", send.send_id);
          if (error) throw new Error(`instagram_automation_sends (retry_exhausted): ${errMessage(error)}`);
        } else {
          const backoffSeconds = BACKOFF_SECONDS[send.attempts];
          const { error } = await ctx.svc
            .from("instagram_automation_sends")
            .update({
              status: "retry",
              next_attempt_at: new Date(nowDate.getTime() + backoffSeconds * 1000).toISOString(),
              attempts: send.attempts + 1,
            })
            .eq("id", send.send_id);
          if (error) throw new Error(`instagram_automation_sends (retry): ${errMessage(error)}`);
        }
        return;
      }
      const subtitle = typeof automation.dm_subtitle === "string" && automation.dm_subtitle.trim() !== ""
        ? automation.dm_subtitle.trim()
        : null;
      const cardText = buildCardText(automation.dm_message, subtitle);
      dmAttempts.push({
        message: buildCardMessage(automation.dm_message, subtitle, imageUrl, buttons),
        kind: "card",
      });
      if (buttons.length > 0) {
        dmAttempts.push({
          message: buildPrivateReplyMessage(cardText, buttons),
          kind: "card_fallback_buttons",
        });
        dmAttempts.push({
          message: { text: buildFallbackText(cardText, buttons) },
          kind: "card_fallback_text",
        });
      } else {
        dmAttempts.push({ message: { text: cardText }, kind: "card_fallback_text" });
      }
    } else {
      dmAttempts.push({
        message: buildPrivateReplyMessage(automation.dm_message, buttons),
        kind: buttons.length > 0 ? "buttons" : "text",
      });
      if (buttons.length > 0) {
        dmAttempts.push({
          message: { text: buildFallbackText(automation.dm_message, buttons) },
          kind: "buttons_fallback_text",
        });
      }
    }
```

O loop de tentativas existente (for com classify/permanent/continue) permanece IDÊNTICO: ele já avança para o próximo item da lista em `permanent` e cai nas ramificações atuais nos demais kinds. Confirme apenas que a mensagem de log do fallback (linha ~504) continua fazendo sentido com 3 itens.

- [ ] **Step 4: Rodar e ver passar (novos E antigos)**

Run: `deno test supabase/functions/__tests__/instagram-webhook-process_test.ts && deno test supabase/functions/__tests__/instagram-automation-cron_test.ts`
Expected: PASS em tudo.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/instagram-webhook/process.ts supabase/functions/__tests__/instagram-webhook-process_test.ts
git commit -m "feat(automacoes): cadeia de envio do cartão com imagem no executeSend"
```

---

### Task 6: Frontend — serviço de upload, formulário, preview, página

**Files:**
- Create: `apps/crm/src/services/automationMedia.ts`
- Modify: `apps/crm/src/store/instagramAutomations.ts`
- Modify: `apps/crm/src/pages/automacoes/AutomationFormDialog.tsx`
- Modify: `apps/crm/src/pages/automacoes/DmPreview.tsx`
- Modify: `apps/crm/src/pages/automacoes/AutomacoesPage.tsx`
- Modify: `packages/i18n/locales/pt/automations.json` + `packages/i18n/locales/en/automations.json`
- Test: `apps/crm/src/pages/automacoes/__tests__/AutomationFormDialog.test.tsx`, `apps/crm/src/pages/automacoes/__tests__/DmPreview.test.tsx`

**Interfaces:**
- Consumes: rotas da Task 4; tipos da Task 2.
- Produces: tipo `DmMedia { key: string; content_type: string; size_bytes: number; width?: number; height?: number }` exportado do store; `InstagramCommentAutomation` ganha `dm_media: DmMedia | null; dm_subtitle: string | null`; whitelists ganham `'dm_media' | 'dm_subtitle'`; `uploadAutomationMedia(file, onProgress?) => Promise<DmMedia>`, `deleteAutomationMedia(media) => Promise<void>`, `signAutomationMediaView(key) => Promise<string>`.

- [ ] **Step 1: Serviço `automationMedia.ts`**

Molde: `apps/crm/src/services/postMedia.ts` (`callFn` em L14-40, `putWithProgress` em L154-173 -- copie os dois helpers ou importe se exportados). Conteúdo:

```ts
// apps/crm/src/services/automationMedia.ts
// Upload da mídia do cartão de DM: presign -> PUT -> finalize (HEAD + quota).
import { supabase } from '@/lib/supabase';
import type { DmMedia } from '../store/instagramAutomations';

const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/gif'];

async function callFn<T>(name: string, path: string, body: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sessão expirada');
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}/${path}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

export function validateAutomationMediaFile(file: File): string | null {
  if (!ALLOWED_MIME.includes(file.type)) return 'form.mediaInvalidType';
  if (file.size > MAX_MEDIA_BYTES) return 'form.mediaTooLarge';
  return null;
}

export async function uploadAutomationMedia(
  file: File,
  onProgress?: (p: { loaded: number; total: number }) => void,
): Promise<DmMedia> {
  const probe = await probeImage(file).catch(() => null);
  const signed = await callFn<{ upload_url: string; key: string }>('automation-media', 'presign', {
    mime_type: file.type,
    size_bytes: file.size,
  });
  await putWithProgress(signed.upload_url, file, onProgress);
  const { dm_media } = await callFn<{ dm_media: DmMedia }>('automation-media', 'finalize', {
    key: signed.key,
    mime_type: file.type,
    size_bytes: file.size,
    width: probe?.width,
    height: probe?.height,
  });
  return dm_media;
}

export async function deleteAutomationMedia(media: DmMedia): Promise<void> {
  await callFn<{ ok: boolean }>('automation-media', 'delete', { key: media.key });
}

export async function signAutomationMediaView(key: string): Promise<string> {
  const { url } = await callFn<{ url: string }>('automation-media', 'sign-view', { key });
  return url;
}
```

`probeImage` e `putWithProgress`: verifique se `postMedia.ts` os exporta (`probeImage` É exportado, L115; `putWithProgress` é privado). Importe `probeImage` de `./postMedia` e copie `putWithProgress` (com o comentário de origem) ou exporte-o de lá -- prefira exportá-lo de `postMedia.ts` (mudança de 1 linha) e importar.

- [ ] **Step 2: Store**

Em `instagramAutomations.ts`: exporte `DmMedia` (shape acima), adicione `dm_media: DmMedia | null; dm_subtitle: string | null;` em `InstagramCommentAutomation`, estenda `dm_kind` no send para `'text' | 'buttons' | 'buttons_fallback_text' | 'card' | 'card_fallback_buttons' | 'card_fallback_text' | null`, e acrescente `| 'dm_media' | 'dm_subtitle'` nas duas whitelists (create L102-116, update L133-151).

- [ ] **Step 3: Testes do form/preview que falham**

Casos (mesmos helpers/mocks do arquivo; adicione `vi.mock` de `../../../services/automationMedia` com `uploadAutomationMedia`/`deleteAutomationMedia`/`signAutomationMediaView`/`validateAutomationMediaFile` mockados; `EDITING_BASE` ganha `dm_media: null, dm_subtitle: null`):

1. `'anexar imagem troca o campo de mensagem para título com limite 80 e mostra subtítulo'` -- simule upload (fireEvent.change no input file com um `File` fake; `mockUpload.mockResolvedValue({ key: 'automation-media/w-1/x.jpg', content_type: 'image/jpeg', size_bytes: 100 })`), espere o thumbnail/nome aparecer e assert que o textarea de DM tem `maxLength = 80` e que o campo `form.subtitleLabel` existe.
2. `'submit com mídia envia dm_media e dm_subtitle; sem mídia envia null'` -- assert `mockCreate` com `expect.objectContaining({ dm_media: {...}, dm_subtitle: 'sub' })` e o caso contrário com `{ dm_media: null, dm_subtitle: null }`.
3. `'mensagem acima de 80 com mídia bloqueia o submit com toast'` -- seed via editing com `dm_message` de 100 chars, anexa mídia, submit, assert `toast.error` com `'form.validationDmWithMedia'` e `mockUpdate` não chamado.
3b. `'remover mídia persistida não apaga o objeto antes do save; apaga só após o update com sucesso'` -- abre com editing que tem `dm_media`, clica remover, assert `mockDeleteMedia` NÃO chamado ainda; submit com `mockUpdate` resolvendo, então assert `mockDeleteMedia` chamado com a mídia antiga. Variante: fechar o dialog sem salvar → `mockDeleteMedia` nunca chamado.
4. Em `DmPreview.test.tsx`: `'com mídia renderiza o cartão: imagem, título, subtítulo e botão'` -- passe as props novas (`mediaUrl="blob:x"`, `subtitle="Sub"`) e assert `screen.getByTestId('dm-preview-card')` com `<img>` e o texto.

- [ ] **Step 4: Implementar form + preview + página**

`AutomationFormDialog.tsx`:
- Estado: `dmMedia: null as DmMedia | null`, `dmMediaPreviewUrl: '' as string`, `dmSubtitle: ''`, `dmMediaUploading: false`. Seed do editing: `dmMedia: editing.dm_media ?? null`, `dmSubtitle: editing.dm_subtitle ?? ''`; se `editing.dm_media`, dispare `signAutomationMediaView(key)` num `useEffect` para preencher `dmMediaPreviewUrl` (falha silenciosa: preview sem imagem).
- Seção "Mídia da DM (opcional)" entre o textarea de DM e o editor de botões (padrão visual do editor de botões): sem mídia, `<input type="file" accept="image/jpeg,image/png,image/gif">` estilizado + help `t('form.mediaHelp')`; ao escolher arquivo, `validateAutomationMediaFile` (erro → `toast.error(t(chave))`), `URL.createObjectURL(file)` para preview imediato, `uploadAutomationMedia` com spinner.
- **Ciclo de vida da mídia (a ordem importa — o banco é detachado ANTES de qualquer trash, como manda a spec):**
  - O botão remover mexe SÓ no estado do form (`dmMedia: null`). Nunca apaga na hora um objeto que a automação salva ainda referencia: cancelar o dialog depois deixaria a automação apontando para objeto trasheado e o próximo envio cairia em fallback sem motivo.
  - Exceção segura: mídia que foi enviada NESTA sessão do dialog e ainda não salva (o banco nunca a referenciou) pode ser apagada em fire-and-forget ao remover/trocar/cancelar. Guarde `sessionUploadedKeys: string[]` no estado para distinguir.
  - Após o save com SUCESSO (create/update), compare a key persistida anterior (`editing?.dm_media?.key`) com a key salva: se mudou (troca) ou saiu (remoção), chame `deleteAutomationMedia(mediaAntiga)` em fire-and-forget com `.catch` (falha vira órfão recuperável do trash, nunca automação quebrada).
  - Exclusão da automação (`AutomacoesPage`): após `deleteInstagramAutomation(id)` resolver com sucesso, se `a.dm_media` existia, chame `deleteAutomationMedia(a.dm_media)` em fire-and-forget com `.catch`. A exceção de órfão aceito cobre SÓ formulário abandonado; troca e exclusão são fluxo normal e liberam quota.
- Com `dmMedia` presente: o label do textarea de DM vira `t('form.cardTitleLabel')`, `maxLength={80}`, contador `/80`; campo novo `t('form.subtitleLabel')` (Input, `maxLength={80}`, contador). Sem mídia: tudo como hoje.
- `submit()`: antes de `validateDmButtons`, se `form.dmMedia && form.dmMessage.trim().length > 80` → `toast.error(t('form.validationDmWithMedia'))` e return. Payload: `dm_media: form.dmMedia, dm_subtitle: form.dmMedia && form.dmSubtitle.trim() ? form.dmSubtitle.trim() : null`.
- `confirmClose`: inclua `form.dmMedia !== null`.

`DmPreview.tsx`: props novas opcionais `mediaUrl?: string | null; subtitle?: string | null`. Quando `mediaUrl` presente, renderize dentro do balão um cartão `data-testid="dm-preview-card"`: `<img src={mediaUrl} alt="" style={{ width: '100%', borderRadius: '12px 12px 0 0', display: 'block' }} />`, título (o `text`), subtítulo menor, e os botões como já são. Sem `mediaUrl`, comportamento atual intacto. Nota adicional `t('form.previewCardFallbackNote')` quando com mídia.

`AutomacoesPage.tsx`: na célula de keywords (L462-474), adicione chip `t('table.cardBadge')` quando `a.dm_media`; na linha do send (L654-661), badges para `dm_kind === 'card_fallback_buttons'` (`t('sendStatus.card_fallback_buttons')`) e `'card_fallback_text'` (`t('sendStatus.card_fallback_text')`).

i18n pt (dentro de `form`): `"mediaLabel": "Mídia da DM (opcional)"`, `"mediaHelp": "Imagem ou GIF de até 8 MB. Com mídia, a DM vira um cartão: imagem, título curto e botões."`, `"mediaRemove": "Remover mídia"`, `"mediaInvalidType": "Use uma imagem JPG, PNG ou GIF."`, `"mediaTooLarge": "A imagem precisa ter no máximo 8 MB."`, `"mediaUploadError": "Não foi possível enviar a imagem. Tente de novo."`, `"cardTitleLabel": "Título do cartão"`, `"subtitleLabel": "Subtítulo (opcional)"`, `"validationDmWithMedia": "Com mídia, o título vai até 80 caracteres. Encurte a mensagem."`, `"previewCardFallbackNote": "Se o Instagram recusar o cartão, enviamos sem a imagem, mantendo o link."`; fora de `form`: `"table": { ..., "cardBadge": "cartão" }`, `"sendStatus": { ..., "card_fallback_buttons": "enviado sem imagem", "card_fallback_text": "enviado como texto" }`. Traduza para `en` no mesmo tom (`"cardBadge": "card"`, `"card_fallback_buttons": "sent without image"` etc.). Sem travessão.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run apps/crm/src/pages/automacoes/ && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS + typecheck limpo.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/services/automationMedia.ts apps/crm/src/services/postMedia.ts apps/crm/src/store/instagramAutomations.ts apps/crm/src/pages/automacoes/ packages/i18n/locales/pt/automations.json packages/i18n/locales/en/automations.json
git commit -m "feat(automacoes): upload de mídia e modo cartão no formulário e preview"
```

---

### Task 7: Verificação final e PR

- [ ] **Step 1: Suíte completa** (idêntica à fatia 1: quatro `tsc`, `npm run test`, `npm run test:functions`, `npm run lint`, `npm run format:check`; `git checkout -- deno.lock` depois do test:functions).

- [ ] **Step 2: Rebase sobre main se o PR da fatia 1 já mergou**

```bash
git fetch origin main
git rebase origin/main
```

Resolva conflitos em `process.ts` (as duas fatias mexem em `executeSend` -- a resolução preserva AMBAS: pool de respostas públicas E cadeia do cartão), `AutomationFormDialog.tsx`, store, `automations.json`, `65_instagram_automations.sql`. Re-rode a suíte completa após o rebase.

- [ ] **Step 3: Re-verificar versão da migration** (`git ls-tree origin/main:supabase/migrations | tail -5`; renumere acima do tail se preciso).

- [ ] **Step 4: PR**

```bash
git push -u origin HEAD
gh pr create --title "feat(automacoes): cartão com imagem na DM (generic template)" --body "$(cat <<'EOF'
## Resumo
- dm_media + dm_subtitle com CHECKs (forma, bind de tenant na key, título <= 80 com mídia)
- Edge function automation-media: presign -> finalize (HEAD + quota atômica) -> trash com undo de 30 dias
- executeSend: cadeia cartão -> button template -> texto (degraus só em erro permanent); presign de leitura gerado no envio; dm_kind card/card_fallback_*
- Form com upload e modo título+subtítulo; DmPreview em cartão; chips na página

Spec: docs/superpowers/specs/2026-08-31-automacoes-dm-midia-e-variacoes-design.md
Gate: Milestone 0 (prova do generic template em staging) documentado em docs/superpowers/specs/2026-08-31-milestone0-generic-template-staging.md

## Deploy (ordem estrita; a janela mais apertada é o FRONTEND)
O CRM novo envia dm_media/dm_subtitle em TODO create/update de automação, e a Vercel shippa o frontend no instante do merge. Portanto:
1. Migration aplicada em PROD ANTES do merge (`npx supabase db push --linked`, conferindo o project-ref)
2. Functions em prod ANTES do merge: automation-media, instagram-webhook, instagram-automation-cron (`--use-api --no-verify-jwt`; automation-media faz a própria auth de JWT e precisa estar no ar antes de o frontend poder subir mídia)
3. Merge (frontend vai junto via Vercel)
4. Smoke: automação sem mídia segue com dm_kind text/buttons; depois um cartão ponta a ponta em conta real

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Reporte o link do PR e PARE (Codex review será triado pelo orquestrador).
