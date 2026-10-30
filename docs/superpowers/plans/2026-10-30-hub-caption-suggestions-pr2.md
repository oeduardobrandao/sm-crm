# PR 2: sugestões de edição nas legendas de TikTok e Geral — plano

Spec: `docs/superpowers/specs/2026-10-30-hub-captions-per-platform-design.md` (seção "PR 2"). Base:
commit `e99caf38b` (PR 1, que já entrega `targets`, `tiktok_caption` e `geral_caption` no `hub-posts`).

Três frentes independentes, cada uma no seu branch a partir de `e99caf38b`, juntadas no fim. Os
contratos abaixo são a interface entre elas; nenhuma frente muda um contrato sem avisar.

## Contratos

### Banco (frente A)

Migration `supabase/migrations/20261111000001_edit_suggestion_platform_captions.sql`.

`post_edit_suggestions` ganha `original_tiktok_caption text`, `suggested_tiktok_caption text`,
`original_geral_caption text`, `suggested_geral_caption text`, `geral_target_id bigint`,
`tiktok_followed_ig boolean`.

`changed_fields` passa a poder conter `tiktok_caption` e `geral_caption`.

```
upsert_edit_suggestion(
  p_post_id bigint, p_conta_id uuid, p_token text,
  p_suggested_conteudo jsonb, p_suggested_conteudo_plain text, p_suggested_ig_caption text,
  p_touched_fields text[] DEFAULT NULL,      -- valores: texto | legenda | legenda_tiktok | legenda_geral
  p_bases jsonb DEFAULT NULL,                -- chaves: conteudo_plain, ig_caption, tiktok_caption, geral_caption
  p_suggested_captions jsonb DEFAULT NULL    -- {"tiktok_caption": text|null, "geral_caption": text|null}
) RETURNS jsonb  -- inclui suggested_tiktok_caption e suggested_geral_caption
```
Erros novos (`P0001`): `target_gone`. Os de hoje (`base_required`, ...) seguem.

```
accept_edit_suggestion(p_suggestion_id bigint, p_expected_updated_at timestamptz DEFAULT NULL,
                       p_fields text[] DEFAULT NULL, p_acknowledged text[] DEFAULT NULL)
-- p_fields / p_acknowledged: texto | legenda | legenda_tiktok | legenda_geral
```
Erros novos (`P0001`): `target_gone`, `target_locked`. `p_fields` nulo com campo novo mudado →
`suggestion_conflict`.

`post_content_versions.geral_caption text` (`''` = linha geral com legenda vazia; nulo = sem linha
ou versão antiga).

### Edge (frente A)

`hub-edit-suggestion` POST body, além do de hoje: `suggested_tiktok_caption?: string | null`,
`suggested_geral_caption?: string | null`; `touched_fields` aceita `legenda_tiktok`/`legenda_geral`;
`bases` aceita `tiktok_caption`/`geral_caption`. Respostas novas:
- 409 `{ error, code: 'target_gone' }` (destino ausente, antes ou dentro da RPC);
- 409 `{ error, code: 'retry' }` (deadlock `40P01`);
- 400 `{ error, code: 'caption_too_long' }` (TikTok acima de `captionMaxFor`; Instagram e Geral sem
  checagem).
`pending_suggestion` na resposta (e no `hub-posts`) ganha `suggested_tiktok_caption` e
`suggested_geral_caption`.

## Frente A: banco + edge functions (um agente)

1. Migration acima, seguindo a spec PR 2 itens 1–5 à risca (ramo legado, locks, `geral_target_id`,
   `tiktok_followed_ig`, "um aceite = uma versão", trigger de `post_targets` `SECURITY DEFINER`, grants,
   DROP + CREATE do upsert).
2. SQL: `supabase/tests/entitlements/` — estender 103 (upsert) e 104 (accept), 95 (versões), re-fixar
   96 e o 104.11, mais um arquivo novo se ficar mais claro. Rodar local se o Supabase local subir
   (memória `reference_local_supabase_colima`); senão, deixar para o CI e dizer.
3. `hub-edit-suggestion/handler.ts` e `hub-posts/handler.ts` (select da sugestão pendente), com os
   testes Deno em `supabase/functions/__tests__/hub-functions_test.ts`.
4. Gates: `npm run check:functions`, `npm run test:functions`; depois `git checkout deno.lock && rm -rf
   node_modules/.deno && npm ci`.

## Frente B: Hub (um agente)

Spec PR 2 seção "Hub". Arquivos: `apps/hub/src/{types.ts,api.ts}`, `hooks/useEditSuggestion.ts`,
`lib/postView.ts`, `components/posts/{CorrectionPanel,SuggestionDiff,PostDetailDialog,PlatformCaptions}.tsx`,
`pages/MensagensPage.tsx`, `packages/i18n/locales/{pt,en}/hubPosts.json` (e `hubMessages.json` se a
chave da Mensagens morar lá), testes de cada um. Visual: mockups "Editar" e "Pendente" do artifact
https://claude.ai/artifact/1V6YTgcEqBDax4DgtZtvVc. Mapear os erros 409 `target_gone`/`retry` e 400
`caption_too_long` para mensagens no painel. Gates: lint, format, `tsc` hub, vitest hub.

## Frente C: CRM (um agente)

Spec PR 2 seção "CRM". Arquivos: `apps/crm/src/store/posts.ts`, `pages/entregas/editSuggestionFields.ts`,
`editSuggestionAccept.ts`, `components/{SuggestionReview,AcceptSuggestionDialog,PostEditorBody,
DestinationCaptionTabs,WorkflowDrawer,StandalonePostDrawer,PostVersionHistorySheet}.tsx`,
`components/postEditorPhone/PhoneSheets.tsx`, `packages/i18n/locales/{pt,en}/postEditor.json`, testes.
Visual: mockup "CRM" do artifact. Gates: lint, format, `tsc` crm, vitest crm.

## Junção

Merge dos três branches num branch do PR 2, gates completos do CLAUDE.md, verificação no browser
(Hub com fetch interceptado; CRM se houver como), revisão Codex do PR. Deploy: migration →
`hub-edit-suggestion` + `hub-posts` → merge (spec, "Deploy").
