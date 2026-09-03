# Resposta de briefing por áudio (Hub) com transcrição automática

## Contexto

Hoje o cliente responde o briefing no Hub digitando em um `<textarea>` por pergunta
(`apps/hub/src/pages/BriefingPage.tsx`), com autosave via `POST hub-briefing`.
O pedido é permitir que o cliente **grave um áudio por pergunta**; a agência recebe o
áudio **e** uma transcrição automática, que entra como texto na resposta. Assim o
export CSV/Markdown (`apps/crm/src/lib/briefingExport.ts`), o MCP `get_brand_profile`
(`supabase/functions/mcp/queries.ts:108-131`) e a skill de estratégia de conteúdo
continuam funcionando sem mudança, porque a transcrição vive em `answer`.

Decisões fechadas com o usuário:
- Áudio + transcrição automática. Um áudio por pergunta; regravar substitui.
- Transcrição **anexada ao final** do texto existente (linha em branco entre eles), nunca substitui.
- Motor: **Cloudflare Workers AI, `@cf/openai/whisper-large-v3-turbo`** (free tier 10k Neurons/dia; ~US$0,0005/min acima). Sem limite por plano.
- Armazenamento: **abordagem A**: prefixo próprio `briefing-audio/{conta_id}/{question_id}/{uuid}.{ext}` + colunas na própria `hub_briefing_questions`. Motivo: `post-media-cleanup-cron/orphan-scan.ts:61` varre `contas/` e apaga qualquer objeto >24h que não esteja em `post_media`/`files`. Fora de `contas/` o áudio não é varrido (mesmo padrão de `automation-media/`).
- Transcrição síncrona no finalize com teto de 90s; gravação limitada a 5 min / 15 MB. Falha ou worker não configurado: áudio fica salvo com status `failed` e botão "Tentar novamente".

## Fatos verificados que moldam a implementação

- `hub-briefing/handler.ts` (GET :26-97, POST :99-146) sem rotas por segmento; rate limits `hub-badtoken` 30/600, `hub-read` 300/300, `hub-write:hub-briefing` 30/3600. Padrão de segmentos a copiar: `hub-ideias/handler.ts:50-63`.
- Upload a copiar: `_shared/ideia-media.ts` (presign :38-81, finalize :110-180, `rpcErrorStatus` :103-108, regra "log raw, devolve genérico" :153-158). Client-side: `apps/hub/src/services/ideiaMedia.ts:88-100` (`putToR2` XHR PUT).
- R2: `_shared/r2.ts` `signPutUrl` :41 (assina Content-Type), `signGetUrl` :46, `headObjectSigned` :87 (variante edge-safe, usada em `automation-media/index.ts:16`), `trashObject` :108. Hub usa `signGetUrl(key, 3600)` para ideias (não media-proxy).
- Quota: RPCs `automation_media_finalize/release` em `supabase/migrations/20260901102000_ig_dm_media_card.sql:83-144` (FOR UPDATE, idempotente, tamanho lido do banco). Decremento por trigger: `20260425000002_file_system_triggers.sql:264-274`. Enfileirar exclusão R2: `post_media_enqueue_delete` em `20260411_post_media.sql:44-60` → `post_media_deletions`, drenada por `post-media-cleanup-cron/index.ts:39-57`.
- `hub_briefing_questions` não tem allowlist de colunas; RLS por `get_my_conta_id()`; `store/hub.ts:230-240` faz `select('*')`. Logo `authenticated` pode escrever qualquer coluna via PostgREST → precisa de guarda para as colunas `audio_*` (padrão `20260817000001_cliente_foto_manual_upload.sql:171-183`, gate por `auth.role() = 'service_role'`) e CHECK de prefixo por tenant (`ig_dm_media_card.sql:40-43`).
- Auth CRM→edge function: copiar `automation-media/handler.ts:45-62` (`auth.getUser` + `profiles.active_workspace_id` + `workspace_members`). `config.toml:174-175` mostra `verify_jwt = false` para funções que autenticam sozinhas.
- Client CRM chamando functions: `apps/crm/src/services/ideiaMedia.ts:19-44` (`callFn` com JWT + apikey).
- Testes: Deno mock `supabase/functions/test/shared/supabaseMock.ts` (`queue`, `queueRpc`); `__tests__/hub-briefing_test.ts:49-64` assere o corpo exato do GET (atualizar). Hub page harness: `apps/hub/src/pages/__tests__/ideiasPage.test.tsx`. Worker tests: `workers/media-proxy/src/index.test.ts`. SQL: `supabase/tests/*.sql` via `scripts/test-entitlements.sh`, helper `et_make_workspace`.
- Prefixo de migration: tail de `origin/main` é `20260906000001`. Usar `20260907000001` (reconferir com `git ls-tree origin/main:supabase/migrations | tail` ao abrir o PR).
- Whisper turbo (docs Cloudflare): input `{ audio: base64, task, language }`, output `text`, `transcription_info.duration`. Decodificação de webm/opus e mp4 (Safari) precisa de spike.

