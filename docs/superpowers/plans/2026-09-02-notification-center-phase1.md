# Central de Notificações — Fase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar `/configuracao/notificacoes` na Central de Notificações: catálogo completo dos 22 tipos com preferências in-app por tipo (novas), preferências de e-mail existentes (+ `post_approved` como 9º tipo do digest), transparência dos e-mails transacionais e a matriz "Seus clientes" (relatório mensal). Inclui o fix P0 de RLS em `notifications`.

**Architecture:** Duas tabelas de preferência fisicamente separadas (`notification_email_prefs` intocada em estrutura; `notification_inapp_prefs` nova) porque o bundle antigo do CRM upserta a primeira com `onConflict: 'user_id,type'` e ela tem PK `(user_id, type)` — qualquer mudança de chave quebra clientes com chunk stale. Mute in-app é filtro de LEITURA (triggers intocados, histórico preservado). Catálogo único (`notification-catalog.ts`) alimenta a central; o popover do sino continua no `notification-config.ts`.

**Tech Stack:** React 19 + TanStack Query + shadcn/Tailwind (CRM), Supabase Postgres + RLS, edge functions Deno, Vitest + deno test + psql entitlement suites.

**Spec:** `docs/superpowers/specs/2026-09-02-notification-center-design.md` (Fase 1). A Fase 2 (Pendências do Hub) tem plano próprio depois deste PR mergear.

## Global Constraints

- Copy PT-BR; **NUNCA em-dash em copy de usuário** (usar ponto/dois-pontos/`·`).
- Toasts via `toast()` de `sonner`; ícones só `lucide-react`.
- `notifications.id` é **uuid** (string) — nunca ordenar/assertar por "id desc".
- Papéis via `AuthContext` (`owner | admin | agent`); nunca hardcode.
- Migration nova DEVE ter prefixo único acima do tail de `origin/main` (hoje: `20260902000021`). Usar `20260903000001`. Re-verificar com `git ls-tree origin/main:supabase/migrations --name-only | tail -3` antes de abrir o PR e renumerar se main andou.
- `REVOKE ... FROM PUBLIC` sempre seguido de `GRANT ... TO service_role` explícito.
- Antes do push: `npm run lint`, `npm run format:check`, os 4 `tsc` (crm, hub, admin, scripts), `npm run test`, `npm run test:functions`.
- Rodar tudo DESTE worktree: `/Users/eduardosouza/Projects/sm-crm/.claude/worktrees/notification-center-960dfc`. Confirmar com `pwd` + `git branch --show-current` (deve ser `claude/notification-center-960dfc`) antes de editar.
- `npm run test:functions` suja o `deno.lock` da raiz — `git checkout deno.lock` depois, se modificado.

---

### Task 1: Migration — inapp prefs, 9º tipo no digest, RLS P0 de notifications

**Files:**
- Create: `supabase/migrations/20260903000001_notification_center_phase1.sql`

**Interfaces:**
- Consumes: tabelas `notification_email_prefs` (20260813000004), `notifications` + policies (20260430000001), RPC `claim_notification_emails` (20260813000005), `workspace_members`.
- Produces: tabela `notification_inapp_prefs (user_id uuid, type text, enabled boolean, updated_at timestamptz, PK (user_id,type))`; CHECK da email prefs aceitando `post_approved`; claim RPC com 9 tipos; policies `notifications_select`/`notifications_update` exigindo vínculo vigente.

- [ ] **Step 1: Escrever a migration**

