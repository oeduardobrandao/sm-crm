# Hub Briefing Q&A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Briefing tab placeholder with a Q&A system: agency creates questions in CRM, client answers them in the hub.

**Architecture:** New DB table `hub_briefing_questions`. CRM writes questions directly via Supabase. Hub reads questions and writes answers via edge function (token auth). CRM shows questions+answers read-only on agency side.

**Tech Stack:** React, TypeScript, shadcn components, React Query, Sonner toasts, Supabase (direct for CRM, edge function for hub), Deno edge functions

---

### Task 1: DB migration — hub_briefing_questions table

**Files:**
- Create: `supabase/migrations/20260410_hub_briefing_questions.sql`

- [ ] **Step 1: Create migration file**

```sql
CREATE TABLE hub_briefing_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id bigint NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  conta_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  question text NOT NULL,
  answer text,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Apply migration**

```bash
cd /path/to/project && npx supabase db push
```

Expected: migration applied with no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260410_hub_briefing_questions.sql
git commit -m "feat: add hub_briefing_questions table"
```

---

### Task 2: CRM store functions

**Files:**
- Modify: `apps/crm/src/store.ts`

Context: `store.ts` uses a `supabase` client (imported from `@/lib/supabase`). Hub functions are at the bottom of the file. The `HubPageRow` type is already defined there. Follow the same pattern.

- [ ] **Step 1: Add type export**

At the bottom of `store.ts`, after the existing hub types, add:

```ts
export interface HubBriefingQuestionRow {
  id: string;
  cliente_id: number;
  conta_id: string;
  question: string;
  answer: string | null;
  display_order: number;
  created_at: string;
}
```

- [ ] **Step 2: Add store functions**

After the type definition, add these four functions:

```ts
export async function getHubBriefingQuestions(clienteId: number): Promise<HubBriefingQuestionRow[]> {
  const { data, error } = await supabase
    .from('hub_briefing_questions')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('display_order');
  if (error) throw error;
  return data ?? [];
}

export async function addHubBriefingQuestion(clienteId: number, contaId: string, question: string): Promise<void> {
  const { data: existing } = await supabase
    .from('hub_briefing_questions')
    .select('display_order')
    .eq('cliente_id', clienteId)
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (existing?.display_order ?? -1) + 1;
  const { error } = await supabase
    .from('hub_briefing_questions')
    .insert({ cliente_id: clienteId, conta_id: contaId, question, display_order: nextOrder });
  if (error) throw error;
}

export async function updateHubBriefingQuestion(id: string, question: string): Promise<void> {
  const { error } = await supabase
    .from('hub_briefing_questions')
    .update({ question })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteHubBriefingQuestion(id: string): Promise<void> {
  const { error } = await supabase
    .from('hub_briefing_questions')
    .delete()
    .eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd apps/crm && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/store.ts
git commit -m "feat: add hub briefing Q&A store functions"
```

---

### Task 3: CRM BriefingEditor component

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/HubTab.tsx`

Context: `HubTab.tsx` already has tabs scaffold. The Briefing tab currently shows:
```tsx
<TabsContent value="briefing">
  <div className="text-sm text-muted-foreground py-4">Briefing (em breve)</div>
</TabsContent>
```

It uses `useQuery`, `useQueryClient`, `useState`, `toast`, `Button`, `Input`, `Label` — all already imported.

- [ ] **Step 1: Update imports in HubTab.tsx**

Replace the import from `@/store`:
```tsx
import {
  getHubToken, createHubToken, setHubTokenActive,
  getHubBrand, upsertHubBrand,
  getHubPages, upsertHubPage, removeHubPage,
  getHubBriefingQuestions, addHubBriefingQuestion, updateHubBriefingQuestion, deleteHubBriefingQuestion,
  type HubBrandRow, type HubBrandFileRow, type HubPageRow, type HubBriefingQuestionRow,
} from '@/store';
```

- [ ] **Step 2: Replace Briefing tab content**

Replace:
```tsx
<TabsContent value="briefing">
  <div className="text-sm text-muted-foreground py-4">Briefing (em breve)</div>
</TabsContent>
```

With:
```tsx
<TabsContent value="briefing">
  <BriefingEditor
    clienteId={clienteId}
    contaId={contaId}
    onSaved={() => qc.invalidateQueries({ queryKey: ['hub-briefing-questions', clienteId] })}
  />