## Tarefas (ordem de execução)

### 0. Spike (30 min): Whisper com gravações reais
`wrangler dev` do worker da tarefa 6; enviar 10s de `audio/webm;codecs=opus` (Chrome) e `audio/mp4` (Safari). Confirmar texto, `transcription_info.duration`, latência de um clipe de 5 min. Resultado ajusta o teto de 90s e o allowlist.

### 1. Migration `supabase/migrations/20260907000001_briefing_audio.sql`
1. Colunas em `hub_briefing_questions`: `audio_r2_key text, audio_mime text, audio_size_bytes bigint, audio_duration_seconds int, audio_transcript text, audio_transcription_status text, audio_recorded_at timestamptz`; CHECK status `IN ('pending','done','failed')` ou null.
2. CHECK de tenant: `audio_r2_key IS NULL OR audio_r2_key LIKE 'briefing-audio/' || conta_id::text || '/%'`.
3. Trigger BEFORE INSERT/UPDATE `hub_briefing_audio_guard()` SECURITY DEFINER: se `auth.role() <> 'service_role'` e qualquer `audio_*` mudou → `RAISE 'forbidden' ERRCODE 42501`. Escritas do CRM em `question/section/answer/...` seguem iguais.
4. Trigger AFTER UPDATE OF audio_r2_key OR DELETE `hub_briefing_audio_after_change()` SECURITY DEFINER: se `OLD.audio_r2_key` não nulo e (DELETE ou chave mudou) → `INSERT post_media_deletions(r2_key)` + `UPDATE workspaces SET storage_used_bytes = GREATEST(0, storage_used_bytes - COALESCE(OLD.audio_size_bytes,0))`. **Decremento e enfileiramento só aqui**; RPCs nunca decrementam (sem dupla contagem).
5. RPC `briefing_audio_finalize(p_conta_id uuid, p_cliente_id bigint, p_question_id uuid, p_key text, p_bytes bigint, p_mime text, p_duration int) RETURNS jsonb` (`{reserved, previous_key}`): valida prefixo `briefing-audio/{conta}/{question}/` e bytes>0; `workspaces FOR UPDATE`; pergunta `FOR UPDATE` por id+conta+cliente (`question_not_found`); se `audio_r2_key = p_key` → `{reserved:false}` (retry idempotente); quota via `effective_plan_limit(p_conta_id,'storage_quota_bytes')` → `quota_exceeded` P0001; UPDATE das colunas (status `pending`, transcript null, recorded_at now()); soma bytes em `workspaces`.
6. RPC `briefing_audio_release(p_conta_id uuid, p_question_id uuid) RETURNS text`: lock workspace, zera as sete colunas; trigger faz o resto.
7. `REVOKE ... FROM PUBLIC; GRANT EXECUTE ... TO service_role` nas duas.
8. Teste SQL `supabase/tests/briefing_audio_rpcs.sql` (padrão `tests/entitlements/20_storage_rpcs.sql`): reserva; over-quota; retry mesma chave não soma; troca de chave decrementa uma vez e enfileira; release; DELETE da linha; chave de outro tenant viola CHECK; `authenticated` alterando `audio_size_bytes` → 42501 enquanto `answer` passa.