```sql
-- 20260903000001_notification_center_phase1.sql
-- Central de Notificações, Fase 1 (spec 2026-09-02).
-- (a) notification_inapp_prefs: preferências in-app por tipo. Tabela SEPARADA da
--     notification_email_prefs de propósito: o bundle antigo do CRM upserta aquela
--     com onConflict user_id,type (PK atual) e faz SELECT sem filtro de canal —
--     qualquer mudança de chave ou mistura de linhas quebra chunks stale.
-- (b) post_approved vira o 9º tipo elegível do digest de e-mail.
-- (c) P0: policies de notifications passavam com user_id = auth.uid() apenas;
--     ex-membro removido continuava lendo notificações antigas do workspace.

-- ---------- (a) notification_inapp_prefs --------------------------------
create table if not exists notification_inapp_prefs (
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null,
  enabled    boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, type),
  constraint notification_inapp_prefs_type_check check (type in (
    'post_approved','post_correction','post_message','post_edit_suggestion',
    'idea_submitted','briefing_answered','step_activated','step_completed',
    'post_assigned','task_assigned','workflow_completed','deadline_approaching',
    'invite_accepted','member_role_changed','member_removed','client_message',
    'mention','post_status_automation','instagram_connected_by_client',
    'post_publish_failed','storage_autoclean_report','instagram_automation_failed',
    '__all__'
  ))
);

alter table notification_inapp_prefs enable row level security;

drop policy if exists nip_select on notification_inapp_prefs;
create policy nip_select on notification_inapp_prefs
  for select using (user_id = auth.uid());
drop policy if exists nip_insert on notification_inapp_prefs;
create policy nip_insert on notification_inapp_prefs
  for insert with check (user_id = auth.uid());
drop policy if exists nip_update on notification_inapp_prefs;
create policy nip_update on notification_inapp_prefs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists nip_delete on notification_inapp_prefs;
create policy nip_delete on notification_inapp_prefs
  for delete using (user_id = auth.uid());

-- Mesmo racional da irmã (20260813000004): RLS é o gate, sem coluna de
-- escalação de privilégio, então grant pleno a authenticated é correto.
grant select, insert, update, delete on notification_inapp_prefs to authenticated;

-- ---------- (b) post_approved elegível a e-mail -------------------------
alter table notification_email_prefs
  drop constraint notification_email_prefs_type_check;
alter table notification_email_prefs
  add constraint notification_email_prefs_type_check check (type in (
    'post_approved','post_publish_failed','post_correction','post_message',
    'client_message','deadline_approaching','task_assigned','post_assigned',
    'mention','__all__'
  ));

-- Recria o claim com post_approved na lista (única mudança vs 20260813000005).
create or replace function claim_notification_emails(
  p_settle_before timestamptz,
  p_after         timestamptz,
  p_limit         int
)
returns table (id uuid, user_id uuid, type text, metadata jsonb, link text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  update notifications n
     set emailed_at = now()
   where n.id in (
     select n2.id from notifications n2
     where n2.type = any (array[
       'post_approved','post_publish_failed','post_correction','post_message',
       'client_message','deadline_approaching','task_assigned','post_assigned',
       'mention'
     ])
       and n2.read_at is null and n2.dismissed_at is null and n2.emailed_at is null
       and n2.created_at <= p_settle_before and n2.created_at >= p_after
       and exists (
         select 1 from workspace_members wm
         where wm.workspace_id = n2.workspace_id and wm.user_id = n2.user_id
       )
       and not exists (
         select 1 from notification_email_prefs p
         where p.user_id = n2.user_id and p.enabled = false
           and (p.type = n2.type or p.type = '__all__')
       )
     order by n2.created_at asc
     limit p_limit
     for update skip locked
   )
  returning n.id, n.user_id, n.type, n.metadata, n.link, n.created_at;
$$;

-- REVOKE FROM PUBLIC também derruba service_role nesta instância — re-grant.
revoke all on function claim_notification_emails(timestamptz, timestamptz, int)
  from public, anon, authenticated;
grant execute on function claim_notification_emails(timestamptz, timestamptz, int)
  to service_role;

-- ---------- (c) P0: vínculo vigente nas policies de notifications -------
drop policy if exists notifications_select on notifications;
create policy notifications_select on notifications
  for select using (
    user_id = auth.uid()
    and exists (
      select 1 from workspace_members wm
      where wm.workspace_id = notifications.workspace_id
        and wm.user_id = auth.uid()
    )
  );

drop policy if exists notifications_update on notifications;
create policy notifications_update on notifications
  for update using (
    user_id = auth.uid()
    and exists (
      select 1 from workspace_members wm
      where wm.workspace_id = notifications.workspace_id
        and wm.user_id = auth.uid()
    )
  ) with check (
    user_id = auth.uid()
    and exists (
      select 1 from workspace_members wm
      where wm.workspace_id = notifications.workspace_id
        and wm.user_id = auth.uid()
    )
  );
```

- [ ] **Step 2: Sanity-check local se houver Docker/colima**

Run: `npx supabase db start 2>/dev/null && npx supabase db reset 2>/dev/null | tail -3` — se colima/Docker não estiver disponível, PULAR sem falhar (o CI `entitlement-tests` aplica todas as migrations e roda as suites; a Task 2 cobre o comportamento).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260903000001_notification_center_phase1.sql
git commit -m "feat(notificacoes): migration da central (inapp prefs, 9º tipo no digest, RLS vigente em notifications)"
```

---

### Task 2: Suite psql de entitlements

**Files:**
- Create: `supabase/tests/entitlements/73_notification_center.sql`

**Interfaces:**
- Consumes: migration da Task 1; harness/convenções de `supabase/tests/entitlements/_helpers.sql` e das suites 60-62 (ler antes de escrever — setup de usuários/workspaces e o padrão de `raise exception` em falha é copiado de lá).
- Produces: cobertura CI dos comportamentos: membro removido bloqueado, RLS da inapp prefs, claim com `post_approved`, independência entre tabelas de prefs.

- [ ] **Step 1: Ler `_helpers.sql` e a suite `62_*.sql` para copiar o harness** (criação de auth.users de teste, workspaces, set de `request.jwt.claims`, padrão de assert).

- [ ] **Step 2: Escrever a suite com estes casos (adaptar o boilerplate do harness; a lógica dos asserts é esta, verbatim):**

```sql
-- 73_notification_center.sql — Central de Notificações, Fase 1.
-- Caso 1 (P0): membro removido não lê nem atualiza notifications.
--   setup: user A membro do workspace W; inserir notification para A em W
--   (insert via service role/postgres, como as suites irmãs fazem);
--   como A: select conta 1; update read_at funciona.
--   remover A de workspace_members;
--   como A: select conta 0; update de read_at afeta 0 linhas.
do $$ begin
  -- (harness) ... como user A após remoção:
  if (select count(*) from notifications) <> 0 then
    raise exception 'P0: ex-membro ainda lê notifications';
  end if;
end $$;

-- Caso 2: RLS de notification_inapp_prefs.
--   como A: insert (A, 'mention', false) OK; select vê 1 linha.
--   como B: select vê 0 linhas; insert com user_id = A falha (WITH CHECK).

-- Caso 3: claim_notification_emails inclui post_approved.
--   inserir notification type 'post_approved' não lida para membro ativo;
--   select * from claim_notification_emails(now(), now() - interval '1 day', 10)
--   (como postgres) retorna a linha; rodar de novo retorna 0 (emailed_at set).