</TabsContent>
```

- [ ] **Step 3: Add BriefingEditor component at bottom of file**

```tsx
function BriefingEditor({ clienteId, contaId, onSaved }: { clienteId: number; contaId: string; onSaved: () => void }) {
  const { data: questions = [], isLoading } = useQuery({
    queryKey: ['hub-briefing-questions', clienteId],
    queryFn: () => getHubBriefingQuestions(clienteId),
  });

  const [newQuestion, setNewQuestion] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  async function handleAdd() {
    if (!newQuestion.trim()) return;
    setAdding(true);
    try {
      await addHubBriefingQuestion(clienteId, contaId, newQuestion.trim());
      setNewQuestion('');
      onSaved();
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao adicionar pergunta.');
    } finally {
      setAdding(false);
    }
  }

  async function handleSaveEdit(id: string) {
    if (!editText.trim()) return;
    try {
      await updateHubBriefingQuestion(id, editText.trim());
      setEditingId(null);
      onSaved();
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao salvar pergunta.');
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteHubBriefingQuestion(id);
      onSaved();
      toast.success('Pergunta removida.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao remover pergunta.');
    }
  }

  if (isLoading) return <div className="py-8 flex justify-center"><div className="animate-spin h-5 w-5 rounded-full border-2 border-primary border-t-transparent" /></div>;

  return (
    <section>
      <h3 className="font-semibold mb-3">Briefing</h3>

      <div className="space-y-3 mb-4">
        {questions.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma pergunta cadastrada ainda.</p>
        )}
        {questions.map(q => (
          <div key={q.id} className="border rounded-lg p-3">
            {editingId === q.id ? (
              <div className="space-y-2">
                <Input
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(q.id); if (e.key === 'Escape') setEditingId(null); }}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleSaveEdit(q.id)}><Save size={14} className="mr-1.5" /> Salvar</Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Cancelar</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{q.question}</p>
                  {q.answer ? (
                    <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{q.answer}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1 italic">Sem resposta ainda</p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => { setEditingId(q.id); setEditText(q.question); }}>Editar</Button>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(q.id)}><Trash2 size={14} /></Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Input
          value={newQuestion}
          onChange={e => setNewQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
          placeholder="Nova pergunta..."
          className="flex-1"
        />
        <Button size="sm" onClick={handleAdd} disabled={adding || !newQuestion.trim()}>
          <Plus size={14} className="mr-1.5" /> Adicionar
        </Button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd apps/crm && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe/HubTab.tsx
git commit -m "feat: add BriefingEditor Q&A component to CRM HubTab"
```

---

### Task 4: Update hub-briefing edge function

**Files:**
- Modify: `supabase/functions/hub-briefing/index.ts`

Context: The current function only supports GET and returns `{ briefing: { nome, email, ... } }`. We need to:
1. Change GET to return `{ questions: [...] }` from `hub_briefing_questions`
2. Add POST to save an answer for a question

- [ ] **Step 1: Rewrite hub-briefing/index.ts**

Replace the entire file with:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function resolveToken(db: ReturnType<typeof createClient>, token: string) {
  const { data } = await db
    .from("client_hub_tokens")
    .select("cliente_id, is_active")
    .eq("token", token)
    .maybeSingle();
  if (!data || !data.is_active) return null;
  return data as { cliente_id: number; is_active: boolean };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  if (req.method === "GET") {
    const token = new URL(req.url).searchParams.get("token");
    if (!token) return json({ error: "token required" }, 400);

    const hubToken = await resolveToken(db, token);
    if (!hubToken) return json({ error: "Link inválido." }, 404);

    const { data, error } = await db
      .from("hub_briefing_questions")
      .select("id, question, answer, display_order")
      .eq("cliente_id", hubToken.cliente_id)
      .order("display_order");

    if (error) return json({ error: error.message }, 500);
    return json({ questions: data ?? [] });
  }

  if (req.method === "POST") {
    let body: { token?: string; question_id?: string; answer?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const { token, question_id, answer } = body;
    if (!token || !question_id || answer === undefined) {
      return json({ error: "token, question_id, and answer are required" }, 400);
    }

    const hubToken = await resolveToken(db, token);
    if (!hubToken) return json({ error: "Link inválido." }, 404);

    // Verify the question belongs to this client
    const { data: question } = await db
      .from("hub_briefing_questions")
      .select("id")
      .eq("id", question_id)
      .eq("cliente_id", hubToken.cliente_id)
      .maybeSingle();

    if (!question) return json({ error: "Pergunta não encontrada." }, 404);

    const { error } = await db
      .from("hub_briefing_questions")
      .update({ answer })
      .eq("id", question_id);

    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
});
```

- [ ] **Step 2: Deploy the function**

```bash
npx supabase functions deploy hub-briefing
```

Expected: deployed successfully.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/hub-briefing/index.ts
git commit -m "feat: update hub-briefing edge function for Q&A system"
```

---

### Task 5: Update hub app types and API

**Files:**
- Modify: `apps/hub/src/types.ts`
- Modify: `apps/hub/src/api.ts`

- [ ] **Step 1: Update types.ts**

Replace the `ClientBriefing` interface:
```ts
// Remove:
export interface ClientBriefing {
  nome: string;
  email: string | null;
  telefone: string | null;
  segmento: string | null;
  notas: string | null;
}

// Add:
export interface BriefingQuestion {
  id: string;
  question: string;
  answer: string | null;
  display_order: number;
}
```

- [ ] **Step 2: Update api.ts**

Replace the `fetchBriefing` import type and add `submitBriefingAnswer`:

In the import at top of api.ts, replace `ClientBriefing` with `BriefingQuestion`:
```ts
import type {
  HubBootstrap, HubPost, PostApproval, HubBrand, HubBrandFile,
  HubPage, HubPageFull, BriefingQuestion
} from './types';
```

Replace `fetchBriefing`:
```ts
export function fetchBriefing(token: string) {
  return get<{ questions: BriefingQuestion[] }>('hub-briefing', { token });
}
```

Add after `fetchBriefing`:
```ts
export function submitBriefingAnswer(token: string, question_id: string, answer: string) {
  return post<{ ok: boolean }>('hub-briefing', { token, question_id, answer });
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd apps/hub && npx tsc --noEmit
```

Expected: errors only in BriefingPage.tsx (which we'll fix next). No errors in api.ts or types.ts.

- [ ] **Step 4: Commit**

```bash
git add apps/hub/src/types.ts apps/hub/src/api.ts
git commit -m "feat: update hub types and API for Q&A briefing"
```

---

### Task 6: Rewrite hub BriefingPage

**Files:**
- Modify: `apps/hub/src/pages/BriefingPage.tsx`

Context: The current page displays client profile fields. It needs to become a Q&A interface where the client can type and save answers. Each question shows independently with its own save button (simpler UX than a Save All button — client saves one answer at a time).

- [ ] **Step 1: Rewrite BriefingPage.tsx**

Replace the entire file with:

```tsx
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useHub } from '../HubContext';
import { fetchBriefing, submitBriefingAnswer } from '../api';

export function BriefingPage() {
  const { token } = useHub();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['hub-briefing', token],
    queryFn: () => fetchBriefing(token),
  });

  if (isLoading) return (
    <div className="flex justify-center py-20">
      <div className="animate-spin h-6 w-6 rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );

  const questions = data?.questions ?? [];

  if (questions.length === 0) return (
    <div className="max-w-2xl mx-auto py-8 text-muted-foreground text-sm">
      Nenhuma pergunta disponível ainda.
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-6">Briefing</h2>
      <div className="space-y-6">
        {questions.map(q => (
          <QuestionItem
            key={q.id}
            question={q.question}
            initialAnswer={q.answer}
            onSave={async (answer) => {
              await submitBriefingAnswer(token, q.id, answer);
              qc.invalidateQueries({ queryKey: ['hub-briefing', token] });
            }}
          />
        ))}
      </div>
    </div>
  );
}

function QuestionItem({
  question,
  initialAnswer,
  onSave,
}: {
  question: string;
  initialAnswer: string | null;
  onSave: (answer: string) => Promise<void>;
}) {
  const [answer, setAnswer] = useState(initialAnswer ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(answer);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border rounded-xl p-4 space-y-2">
      <p className="text-sm font-medium">{question}</p>
      <textarea
        className="w-full border rounded-lg p-2 text-sm resize-none min-h-[100px] focus:outline-none focus:ring-2 focus:ring-primary/30"
        value={answer}
        onChange={e => setAnswer(e.target.value)}
        placeholder="Digite sua resposta..."
      />
      <div className="flex justify-end">
        <button
          className="text-sm px-4 py-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
          onClick={handleSave}
          disabled={saving}
        >
          {saved ? 'Salvo!' : saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/hub && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/hub/src/pages/BriefingPage.tsx
git commit -m "feat: rewrite hub BriefingPage with Q&A interface"
```