### 2. Lógica pura `supabase/functions/_shared/briefing-audio.ts` + `__tests__/briefing-audio_test.ts`
Espelhar `ideia-media.ts` (`{status, body}`, DI):
- `BRIEFING_AUDIO_MIME = [audio/webm, audio/mp4, audio/ogg, audio/mpeg, audio/wav]`, `MAX_AUDIO_BYTES = 15 MiB`, `normalizeAudioMime` (lowercase, remove `;codecs=`), `extFromAudioMime` (webm/m4a/ogg/mp3/wav).
- `presignBriefingAudio({db, conta_id, cliente_id, question_id, mime_type, size_bytes, signPutUrl})`: 415/400, posse da pergunta (404), pré-check de quota (copiar `ideia-media.ts:60-69`), devolve `{upload_url, r2_key, mime_type}` (mime normalizado que o PUT DEVE usar como Content-Type).
- `finalizeBriefingAudio({..., r2_key, mime_type, size_bytes, duration_seconds, headObject, signGetUrl, transcribe})`: prefixo (400), HEAD tamanho/content-type (400), `rpc briefing_audio_finalize` (413/404/400/500 genérico), depois `runTranscription`, devolve `{ok, answer, audio}`.
- `transcribeBriefingAudio` (retry): 404 sem áudio; se `done` não anexa de novo.
- `runTranscription` interno: `transcribe(key)` null/throw → status `failed`; sucesso → lê `answer` **do banco**, `(answer?.trim() ? answer.trimEnd()+"\n\n" : "") + text.trim()`, grava `audio_transcript`, status `done`, `audio_duration_seconds = COALESCE(atual, round(duration))`.
- `removeBriefingAudio`: posse (404), `rpc briefing_audio_release`. Sem chamada R2 (trigger enfileirou).
- `buildAudioView(row, signGetUrl)` → `{url, duration_seconds, mime, transcription_status, recorded_at} | null`.
- `makeWorkerTranscriber({url, secret, timeoutMs=90_000, fetchFn})` → função ou `null` se env ausente; POST `{key}` com Bearer e `AbortSignal.timeout`; não-2xx/texto vazio → null.
Testes: normalização de mime, cap, prefixo da chave, mismatches do HEAD, mapeamento de erros de RPC, regra do separador (answer vazio, só espaços, com texto), falha mantém áudio, retry em `done` não duplica, transcriber null sem env / em 500 / timeout.

### 3. Rotas em `hub-briefing` (`handler.ts`, `index.ts`, `__tests__/hub-briefing_test.ts`)
- Deps: `signPutUrl, signGetUrl, headObject, transcribe | null`. `index.ts` liga `headObjectSigned`, `makeWorkerTranscriber` com `TRANSCRIBE_WORKER_URL`/`TRANSCRIBE_SECRET`, e `global.fetch = makeBoundedFetch()` (como `automation-media/index.ts:13-18`).
- Segmentos (copiar `hub-ideias`): `POST /upload-url`, `POST /{id}/audio`, `POST /{id}/audio/transcribe`, `DELETE /{id}/audio` (token via query no DELETE). O `POST /hub-briefing` sem segmento fica idêntico.
- Rate limit novo `hub-write:hub-briefing-audio:{conta}:{cliente}` 20/3600 nas quatro rotas.
- GET: select com as sete colunas, cada pergunta ganha `audio: buildAudioView(...)` (`signGetUrl(key, 3600)` só quando há chave). Atualizar asserção exata em `hub-briefing_test.ts:49-64` (`audio: null`) e adicionar caso com áudio.
- Testes: happy path de cada rota, 404 pergunta alheia, 429 chave de áudio, 413, finalize com `transcribe: null` → `failed` mantendo `audio`.