-- Caso 4: independência das tabelas de prefs.
--   inserir em notification_inapp_prefs (A, 'post_approved', false);
--   nova notification post_approved para A; claim AINDA retorna a linha
--   (mute in-app não silencia e-mail);
--   inserir em notification_email_prefs (A, 'post_approved', false);
--   nova notification; claim agora NÃO retorna essa linha.

-- Caso 5: ACL — anon/authenticated não executam claim_notification_emails
--   (has_function_privilege(...) = false), service_role executa.
```

- [ ] **Step 3: Rodar localmente se houver Docker** (`bash scripts/test-entitlements.sh` ou o runner que as suites usam — conferir no script); sem Docker, validar sintaxe com leitura cuidadosa e deixar o CI `entitlement-tests` como gate.

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/entitlements/73_notification_center.sql
git commit -m "test(notificacoes): suite de entitlements da central (P0 vínculo, inapp prefs, claim 9 tipos)"
```

---

### Task 3: Catálogo de notificações + teste de exaustividade

**Files:**
- Create: `apps/crm/src/lib/notification-catalog.ts`
- Test: `apps/crm/src/__tests__/notification-catalog.test.ts`

**Interfaces:**
- Consumes: `NotificationType` de `@/store/notifications` (union de 22).
- Produces:
```ts
export type NotificationCategory =
  | 'aprovacoes_hub' | 'entregas_fluxo' | 'equipe' | 'integracoes' | 'sistema';
export const CATEGORY_LABELS: Record<NotificationCategory, string>;
export const CATEGORY_ORDER: NotificationCategory[];
export interface NotificationCatalogEntry {
  category: NotificationCategory;
  label: string;       // nome curto da linha
  when: string;        // frase após "Quando: "
  recipients: string;  // frase após "Quem recebe: "
  emailEligible: boolean; // true nos 9 tipos do digest
}
export const NOTIFICATION_CATALOG: Record<NotificationType, NotificationCatalogEntry>;
```

- [ ] **Step 1: Escrever o teste que falha**

```ts
// apps/crm/src/__tests__/notification-catalog.test.ts
import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_CATALOG, CATEGORY_ORDER, CATEGORY_LABELS,
} from '@/lib/notification-catalog';
import { EMAIL_NOTIFICATION_TYPES } from '@/store/notificationPrefs';

describe('notification-catalog', () => {
  it('cobre exatamente os 22 tipos', () => {
    expect(Object.keys(NOTIFICATION_CATALOG)).toHaveLength(22);
  });
  it('todo tipo elegível a e-mail está marcado emailEligible', () => {
    for (const t of EMAIL_NOTIFICATION_TYPES.map((e) => e.type)) {
      expect(NOTIFICATION_CATALOG[t].emailEligible).toBe(true);
    }
    const eligible = Object.values(NOTIFICATION_CATALOG).filter((e) => e.emailEligible);
    expect(eligible).toHaveLength(9);
  });
  it('toda categoria usada existe em ORDER e LABELS', () => {
    for (const e of Object.values(NOTIFICATION_CATALOG)) {
      expect(CATEGORY_ORDER).toContain(e.category);
      expect(CATEGORY_LABELS[e.category]).toBeTruthy();
    }
  });
  it('copy sem em-dash', () => {
    for (const e of Object.values(NOTIFICATION_CATALOG)) {
      expect(e.when).not.toMatch(/—/);
      expect(e.recipients).not.toMatch(/—/);
    }
  });
});
```

(Este teste só passa por completo após a Task 4 adicionar `post_approved` aos
`EMAIL_NOTIFICATION_TYPES`; até lá o assert de 9 elegíveis falha — ordem correta:
escrever catálogo com 9 `emailEligible: true` já nesta task.)

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run apps/crm/src/__tests__/notification-catalog.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 3: Implementar o catálogo completo** (Record com `satisfies` para o compilador garantir exaustividade). Conteúdo integral — copy validada com o usuário no mockup; "Quem recebe" vem dos triggers reais:

```ts
import type { NotificationType } from '@/store/notifications';

export type NotificationCategory =
  | 'aprovacoes_hub' | 'entregas_fluxo' | 'equipe' | 'integracoes' | 'sistema';

export const CATEGORY_ORDER: NotificationCategory[] = [
  'aprovacoes_hub', 'entregas_fluxo', 'equipe', 'integracoes', 'sistema',
];

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  aprovacoes_hub: 'Aprovações e Hub',
  entregas_fluxo: 'Entregas e fluxo',
  equipe: 'Equipe',
  integracoes: 'Integrações',
  sistema: 'Sistema',
};

export interface NotificationCatalogEntry {
  category: NotificationCategory;
  label: string;
  when: string;
  recipients: string;
  emailEligible: boolean;
}

const RESP_ADMINS = 'responsável pelo item + donos e admins';
const ADMINS = 'donos e admins';

export const NOTIFICATION_CATALOG = {
  post_approved: { category: 'aprovacoes_hub', label: 'Post aprovado pelo cliente',
    when: 'o cliente aprova um post no Hub', recipients: RESP_ADMINS, emailEligible: true },
  post_correction: { category: 'aprovacoes_hub', label: 'Correção solicitada',
    when: 'o cliente pede correção em um post', recipients: RESP_ADMINS, emailEligible: true },
  post_message: { category: 'aprovacoes_hub', label: 'Mensagem em um post',
    when: 'o cliente comenta em um post específico', recipients: RESP_ADMINS, emailEligible: true },
  post_edit_suggestion: { category: 'aprovacoes_hub', label: 'Sugestão de edição',
    when: 'o cliente sugere uma alteração de legenda no Hub', recipients: RESP_ADMINS, emailEligible: false },
  idea_submitted: { category: 'aprovacoes_hub', label: 'Ideia enviada',
    when: 'o cliente envia uma ideia ou solicitação', recipients: ADMINS, emailEligible: false },
  briefing_answered: { category: 'aprovacoes_hub', label: 'Briefing respondido',
    when: 'o cliente responde uma pergunta do briefing', recipients: ADMINS, emailEligible: false },
  client_message: { category: 'aprovacoes_hub', label: 'Mensagem do cliente',
    when: 'o cliente escreve no feed de mensagens', recipients: ADMINS, emailEligible: true },
  step_activated: { category: 'entregas_fluxo', label: 'Etapa ativada',
    when: 'uma etapa do fluxo fica ativa', recipients: RESP_ADMINS, emailEligible: false },
  step_completed: { category: 'entregas_fluxo', label: 'Etapa concluída',
    when: 'uma etapa do fluxo é concluída', recipients: ADMINS, emailEligible: false },
  post_assigned: { category: 'entregas_fluxo', label: 'Post atribuído a você',
    when: 'um post é atribuído a você', recipients: 'somente quem foi atribuído', emailEligible: true },
  task_assigned: { category: 'entregas_fluxo', label: 'Tarefa atribuída a você',
    when: 'uma tarefa é criada para você ou reatribuída', recipients: 'somente quem foi atribuído', emailEligible: true },
  workflow_completed: { category: 'entregas_fluxo', label: 'Fluxo concluído',
    when: 'um fluxo inteiro é concluído', recipients: ADMINS, emailEligible: false },
  deadline_approaching: { category: 'entregas_fluxo', label: 'Prazo se aproximando',
    when: 'uma etapa ativa vence amanhã', recipients: RESP_ADMINS, emailEligible: true },
  post_status_automation: { category: 'entregas_fluxo', label: 'Automação de status',
    when: 'uma regra sua de status dispara uma notificação', recipients: 'conforme a regra configurada', emailEligible: false },
  invite_accepted: { category: 'equipe', label: 'Convite aceito',
    when: 'alguém entra no workspace', recipients: ADMINS, emailEligible: false },
  member_role_changed: { category: 'equipe', label: 'Papel alterado',
    when: 'o papel de um membro muda', recipients: ADMINS, emailEligible: false },
  member_removed: { category: 'equipe', label: 'Membro removido',
    when: 'um membro é removido do workspace', recipients: ADMINS, emailEligible: false },
  mention: { category: 'equipe', label: 'Menções',
    when: 'alguém menciona você com @', recipients: 'somente quem foi mencionado', emailEligible: true },
  instagram_connected_by_client: { category: 'integracoes', label: 'Instagram conectado',
    when: 'o cliente conclui a conexão pelo link que você enviou', recipients: 'quem criou o link', emailEligible: false },
  post_publish_failed: { category: 'integracoes', label: 'Falha na publicação',
    when: 'um post agendado falha ao publicar', recipients: RESP_ADMINS, emailEligible: true },
  instagram_automation_failed: { category: 'integracoes', label: 'Automação do Instagram com problema',
    when: 'uma automação de comentário para DM para de funcionar', recipients: ADMINS, emailEligible: false },
  storage_autoclean_report: { category: 'sistema', label: 'Limpeza de armazenamento',
    when: 'a limpeza noturna remove arquivos antigos', recipients: ADMINS, emailEligible: false },
} satisfies Record<NotificationType, NotificationCatalogEntry>;
```

- [ ] **Step 4: Rodar o teste** — os 3 primeiros asserts passam; o de 9 elegíveis via `EMAIL_NOTIFICATION_TYPES` ainda falha (8 no store). Aceitável: marcar e seguir para a Task 4, que o faz passar. NÃO commitar com teste vermelho: Tasks 3 e 4 commitam JUNTAS ao fim da Task 4.

---

### Task 4: Store de prefs — 9º tipo de e-mail + funções in-app

**Files:**
- Modify: `apps/crm/src/store/notificationPrefs.ts`
- Test: `apps/crm/src/__tests__/notification-prefs-store.test.ts` (novo)

**Interfaces:**
- Consumes: tabela `notification_inapp_prefs` (Task 1); `supabase`/`getUserId` de `./core`.
- Produces (a Task 5 e as UI tasks dependem destes nomes):
```ts
export type NotificationEmailType = /* union atual */ | 'post_approved';
export const EMAIL_NOTIFICATION_TYPES: {...}[] // 9 itens, post_approved por último
export async function getNotificationInappPrefs(): Promise<Record<string, boolean>>
export async function setNotificationInappPref(
  type: NotificationType | typeof MASTER_PAUSE_TYPE, enabled: boolean): Promise<void>
export function mutedInappTypes(prefs: Record<string, boolean>): string[] | 'all'
  // 'all' quando prefs['__all__'] === false; senão a lista dos types com false
```

- [ ] **Step 1: Escrever testes que falham** (mock de supabase no padrão do `useNotifications.test.tsx` — ler o mock de lá e reutilizar o shape):