### 4. Hub client (`types.ts`, `api.ts`, `services/briefingAudio.ts`, `services/ideiaMedia.ts`)
- `BriefingAudio {url, duration_seconds, mime, transcription_status, recorded_at}`; `BriefingQuestion.audio: BriefingAudio | null`.
- `api.ts`: `presignBriefingAudio`, `finalizeBriefingAudio`, `retryBriefingTranscription`, `deleteBriefingAudio` (rota aninhada como `deleteIdeiaImage` :227-237).
- `ideiaMedia.ts`: `putToR2(url, body: Blob, contentType)` exportado; atualizar os dois call sites (:126-127) passando `file.type`.
- `briefingAudio.ts`: `validateBriefingAudio(blob, mime)` (mensagens em PT), `uploadBriefingAudio({token, questionId, blob, mime, durationSeconds, onPhase})`: presign → PUT com o mime normalizado → finalize.
- Vitest: `apps/hub/src/__tests__/api.test.ts` (quatro wrappers) e `services/__tests__/briefingAudio.test.ts` (XHR stub; Content-Type e payload do finalize).

### 5. Hub UI (`components/AudioRecorder.tsx`, `BriefingPage.tsx`)
- `AudioRecorder` props `{disabled?, onRecorded(blob, mime, durationSeconds), phase: 'idle'|'uploading'|'transcribing', error}`. Gate: sem `navigator.mediaDevices?.getUserMedia` ou `!window.isSecureContext` → não renderiza. Mime via `MediaRecorder.isTypeSupported` na ordem `audio/webm;codecs=opus` → `audio/mp4` → `audio/ogg;codecs=opus`. Timer é a fonte de `durationSeconds` (webm não carrega duração). Parada forçada aos 300s, aviso a partir de 270s. Estados idle → recording → preview (`<audio>` local via objectURL, Enviar / Descartar) → uploading/transcribing (dirigidos pelo pai). Liberar tracks e revogar objectURLs no stop/unmount. Estilo: `hub-btn-primary`/`hub-btn-secondary` + `rounded-[var(--hub-r-ctl)]`, `hub-tx3` no timer, `text-xs text-red-500` em erros; sem `hover:`/`md:` em classes `hub-*`. Copy em PT, sem travessão.
- `QuestionItem`: textarea `disabled` e debounce cancelado enquanto `phase !== 'idle'`; ao finalizar `setAnswer(res.answer)` + invalidar `['hub-briefing', token]`; erros de salvamento de texto e de áudio passam a aparecer inline (hoje :154-155 engole). Com áudio: `<audio controls preload="none">`, duração `m:ss`, linha de status (`Transcrição pendente` / `Transcrição concluída` / `Não foi possível transcrever` + `Tentar novamente`), botões `Regravar` e `Remover`.
- Testes: `components/__tests__/AudioRecorder.test.tsx` (fake `MediaRecorder` + `getUserMedia` stub; oculto em contexto inseguro); `pages/__tests__/briefingPage.test.tsx` no harness de `ideiasPage.test.tsx` (textarea travada durante upload, atualizada pela resposta do finalize, erros visíveis).

### 6. Worker `workers/transcribe/` (scaffold copiado de `workers/media-proxy`)
- `wrangler.toml`: `name = "transcribe"`, `[ai] binding = "AI"`, `[[r2_buckets]] MEDIA_BUCKET` bucket `mesaas`; secret `TRANSCRIBE_SECRET` via `wrangler secret put`. Sem CORS (server-to-server).
- `src/index.ts`: só `POST /`; Bearer com comparação timing-safe (copiar `verifySignature` do media-proxy :22-32); body `{key}` com `startsWith("briefing-audio/")` e sem `..` (400); `MEDIA_BUCKET.get(key)` (404; 413 se >15 MiB); base64 em chunks; `env.AI.run("@cf/openai/whisper-large-v3-turbo", {audio, language:"pt", task:"transcribe"})`; devolve `{text, duration}`; 502 genérico em falha. Exportar `transcribe(request, env)` para injetar `AI.run` e bucket nos testes.
- `src/index.test.ts`: 401, 400 prefixo, 404, 413, 200, 502.
- Workers não rodam no CI; documentar `npm test` dentro da pasta.

### 7. CRM: edge function `briefing-audio` + store/serviço/HubTab
- `supabase/functions/briefing-audio/{index.ts, handler.ts}` + `__tests__/briefing-audio_test.ts`: `GET ?question_id=`; auth copiada de `automation-media/handler.ts:45-62`; carrega pergunta por `id + conta_id` (404 sem áudio); devolve `{url: signGetUrl(key, 3600), duration_seconds, mime, transcription_status}`. `config.toml`: `[functions.briefing-audio] verify_jwt = false`. Testes: 401, 403, 404, 200.
- `apps/crm/src/store/hub.ts:36-46`: sete campos `audio_*` opcionais em `HubBriefingQuestionRow` (select já é `*`).
- `apps/crm/src/services/briefingAudio.ts`: `fetchBriefingAudioUrl(questionId)` no padrão `callFn` de `services/ideiaMedia.ts:19-44`.
- `HubTab.tsx:1238-1247`: `<BriefingAudioPlayer question={q} />` quando `q.audio_r2_key`; `useQuery(['briefing-audio-url', q.id], staleTime 50 min)`, `<audio controls preload="none">`, duração e `Badge` de status (`Transcrito` / `Transcrição pendente` / `Falha na transcrição`). `briefingExport.ts` e `mcp/queries.ts` não mudam.

### 8. Docs e rollout
- `CLAUDE.md` env vars: `TRANSCRIBE_WORKER_URL`, `TRANSCRIBE_SECRET` (opcionais; sem elas o áudio salva e a transcrição fica `failed`). `README.md`: linha de `workers/transcribe/` e nota de deploy manual.
- Ordem de deploy (Vercel publica o frontend no merge, então banco e functions vão antes): 1) `npx supabase db push --linked`; 2) `wrangler deploy` em `workers/transcribe` + `wrangler secret put TRANSCRIBE_SECRET`; 3) secrets `TRANSCRIBE_WORKER_URL`/`TRANSCRIBE_SECRET` no Supabase; 4) `npx supabase functions deploy hub-briefing --no-verify-jwt` e `briefing-audio --no-verify-jwt`; 5) merge. Contratos GET/POST antigos são aditivos, bundles antigos do Hub seguem funcionando.

## Riscos e pontos em aberto
1. Orçamento 20/3600 na chave de áudio = 10 gravações/hora por cliente (presign + finalize). Subir para 40 se apertar.
2. Uploads abandonados (PUT sem finalize) em `briefing-audio/` nunca são varridos (o scan só olha `contas/`). Aceitável na v1; follow-up: scan de `briefing-audio/` contra `hub_briefing_questions.audio_r2_key`.
3. Transcrição síncrona de 5 min dentro de 90s e do wall clock da edge function: o spike mede. Fallback `failed` + retry já previsto.
4. Guarda por `auth.role()` exige `ALTER TABLE ... DISABLE TRIGGER` em backfills manuais das colunas `audio_*`.
5. `makeBoundedFetch()` passa a impor 20s também ao GET/POST atuais do `hub-briefing` (endurecimento; registrar no PR).

## Verificação
```
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json --noEmit
npm run lint
npm run format:check
npm run test
npm run test:functions
npm run test:db                      # precisa de Supabase local; CI cobre supabase/tests/*.sql
(cd workers/transcribe && npm ci && npm run typecheck && npm test)
```
Manual no browser (Hub em `npm run dev:hub:staging`, Chrome e Safari): gravar, ouvir prévia, enviar, ver textarea travada e transcrição anexada; regravar substitui; remover limpa; negar permissão mostra mensagem. CRM: `HubTab` mostra player e badge. Conferir `workspaces.storage_used_bytes` sobe/desce e `post_media_deletions` recebe a chave antiga.