```ts
import { describe, expect, it } from 'vitest';
import {
  EMAIL_NOTIFICATION_TYPES, mutedInappTypes,
} from '@/store/notificationPrefs';

describe('notificationPrefs', () => {
  it('tem 9 tipos de e-mail com post_approved por último', () => {
    expect(EMAIL_NOTIFICATION_TYPES).toHaveLength(9);
    expect(EMAIL_NOTIFICATION_TYPES.at(-1)?.type).toBe('post_approved');
  });
  it('mutedInappTypes: __all__ false vence tudo', () => {
    expect(mutedInappTypes({ __all__: false, mention: true })).toBe('all');
  });
  it('mutedInappTypes lista só os desligados', () => {
    expect(mutedInappTypes({ mention: false, idea_submitted: true })).toEqual(['mention']);
  });
  it('mutedInappTypes vazio sem overrides', () => {
    expect(mutedInappTypes({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run apps/crm/src/__tests__/notification-prefs-store.test.ts`.

- [ ] **Step 3: Implementar.** Em `notificationPrefs.ts`: (a) adicionar `| 'post_approved'` ao union `NotificationEmailType`; (b) append ao array (por último, é "boa notícia"):

```ts
  {
    type: 'post_approved',
    label: 'Post aprovado pelo cliente',
    description: 'Quando um cliente aprova um post no Hub.',
  },
```

(c) novas funções, espelhando as de e-mail com a tabela nova:

```ts
import type { NotificationType } from './notifications';

export async function getNotificationInappPrefs(): Promise<Record<string, boolean>> {
  const { data, error } = await supabase.from('notification_inapp_prefs').select('type, enabled');
  if (error) throw error;
  const map: Record<string, boolean> = {};
  for (const row of data ?? []) map[row.type as string] = row.enabled as boolean;
  return map;
}

export async function setNotificationInappPref(
  type: NotificationType | typeof MASTER_PAUSE_TYPE,
  enabled: boolean,
): Promise<void> {
  const user_id = await getUserId();
  const { error } = await supabase
    .from('notification_inapp_prefs')
    .upsert(
      { user_id, type, enabled, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,type' },
    );
  if (error) throw error;
}

/** 'all' quando o master pause está ativo; senão os types explicitamente off. */
export function mutedInappTypes(prefs: Record<string, boolean>): string[] | 'all' {
  if (prefs[MASTER_PAUSE_TYPE] === false) return 'all';
  return Object.entries(prefs)
    .filter(([t, on]) => !on && t !== MASTER_PAUSE_TYPE)
    .map(([t]) => t);
}
```

- [ ] **Step 4: Rodar os testes das Tasks 3 e 4** — ambos PASS. Também `npx vitest run apps/crm/src/pages/configuracao/__tests__/NotificacoesTab.test.tsx`: se o teste antigo fixar "8 tipos", atualizar o número para 9 (a reescrita da tab vem na Task 7; aqui só o que quebrar por contagem).

- [ ] **Step 5: Commit (Tasks 3+4 juntas)**

```bash
git add apps/crm/src/lib/notification-catalog.ts apps/crm/src/__tests__/notification-catalog.test.ts \
  apps/crm/src/store/notificationPrefs.ts apps/crm/src/__tests__/notification-prefs-store.test.ts \
  apps/crm/src/pages/configuracao/__tests__/NotificacoesTab.test.tsx
git commit -m "feat(notificacoes): catálogo dos 22 tipos + prefs in-app no store + post_approved elegível a e-mail"
```

---

### Task 5: Filtro de leitura no sino (store + hook)

**Files:**
- Modify: `apps/crm/src/store/notifications.ts`
- Modify: `apps/crm/src/hooks/useNotifications.ts`
- Test: `apps/crm/src/hooks/__tests__/useNotifications.test.tsx` (existente, estender)

**Interfaces:**
- Consumes: `getNotificationInappPrefs` + `mutedInappTypes` (Task 4).
- Produces: assinaturas novas (retrocompatíveis por default):
```ts
getNotifications(limit = 50, offset = 0, excludeTypes: string[] = [])
getUnreadNotificationCount(excludeTypes: string[] = [])
markAllNotificationsAsRead(excludeTypes: string[] = [])
```
O hook `useNotifications` mantém a mesma API externa (`notifications, unreadCount, isLoading, markAsRead, markAllAsRead, dismiss`).

- [ ] **Step 1: Estender o teste do hook com os casos novos** (seguir o harness de mock existente no arquivo):

```ts
// casos a adicionar em useNotifications.test.tsx:
// 1. com pref { mention: false }: a query de lista chama .not('type','in','("mention")')
//    e o unread count também (inspecionar o mock do query builder).
// 2. com pref { __all__: false }: lista = [] e unreadCount = 0 SEM chamar o
//    builder de notifications (queries desabilitadas), e markAllAsRead é no-op
//    (mutationFn não toca o builder).
// 3. prefs query com erro: comporta como hoje (sem filtro) — fail-open.
// 4. markAllAsRead com { mention: false }: o update recebe .not('type','in','("mention")').
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar no store** — helper + parâmetro em 3 funções:

```ts
function withoutTypes<T>(query: T, excludeTypes: string[]): T {
  if (!excludeTypes.length) return query;
  const list = `(${excludeTypes.map((t) => `"${t}"`).join(',')})`;
  // @ts-expect-error postgrest builder chain
  return query.not('type', 'in', list);
}
```

Aplicar em `getNotifications` (antes do `.order`), `getUnreadNotificationCount` e
`markAllNotificationsAsRead` (antes do `.is('read_at', null)` funciona em qualquer
posição da chain). Assinaturas conforme Interfaces.

- [ ] **Step 4: Implementar no hook.** Nova query de prefs + gating:

```ts
const PREFS_KEY = ['notification-inapp-prefs'] as const;
const prefsQuery = useQuery({
  queryKey: PREFS_KEY,
  queryFn: getNotificationInappPrefs,
  staleTime: 5 * 60_000,
  retry: 1,
});
// fail-open: erro nas prefs = sem filtro (nunca esconder por engano)
const muted = prefsQuery.isError ? [] : mutedInappTypes(prefsQuery.data ?? {});
const masterPaused = muted === 'all';
const excludeTypes = masterPaused ? [] : (muted as string[]);
const prefsReady = prefsQuery.isSuccess || prefsQuery.isError;
```

- `unreadQuery`: `queryKey: [...UNREAD_KEY, excludeTypes]`, `enabled: prefsReady && !masterPaused`, `queryFn: () => getUnreadNotificationCount(excludeTypes)`.
- `listQuery`: `queryKey: [...LIST_KEY, excludeTypes]`, `enabled: popoverOpen && prefsReady && !masterPaused`, `queryFn: () => getNotifications(50, 0, excludeTypes)`.
- Retornos: `notifications: masterPaused ? [] : (listQuery.data ?? [])`, `unreadCount: masterPaused ? 0 : (unreadQuery.data ?? 0)`.
- `markAllAsRead.mutationFn: () => (masterPaused ? Promise.resolve() : markAllNotificationsAsRead(excludeTypes))`.
- Os invalidates existentes usam prefixo (`{ queryKey: LIST_KEY }`) e continuam pegando as keys estendidas. Ao salvar pref in-app (UI, Task 7) invalidar `PREFS_KEY` + `LIST_KEY` + `UNREAD_KEY` — exportar `export const INAPP_PREFS_KEY = PREFS_KEY;` do hook.

- [ ] **Step 5: Rodar** `npx vitest run apps/crm/src/hooks/__tests__/useNotifications.test.tsx` → PASS; rodar a suite inteira `npm run test` para pegar regressões de Bell/Popover.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/store/notifications.ts apps/crm/src/hooks/useNotifications.ts \
  apps/crm/src/hooks/__tests__/useNotifications.test.tsx
git commit -m "feat(notificacoes): filtro de leitura por tipo no sino, com markAll respeitando mute e fail-open"
```

---

### Task 6: Digest de e-mail — copy do 9º tipo

**Files:**
- Modify: `supabase/functions/_shared/notification-email.ts`
- Test: `supabase/functions/__tests__/notification-email_test.ts` (existente, estender)

**Interfaces:**
- Consumes: claim RPC já devolve `post_approved` (Task 1). Metadata do trigger `notify_post_approval` (canonical em `supabase/migrations/20260830000003_avulso_notifications_folders_views.sql`) — VERIFICAR as chaves lendo o trigger antes de implementar; o esperado é `client_name`, `post_title`, `comentario` (mesmas dos casos `post_correction`/`post_message`).
- Produces: `resolveDigestItem` cobre `post_approved` com `priority: 6` (depois de `mention: 5`, antes do fallback `9`).

- [ ] **Step 1: Ler o trigger** em `20260830000003` (função `notify_post_approval` / RPC `create_post_approval_notification`) e confirmar as chaves de metadata usadas no INSERT para `action='aprovado'`.

- [ ] **Step 2: Estender o teste deno** (padrão dos casos existentes no arquivo):

```ts
Deno.test('resolveDigestItem: post_approved vira boa notícia com prioridade 6', () => {
  const item = resolveDigestItem({
    type: 'post_approved',
    metadata: { client_name: 'Clínica Haven', post_title: 'Post X' },
    link: '/entregas?post=1',
  });
  assertEquals(item.priority, 6);
  assertEquals(item.heading, 'Post aprovado pelo cliente');
  assertEquals(item.context, 'Clínica Haven · Post X');
});
```

- [ ] **Step 3: Rodar e ver falhar** — `cd supabase/functions && deno test __tests__/notification-email_test.ts` (ou `npm run test:functions -- --filter "post_approved"`; lembrar: `--filter` casa NOME de teste, não arquivo).

- [ ] **Step 4: Implementar** — novo case antes do `default:` em `resolveDigestItem`:

```ts
    case "post_approved":
      return { priority: 6, heading: "Post aprovado pelo cliente", body: s(m, "comentario"), context: ctx(s(m, "client_name"), s(m, "post_title")), link };
```

- [ ] **Step 5: Rodar `npm run test:functions`** → PASS (atualizar qualquer fixture que fixe a lista de 8 tipos, incl. `notification-email-cron_test.ts` se enumerar tipos). Restaurar `deno.lock` se sujar.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/notification-email.ts supabase/functions/__tests__/
git commit -m "feat(notificacoes): post_approved no digest de e-mail (prioridade 6, boa notícia)"
```

---

### Task 7: Central UI — seção "Suas notificações"

**Files:**
- Modify: `apps/crm/src/pages/configuracao/tabs/NotificacoesTab.tsx` (vira a Central; export default mantém o nome `NotificacoesTab` — rota e lazy import de `App.tsx:54` intocados)
- Create: `apps/crm/src/pages/configuracao/tabs/notificacoes/SuasNotificacoesSection.tsx`
- Test: `apps/crm/src/pages/configuracao/__tests__/NotificacoesTab.test.tsx` (reescrever)

**Interfaces:**
- Consumes: `NOTIFICATION_CATALOG`, `CATEGORY_ORDER`, `CATEGORY_LABELS` (Task 3); `getNotificationEmailPrefs`/`setNotificationEmailPref`/`getNotificationInappPrefs`/`setNotificationInappPref`/`MASTER_PAUSE_TYPE`/`EMAIL_NOTIFICATION_TYPES` (Task 4); `INAPP_PREFS_KEY` (Task 5).
- Produces: `NotificacoesTab` renderiza `<SuasNotificacoesSection />` + as seções das Tasks 8-9; `SuasNotificacoesSection` sem props.

Layout validado no mockup v3 (companion): card com header, linha de colunas
"No app | E-mail", linha mestre "Pausar tudo" (fundo âmbar claro), grupos por
categoria (`CATEGORY_ORDER`), uma linha por tipo com `label`, "Quando: {when}",
"Quem recebe: {recipients}", toggle in-app sempre, toggle e-mail só se
`emailEligible`, senão `·` com `title="Este tipo não vira e-mail"`. Usar o
componente `Switch` de `components/ui` (shadcn) e as classes/tokens legados
(`--card-bg`, `--text-muted`) como o resto de Configurações.

- [ ] **Step 1: Reescrever o teste da tab** (harness de render + mock de stores do arquivo atual; manter o que der):

```ts
// asserts principais:
// 1. renderiza os 5 grupos de CATEGORY_LABELS e 22 linhas de tipo.
// 2. tipo não elegível (ex.: idea_submitted) não tem switch de e-mail.
// 3. clicar o switch in-app de 'mention' chama setNotificationInappPref('mention', false).
// 4. clicar o switch de e-mail de 'post_approved' chama setNotificationEmailPref('post_approved', false).
// 5. linha "Pausar tudo" chama set...Pref(MASTER_PAUSE_TYPE, false) do canal certo.
// 6. estados default (sem row) renderizam ligados.
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar `SuasNotificacoesSection`.** Estrutura (JSX resumido; copy exata do catálogo):

```tsx
const inappPrefs = useQuery({ queryKey: ['notification-inapp-prefs-page'], queryFn: getNotificationInappPrefs });
const emailPrefs = useQuery({ queryKey: ['notification-email-prefs-page'], queryFn: getNotificationEmailPrefs });
const saveInapp = useMutation({ mutationFn: ({ type, enabled }) => setNotificationInappPref(type, enabled),
  onSuccess: () => { qc.invalidateQueries({ queryKey: ['notification-inapp-prefs-page'] });
    qc.invalidateQueries({ queryKey: INAPP_PREFS_KEY });
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['notifications-unread-count'] }); },
  onError: () => toast.error('Não foi possível salvar. Tente novamente.') });
// saveEmail idem com setNotificationEmailPref (mesmo shape do tab atual)
// enabledOf = (prefs, type) => prefs?.[type] !== false   // sem row = ON
```

Render: header da seção com título "Suas notificações" e subtítulo "O que aparece
no sino e o que chega no seu e-mail. Preferência individual: vale só para você.";
grid `1fr 72px 72px`; para cada categoria em `CATEGORY_ORDER`, heading pequeno +
linhas dos tipos daquela categoria (ordem de declaração do catálogo).

- [ ] **Step 4: Reescrever `NotificacoesTab`** para compor as seções (as das Tasks 8-9 entram como placeholders de import comentado até existirem — NÃO deixar componente quebrado: nesta task a tab renderiza só a seção 1 e compila).

- [ ] **Step 5: Rodar o teste da tab + `npm run test`** → PASS.

- [ ] **Step 6: Verificar no browser** (preview `npm run dev` via launch.json, rota `/configuracao/notificacoes`): 22 linhas, toggles persistem após reload, sino reflete mute (mutar um tipo com notificação não lida some do popover e do badge).

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/configuracao/tabs/NotificacoesTab.tsx \
  apps/crm/src/pages/configuracao/tabs/notificacoes/ \
  apps/crm/src/pages/configuracao/__tests__/NotificacoesTab.test.tsx
git commit -m "feat(notificacoes): central, seção Suas notificações (matriz in-app × e-mail dos 22 tipos)"
```

---

### Task 8: Central UI — seção "E-mails automáticos"

**Files:**
- Create: `apps/crm/src/pages/configuracao/tabs/notificacoes/EmailsAutomaticosSection.tsx`
- Modify: `apps/crm/src/pages/configuracao/tabs/NotificacoesTab.tsx` (compor)
- Test: adicionar casos ao `NotificacoesTab.test.tsx`

**Interfaces:**
- Consumes: escrita de `profiles.marketing_opt_in` — MESMO caminho do `PerfilTab.tsx:47-53` (update direto em `profiles` via supabase; ler o arquivo e copiar o shape exato, incluindo o cache de profile de `lib/supabase.ts` se ele invalidar algo).
- Produces: `<EmailsAutomaticosSection />` sem props.

Conteúdo fixo (transparência; sem toggle exceto marketing):

| Item | Quando | Quem recebe |
|---|---|---|
| Convite para a equipe | você convida alguém para o workspace | o convidado |
| Cobrança e pagamento | um pagamento falha (avisos de retry e cancelamento) | dono do workspace |
| Instagram conectado | o cliente conclui a conexão pelo link que você enviou | quem criou o link |
| Novidades e dicas do Mesaas | marketing ocasional | você (opt-in) |

Os 3 primeiros com selo "sempre" (texto muted, sem switch). Marketing com
`Switch` ligado a `marketing_opt_in` e nota "Mesmo controle que está no seu Perfil.".

- [ ] **Step 1: Teste que falha** — seção lista os 4 itens; os 3 transacionais sem switch; toggle de marketing chama o update de profiles com `marketing_opt_in: false`.
- [ ] **Step 2: Ver falhar; implementar; ver passar.**
- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/configuracao/tabs/notificacoes/EmailsAutomaticosSection.tsx \
  apps/crm/src/pages/configuracao/tabs/NotificacoesTab.tsx \
  apps/crm/src/pages/configuracao/__tests__/NotificacoesTab.test.tsx
git commit -m "feat(notificacoes): central, seção E-mails automáticos (transparência + marketing)"
```

---

### Task 9: Central UI — seção "Seus clientes" (matriz de relatório)

**Files:**
- Create: `apps/crm/src/pages/configuracao/tabs/notificacoes/SeusClientesSection.tsx`
- Modify: `apps/crm/src/pages/configuracao/tabs/NotificacoesTab.tsx` (compor)
- Test: adicionar casos ao `NotificacoesTab.test.tsx`

**Interfaces:**
- Consumes: `getClientes()` e `updateCliente(id, { send_report_email })` de `@/store` (clients.ts:79/:144); `getWorkspaceBranding()` (workspace.ts:72, retorna `send_report_email`) e `updateWorkspaceBranding({ send_report_email })` (workspace.ts:87); papel via `useAuth()` do `AuthContext` (`workspaceRole`; conferir o nome exato do campo no contexto antes de usar — o padrão do repo é o mesmo usado pelos indicadores de plano).
- Produces: `<SeusClientesSection />` sem props; renderizada por `NotificacoesTab` SOMENTE quando papel é `owner` ou `admin`.

Layout do mockup v3: grid `1fr 170px`; cabeçalho de coluna "Relatório mensal"
com sub-texto "todo dia 1º, com PDF e resumo do mês"; linha mestre "Todos os
clientes" (interruptor geral: `workspaces.send_report_email`, fundo âmbar);
campo "Buscar cliente…" (filtro client-side por nome); uma linha por cliente
(nome + e-mail muted) com `Switch` de `send_report_email`; cliente sem e-mail:
célula "·" e texto "sem e-mail cadastrado", switch omitido; rodapé "Clientes sem
e-mail cadastrado não recebem nada. Cadastre o e-mail na ficha do cliente.".
A coluna "Pendências do Hub" NÃO existe nesta fase (chega na Fase 2 — sem
toggle morto).

- [ ] **Step 1: Testes que falham:**

```ts
// 1. papel agent: seção não renderiza.
// 2. papel owner: linha mestre + 1 linha por cliente do mock de getClientes.
// 3. cliente sem email: sem switch, mostra "sem e-mail cadastrado".
// 4. toggle do cliente chama updateCliente(id, { send_report_email: false }).
// 5. toggle mestre chama updateWorkspaceBranding({ send_report_email: false }).
// 6. busca filtra a lista por nome (case-insensitive).
```

- [ ] **Step 2: Ver falhar; implementar; ver passar** (`npm run test`).
- [ ] **Step 3: Verificar no browser** com papel owner: toggles persistem; a tela antiga `Configurações › Relatórios` reflete o mesmo valor (mesma coluna).
- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/pages/configuracao/tabs/notificacoes/SeusClientesSection.tsx \
  apps/crm/src/pages/configuracao/tabs/NotificacoesTab.tsx \
  apps/crm/src/pages/configuracao/__tests__/NotificacoesTab.test.tsx
git commit -m "feat(notificacoes): central, seção Seus clientes (matriz do relatório mensal por cliente)"
```

---

### Task 10: Verificação final + PR

**Files:** nenhum novo (correções pontuais se a verificação achar algo).

- [ ] **Step 1: Bateria completa, deste worktree:**

```bash
npm run lint
npm run format:check   # se falhar: npm run format e commitar
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run test:functions && git checkout deno.lock 2>/dev/null || true
```

Expected: tudo verde. Qualquer falha: corrigir antes de seguir (systematic-debugging se a causa não for óbvia).

- [ ] **Step 2: Re-verificar colisão de migration** — `git fetch origin main && git ls-tree origin/main:supabase/migrations --name-only | tail -3`; se surgiu prefixo ≥ `20260903000001`, renumerar o arquivo E o nome interno, commit.

- [ ] **Step 3: Push + PR** (confirmar com o usuário se a sessão não tiver autorização em pé):

```bash
git push -u origin claude/notification-center-960dfc
gh pr create --title "feat(notificacoes): Central de Notificações (Fase 1)" --body "$(cat <<'EOF'
Central de controle em Configurações → Notificações: catálogo dos 22 tipos com
preferências in-app por tipo (novas, filtro de leitura), e-mail (9 tipos, agora
com post_approved), transparência dos transacionais e matriz por cliente do
relatório mensal. Inclui fix P0: RLS de notifications passa a exigir vínculo
vigente no workspace.

Spec: docs/superpowers/specs/2026-09-02-notification-center-design.md (Fase 1).
Fase 2 (Pendências do Hub, e-mail para o cliente final) vem em PR próprio.

Rollout: deploy de notification-email-cron ANTES do db push (9º tipo na copy;
RPC muda na migration).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Aguardar o review externo do Codex** (auto-dispara no PR) e tratá-lo com a skill receiving-code-review.

---

## Rollout pós-merge (executar com o usuário)

1. `npx supabase functions deploy notification-email-cron --no-verify-jwt --use-api` (função primeiro: copy do 9º tipo).
2. `cat supabase/.temp/project-ref` para confirmar o link (PROD `skjzpekeqefvlojenfsw`), depois `npx supabase db push --linked`.
3. Vercel deploya no merge. Verificar `/configuracao/notificacoes` em prod.
