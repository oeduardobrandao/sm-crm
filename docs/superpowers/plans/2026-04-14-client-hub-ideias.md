# Client Hub — Ideias Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Ideias" page to the client hub where clients submit content ideas and agency users react, triage, and respond — surfaced both in a client detail tab and a top-level CRM page.

**Architecture:** New Supabase tables (`ideias`, `ideia_reactions`) with RLS; a new `hub-ideias` Deno edge function handles hub-token-authenticated client CRUD; CRM queries go directly via Supabase client. Hub page uses TanStack Query with optimistic invalidation. Shared `IdeiaDrawer` component reused across CRM client detail tab and top-level Ideias page.

**Tech Stack:** TypeScript, React 18, TanStack Query v5, Supabase JS v2, Tailwind CSS, lucide-react, Deno (edge functions), PostgreSQL (migrations via Supabase CLI).

---

## File Map

### New files
- `supabase/migrations/YYYYMMDDHHMMSS_ideias.sql` — tables, constraints, RLS, trigger
- `supabase/functions/hub-ideias/index.ts` — edge function (CRUD, token auth, mutability gate)
- `apps/hub/src/pages/IdeiasPage.tsx` — hub client-facing ideas page
- `apps/crm/src/pages/ideias/IdeiasPage.tsx` — CRM top-level aggregated ideas page
- `apps/crm/src/components/ideias/IdeiaDrawer.tsx` — shared drawer (status, reactions, comment)
- `apps/crm/src/components/ideias/IdeiaStatusBadge.tsx` — status badge (reused in list + drawer)

### Modified files
- `apps/hub/src/api.ts` — add `fetchIdeias`, `createIdeia`, `updateIdeia`, `deleteIdeia`
- `apps/hub/src/types.ts` — add `HubIdeia` interface
- `apps/hub/src/router.tsx` — add `ideias` route
- `apps/hub/src/pages/HomePage.tsx` — add Ideias card to SECTIONS
- `apps/crm/src/App.tsx` — add lazy import + `/ideias` route
- `apps/crm/src/components/layout/Sidebar.tsx` — add Ideias nav item to CRM group
- `apps/crm/src/pages/cliente-detalhe/HubTab.tsx` — add Ideias tab
- `apps/crm/src/store.ts` — add `getIdeias`, `updateIdeiaStatus`, `upsertIdeiaComentario`, `toggleIdeiaReaction`

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/$(date +%Y%m%d%H%M%S)_ideias.sql`

- [ ] **Step 1: Write the migration file**

Run to get the timestamp prefix:
```bash
date +%Y%m%d%H%M%S
```

Create `supabase/migrations/<timestamp>_ideias.sql`:

```sql
-- ideias table
create table ideias (
  id          uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  cliente_id  integer not null references clientes(id) on delete cascade,
  titulo      text not null,
  descricao   text not null,
  links       text[] not null default '{}',
  status      text not null default 'nova'
                constraint ideias_status_check
                check (status in ('nova','em_analise','aprovada','descartada')),
  comentario_agencia  text,
  comentario_autor_id integer references membros(id) on delete set null,
  comentario_at       timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- updated_at trigger (reuses pattern from other tables)
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger ideias_updated_at
  before update on ideias
  for each row execute function set_updated_at();

-- ideia_reactions table
create table ideia_reactions (
  id         uuid primary key default gen_random_uuid(),
  ideia_id   uuid not null references ideias(id) on delete cascade,
  membro_id  integer not null references membros(id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  unique (ideia_id, membro_id, emoji)
);

-- RLS: ideias
alter table ideias enable row level security;

create policy "workspace members can manage ideias"
  on ideias for all
  using (
    workspace_id in (
      select conta_id from membros where user_id = auth.uid()
    )
  );

-- RLS: ideia_reactions
alter table ideia_reactions enable row level security;

create policy "workspace members can manage reactions"
  on ideia_reactions for all
  using (
    ideia_id in (
      select id from ideias
      where workspace_id in (
        select conta_id from membros where user_id = auth.uid()
      )
    )
  );
```

- [ ] **Step 2: Apply the migration locally**

```bash
supabase db push
```

Expected: `Applied 1 migration` (or similar success message). If you see a conflict error on `set_updated_at`, check if the function already exists with `\df set_updated_at` in psql; if so, remove the `create or replace function` block from this migration (the trigger can still be created using the existing function).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/
git commit -m "feat: add ideias and ideia_reactions tables with RLS"
```

---

## Task 2: Edge function `hub-ideias`

**Files:**
- Create: `supabase/functions/hub-ideias/index.ts`

- [ ] **Step 1: Create the edge function**

```typescript
// supabase/functions/hub-ideias/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function resolveToken(db: ReturnType<typeof createClient>, token: string) {
  const { data } = await db
    .from("client_hub_tokens")
    .select("cliente_id, is_active, clientes(conta_id)")
    .eq("token", token)
    .maybeSingle();
  return data as { cliente_id: number; is_active: boolean; clientes: { conta_id: string } } | null;
}

async function isLocked(db: ReturnType<typeof createClient>, ideiaId: string, clienteId: number): Promise<boolean> {
  const { data: ideia } = await db
    .from("ideias")
    .select("status, comentario_agencia")
    .eq("id", ideiaId)
    .eq("cliente_id", clienteId)
    .maybeSingle();

  if (!ideia) return true; // not found → treat as locked (will 404 below)
  if (ideia.status !== "nova") return true;
  if (ideia.comentario_agencia !== null) return true;

  const { count } = await db
    .from("ideia_reactions")
    .select("id", { count: "exact", head: true })
    .eq("ideia_id", ideiaId);

  return (count ?? 0) > 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  // Extract optional ideia id from path: /hub-ideias/<uuid>
  const pathParts = url.pathname.split("/").filter(Boolean);
  const ideiaId = pathParts[pathParts.length - 1];
  const hasId = ideiaId && ideiaId !== "hub-ideias" && ideiaId.length === 36;

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // All methods except OPTIONS need a token
  const token = url.searchParams.get("token") ?? (await req.clone().json().catch(() => ({}))).token;
  if (!token) return json({ error: "token required" }, 400);

  const hubToken = await resolveToken(db, token);
  if (!hubToken || !hubToken.is_active) return json({ error: "Link inválido." }, 404);

  const clienteId = hubToken.cliente_id;
  const workspaceId = hubToken.clientes.conta_id;

  // GET /hub-ideias?token=...
  if (req.method === "GET") {
    const { data: ideias } = await db
      .from("ideias")
      .select(`
        id, titulo, descricao, links, status,
        comentario_agencia, comentario_autor_id, comentario_at, created_at, updated_at,
        comentario_autor:membros!comentario_autor_id(nome),
        ideia_reactions(id, membro_id, emoji, membros(nome))
      `)
      .eq("cliente_id", clienteId)
      .order("created_at", { ascending: false });

    return json({ ideias: ideias ?? [] });
  }

  // POST /hub-ideias
  if (req.method === "POST" && !hasId) {
    const body = await req.json().catch(() => ({}));
    const titulo = (body.titulo ?? "").trim();
    const descricao = (body.descricao ?? "").trim();
    const links: string[] = Array.isArray(body.links) ? body.links.filter((l: string) => typeof l === "string" && l.trim()) : [];

    if (!titulo) return json({ error: "titulo obrigatório" }, 400);
    if (!descricao) return json({ error: "descricao obrigatória" }, 400);

    const { data, error } = await db
      .from("ideias")
      .insert({ workspace_id: workspaceId, cliente_id: clienteId, titulo, descricao, links, status: "nova" })
      .select()
      .single();

    if (error) return json({ error: error.message }, 500);
    return json({ ideia: data }, 201);
  }

  // PATCH /hub-ideias/<uuid>?token=...
  if (req.method === "PATCH" && hasId) {
    if (await isLocked(db, ideiaId, clienteId)) return json({ error: "Esta ideia não pode mais ser editada" }, 409);

    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};
    if (body.titulo !== undefined) patch.titulo = (body.titulo ?? "").trim();
    if (body.descricao !== undefined) patch.descricao = (body.descricao ?? "").trim();
    if (body.links !== undefined) patch.links = Array.isArray(body.links) ? body.links.filter((l: string) => typeof l === "string" && l.trim()) : [];

    if (patch.titulo === "") return json({ error: "titulo obrigatório" }, 400);
    if (patch.descricao === "") return json({ error: "descricao obrigatória" }, 400);

    const { data, error } = await db
      .from("ideias")
      .update(patch)
      .eq("id", ideiaId)
      .eq("cliente_id", clienteId)
      .select()
      .single();

    if (error) return json({ error: error.message }, 500);
    return json({ ideia: data });
  }

  // DELETE /hub-ideias/<uuid>?token=...
  if (req.method === "DELETE" && hasId) {
    if (await isLocked(db, ideiaId, clienteId)) return json({ error: "Esta ideia não pode mais ser editada" }, 409);

    const { error } = await db
      .from("ideias")
      .delete()
      .eq("id", ideiaId)
      .eq("cliente_id", clienteId);

    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: "Not found" }, 404);
});
```

- [ ] **Step 2: Deploy the edge function**

```bash
supabase functions deploy hub-ideias --no-verify-jwt
```

Expected: `Deployed Function hub-ideias` (or similar success message).

- [ ] **Step 3: Smoke-test the edge function manually**

```bash
# Replace <SUPABASE_URL> and <ANON_KEY> with your local values from supabase status
# Replace <HUB_TOKEN> with a valid hub token from your dev DB
curl -s "<SUPABASE_URL>/functions/v1/hub-ideias?token=<HUB_TOKEN>" \
  -H "apikey: <ANON_KEY>" | jq .
```

Expected: `{ "ideias": [] }` (empty array for a fresh client).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/hub-ideias/
git commit -m "feat: add hub-ideias edge function with token auth and mutability gate"
```

---

## Task 3: Hub API layer + types

**Files:**
- Modify: `apps/hub/src/types.ts`
- Modify: `apps/hub/src/api.ts`

- [ ] **Step 1: Add `HubIdeia` type to `apps/hub/src/types.ts`**

Append at the end of the file:

```typescript
export interface IdeiaReaction {
  id: string;
  membro_id: number;
  emoji: string;
  membros: { nome: string };
}

export interface HubIdeia {
  id: string;
  titulo: string;
  descricao: string;
  links: string[];
  status: 'nova' | 'em_analise' | 'aprovada' | 'descartada';
  comentario_agencia: string | null;
  comentario_autor_id: number | null;
  comentario_at: string | null;
  comentario_autor: { nome: string } | null;
  created_at: string;
  updated_at: string;
  ideia_reactions: IdeiaReaction[];
}
```

- [ ] **Step 2: Add API helpers for ideias in `apps/hub/src/api.ts`**

The file already has `get` and `post` helpers. It is missing `patch` and `del` helpers. Add them and the four ideias functions. Append to the end of the file:

```typescript
async function patch<T>(fn: string, id: string, token: string, body: unknown): Promise<T> {
  const url = new URL(`${BASE}/functions/v1/${fn}/${id}`);
  url.searchParams.set('token', token);
  const res = await fetch(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error((b as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function del<T>(fn: string, id: string, token: string): Promise<T> {
  const url = new URL(`${BASE}/functions/v1/${fn}/${id}`);
  url.searchParams.set('token', token);
  const res = await fetch(url.toString(), {
    method: 'DELETE',
    headers: { apikey: ANON },
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error((b as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchIdeias(token: string) {
  return get<{ ideias: HubIdeia[] }>('hub-ideias', { token });
}

export function createIdeia(token: string, payload: { titulo: string; descricao: string; links: string[] }) {
  return post<{ ideia: HubIdeia }>('hub-ideias', { token, ...payload });
}

export function updateIdeia(token: string, id: string, payload: { titulo?: string; descricao?: string; links?: string[] }) {
  return patch<{ ideia: HubIdeia }>('hub-ideias', id, token, payload);
}

export function deleteIdeia(token: string, id: string) {
  return del<{ ok: boolean }>('hub-ideias', id, token);
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/hub && npx tsc --noEmit 2>&1 | head -30
```

Expected: no output (no errors).

- [ ] **Step 4: Commit**

```bash
git add apps/hub/src/types.ts apps/hub/src/api.ts
git commit -m "feat: add HubIdeia type and hub API helpers for ideias"
```

---

## Task 4: Hub `IdeiasPage`

**Files:**
- Create: `apps/hub/src/pages/IdeiasPage.tsx`
- Modify: `apps/hub/src/router.tsx`
- Modify: `apps/hub/src/pages/HomePage.tsx`

- [ ] **Step 1: Create `apps/hub/src/pages/IdeiasPage.tsx`**

```typescript
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, ExternalLink, X, Loader2 } from 'lucide-react';
import { useHub } from '../HubContext';
import { fetchIdeias, createIdeia, updateIdeia, deleteIdeia } from '../api';
import type { HubIdeia } from '../types';

const ALLOWED_EMOJI = ['👍', '❤️', '🔥', '💡', '🎯'] as const;

const STATUS_LABEL: Record<HubIdeia['status'], string> = {
  nova: 'Nova',
  em_analise: 'Em análise',
  aprovada: 'Aprovada',
  descartada: 'Descartada',
};

const STATUS_COLOR: Record<HubIdeia['status'], string> = {
  nova: 'bg-stone-100 text-stone-600',
  em_analise: 'bg-yellow-100 text-yellow-700',
  aprovada: 'bg-green-100 text-green-700',
  descartada: 'bg-red-100 text-red-600',
};

function isMutable(ideia: HubIdeia): boolean {
  return (
    ideia.status === 'nova' &&
    ideia.comentario_agencia === null &&
    ideia.ideia_reactions.length === 0
  );
}

function sanitizeUrl(href: string): string {
  try {
    const url = new URL(href);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
  } catch { /* fall through */ }
  return '#';
}

export function IdeiasPage() {
  const { token } = useHub();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<HubIdeia | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['hub-ideias', token],
    queryFn: () => fetchIdeias(token),
  });

  const ideias = data?.ideias ?? [];

  function openCreate() { setEditing(null); setModalOpen(true); }
  function openEdit(ideia: HubIdeia) { setEditing(ideia); setModalOpen(true); }

  return (
    <div className="hub-fade-up">
      {/* Hero */}
      <div className="mb-8 sm:mb-10 flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-stone-500 font-medium mb-2">Ideias</p>
          <h1 className="font-display text-[2rem] sm:text-[2.5rem] leading-[1.05] font-medium tracking-tight text-stone-900">
            Compartilhe suas ideias
          </h1>
          <p className="text-sm text-stone-500 mt-2">Envie sugestões e a agência responderá em breve.</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 shrink-0 px-4 py-2.5 rounded-xl bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800 transition-colors"
        >
          <Plus size={16} strokeWidth={2.5} />
          Nova ideia
        </button>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
        </div>
      ) : ideias.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <span className="text-5xl mb-4">💡</span>
          <p className="font-display text-lg font-semibold text-stone-800 mb-1">Nenhuma ideia ainda</p>
          <p className="text-sm text-stone-500 mb-6">Clique em "Nova ideia" para compartilhar sua primeira sugestão.</p>
          <button
            onClick={openCreate}
            className="px-4 py-2 rounded-xl bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800 transition-colors"
          >
            Adicionar ideia
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {ideias.map(ideia => (
            <IdeiaCard
              key={ideia.id}
              ideia={ideia}
              onEdit={() => openEdit(ideia)}
              onDelete={() => {
                deleteIdeia(token, ideia.id)
                  .then(() => qc.invalidateQueries({ queryKey: ['hub-ideias', token] }))
                  .catch(err => alert(err.message));
              }}
            />
          ))}
        </div>
      )}

      {modalOpen && (
        <IdeiaModal
          token={token}
          editing={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['hub-ideias', token] });
            setModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

function IdeiaCard({ ideia, onEdit, onDelete }: { ideia: HubIdeia; onEdit: () => void; onDelete: () => void }) {
  const mutable = isMutable(ideia);

  // Group reactions by emoji
  const reactionMap = new Map<string, string[]>();
  for (const r of ideia.ideia_reactions) {
    const names = reactionMap.get(r.emoji) ?? [];
    names.push(r.membros.nome);
    reactionMap.set(r.emoji, names);
  }

  return (
    <div className="hub-card p-5 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full mb-2 ${STATUS_COLOR[ideia.status]}`}>
            {STATUS_LABEL[ideia.status]}
          </span>
          <h3 className="font-display text-[17px] font-semibold text-stone-900 leading-snug">{ideia.titulo}</h3>
          <p className="text-sm text-stone-600 mt-1 whitespace-pre-wrap">{ideia.descricao}</p>
        </div>
        {mutable && (
          <div className="flex gap-1 shrink-0">
            <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-500 hover:text-stone-800 transition-colors">
              <Pencil size={15} />
            </button>
            <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-red-50 text-stone-500 hover:text-red-600 transition-colors">
              <Trash2 size={15} />
            </button>
          </div>
        )}
      </div>

      {/* Links */}
      {ideia.links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {ideia.links.map((link, i) => (
            <a
              key={i}
              href={sanitizeUrl(link)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[12px] text-stone-500 hover:text-stone-800 underline underline-offset-2 transition-colors"
            >
              <ExternalLink size={11} />
              {link.length > 50 ? link.slice(0, 50) + '…' : link}
            </a>
          ))}
        </div>
      )}

      {/* Reactions */}
      {reactionMap.size > 0 && (
        <div className="flex flex-wrap gap-2">
          {[...reactionMap.entries()].map(([emoji, names]) => (
            <span
              key={emoji}
              title={names.join(', ')}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-stone-100 text-sm"
            >
              {emoji} <span className="text-[12px] text-stone-600 font-medium">{names.length}</span>
            </span>
          ))}
        </div>
      )}

      {/* Agency comment */}
      {ideia.comentario_agencia && (
        <div className="border-t border-stone-100 pt-3 mt-1">
          <p className="text-[11px] uppercase tracking-wide text-stone-400 font-medium mb-1">
            Resposta da agência
            {ideia.comentario_autor && <span className="normal-case tracking-normal ml-1">— {ideia.comentario_autor.nome}</span>}
          </p>
          <p className="text-sm text-stone-700 whitespace-pre-wrap">{ideia.comentario_agencia}</p>
        </div>
      )}
    </div>
  );
}

interface ModalProps {
  token: string;
  editing: HubIdeia | null;
  onClose: () => void;
  onSaved: () => void;
}

function IdeiaModal({ token, editing, onClose, onSaved }: ModalProps) {
  const [titulo, setTitulo] = useState(editing?.titulo ?? '');
  const [descricao, setDescricao] = useState(editing?.descricao ?? '');
  const [links, setLinks] = useState<string[]>(editing?.links.length ? editing.links : ['']);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ titulo?: string; descricao?: string }>({});

  function validate() {
    const e: typeof errors = {};
    if (!titulo.trim()) e.titulo = 'Título obrigatório';
    if (!descricao.trim()) e.descricao = 'Descrição obrigatória';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    const cleanLinks = links.map(l => l.trim()).filter(Boolean);
    try {
      if (editing) {
        await updateIdeia(token, editing.id, { titulo: titulo.trim(), descricao: descricao.trim(), links: cleanLinks });
      } else {
        await createIdeia(token, { titulo: titulo.trim(), descricao: descricao.trim(), links: cleanLinks });
      }
      onSaved();
    } catch (err: any) {
      alert(err.message ?? 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-stone-900">
            {editing ? 'Editar ideia' : 'Nova ideia'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-stone-100 transition-colors text-stone-500">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[12px] font-semibold text-stone-600 uppercase tracking-wide mb-1 block">Título</label>
            <input
              className={`w-full border rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900/20 ${errors.titulo ? 'border-red-400' : 'border-stone-200'}`}
              value={titulo}
              onChange={e => setTitulo(e.target.value)}
              placeholder="Ex: Reel mostrando os bastidores..."
            />
            {errors.titulo && <p className="text-xs text-red-500 mt-0.5">{errors.titulo}</p>}
          </div>

          <div>
            <label className="text-[12px] font-semibold text-stone-600 uppercase tracking-wide mb-1 block">Descrição</label>
            <textarea
              className={`w-full border rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900/20 resize-none min-h-[100px] ${errors.descricao ? 'border-red-400' : 'border-stone-200'}`}
              value={descricao}
              onChange={e => setDescricao(e.target.value)}
              placeholder="Descreva sua ideia com detalhes..."
            />
            {errors.descricao && <p className="text-xs text-red-500 mt-0.5">{errors.descricao}</p>}
          </div>

          <div>
            <label className="text-[12px] font-semibold text-stone-600 uppercase tracking-wide mb-1 block">
              Links de referência <span className="text-stone-400 normal-case tracking-normal font-normal">(opcional)</span>
            </label>
            {links.map((link, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input
                  className="flex-1 border border-stone-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900/20"
                  value={link}
                  onChange={e => setLinks(ls => ls.map((l, j) => j === i ? e.target.value : l))}
                  placeholder="https://..."
                />
                {links.length > 1 && (
                  <button
                    onClick={() => setLinks(ls => ls.filter((_, j) => j !== i))}
                    className="p-2 rounded-xl hover:bg-stone-100 text-stone-400 hover:text-stone-700 transition-colors"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => setLinks(ls => [...ls, ''])}
              className="text-xs text-stone-500 hover:text-stone-800 underline underline-offset-2 transition-colors"
            >
              + Adicionar outro link
            </button>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800 disabled:opacity-50 transition-colors"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            {editing ? 'Salvar alterações' : 'Enviar ideia'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-stone-200 text-sm text-stone-600 hover:bg-stone-50 transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register the route in `apps/hub/src/router.tsx`**

Add the import at the top (with the other page imports):
```typescript
import { IdeiasPage } from './pages/IdeiasPage';
```

Add the route inside the children array, after `briefing`:
```typescript
{ path: 'ideias', element: <IdeiasPage /> },
```

- [ ] **Step 3: Add Ideias card to `apps/hub/src/pages/HomePage.tsx`**

At the top of the file, update the import to include `Lightbulb`:
```typescript
import { CheckSquare, Palette, FileText, BookOpen, Lightbulb } from 'lucide-react';
```

Add to the `SECTIONS` array (after Briefing):
```typescript
{ label: 'Ideias', icon: Lightbulb, path: '/ideias', description: 'Compartilhe ideias com sua agência' },
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/hub && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/
git commit -m "feat: add hub IdeiasPage with create/edit/delete modal and idea cards"
```

---

## Task 5: CRM store helpers for ideias

**Files:**
- Modify: `apps/crm/src/store.ts`

- [ ] **Step 1: Add Ideia types and store functions to `apps/crm/src/store.ts`**

Append at the end of `store.ts`:

```typescript
// ---- Ideias ----

export interface IdeiaReaction {
  id: string;
  ideia_id: string;
  membro_id: number;
  emoji: string;
  created_at: string;
  membros: { nome: string };
}

export interface Ideia {
  id: string;
  workspace_id: string;
  cliente_id: number;
  titulo: string;
  descricao: string;
  links: string[];
  status: 'nova' | 'em_analise' | 'aprovada' | 'descartada';
  comentario_agencia: string | null;
  comentario_autor_id: number | null;
  comentario_at: string | null;
  created_at: string;
  updated_at: string;
  clientes: { nome: string };
  comentario_autor: { nome: string } | null;
  ideia_reactions: IdeiaReaction[];
}

export async function getIdeias(filters: { cliente_id?: number } = {}): Promise<Ideia[]> {
  let q = supabase
    .from('ideias')
    .select(`
      id, workspace_id, cliente_id, titulo, descricao, links, status,
      comentario_agencia, comentario_autor_id, comentario_at, created_at, updated_at,
      clientes(nome),
      comentario_autor:membros!comentario_autor_id(nome),
      ideia_reactions(id, ideia_id, membro_id, emoji, created_at, membros(nome))
    `)
    .order('created_at', { ascending: false });

  if (filters.cliente_id) q = q.eq('cliente_id', filters.cliente_id);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Ideia[];
}

export async function updateIdeiaStatus(
  ideiaId: string,
  status: Ideia['status'],
): Promise<void> {
  const { error } = await supabase
    .from('ideias')
    .update({ status })
    .eq('id', ideiaId);
  if (error) throw new Error(error.message);
}

export async function upsertIdeiaComentario(
  ideiaId: string,
  comentario: string,
  autorId: number,
): Promise<void> {
  const { error } = await supabase
    .from('ideias')
    .update({
      comentario_agencia: comentario,
      comentario_autor_id: autorId,
      comentario_at: new Date().toISOString(),
    })
    .eq('id', ideiaId);
  if (error) throw new Error(error.message);
}

export async function toggleIdeiaReaction(
  ideiaId: string,
  membroId: number,
  emoji: string,
): Promise<void> {
  // Check if this user already reacted with this emoji
  const { data: existing } = await supabase
    .from('ideia_reactions')
    .select('id')
    .eq('ideia_id', ideiaId)
    .eq('membro_id', membroId)
    .eq('emoji', emoji)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('ideia_reactions')
      .delete()
      .eq('id', existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from('ideia_reactions')
      .insert({ ideia_id: ideiaId, membro_id: membroId, emoji });
    if (error) throw new Error(error.message);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/crm && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/store.ts
git commit -m "feat: add Ideia types and store helpers (get, status, comment, reaction)"
```

---

## Task 6: Shared `IdeiaDrawer` component

**Files:**
- Create: `apps/crm/src/components/ideias/IdeiaStatusBadge.tsx`
- Create: `apps/crm/src/components/ideias/IdeiaDrawer.tsx`

- [ ] **Step 1: Create `IdeiaStatusBadge.tsx`**

```typescript
// apps/crm/src/components/ideias/IdeiaStatusBadge.tsx
import type { Ideia } from '@/store';

const LABELS: Record<Ideia['status'], string> = {
  nova: 'Nova',
  em_analise: 'Em análise',
  aprovada: 'Aprovada',
  descartada: 'Descartada',
};

const CLASSES: Record<Ideia['status'], string> = {
  nova: 'bg-stone-100 text-stone-600',
  em_analise: 'bg-yellow-100 text-yellow-700',
  aprovada: 'bg-green-100 text-green-700',
  descartada: 'bg-red-100 text-red-600',
};

export function IdeiaStatusBadge({ status }: { status: Ideia['status'] }) {
  return (
    <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${CLASSES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
```

- [ ] **Step 2: Create `IdeiaDrawer.tsx`**

```typescript
// apps/crm/src/components/ideias/IdeiaDrawer.tsx
import { useState } from 'react';
import { X, ExternalLink, Save, Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { IdeiaStatusBadge } from './IdeiaStatusBadge';
import {
  updateIdeiaStatus,
  upsertIdeiaComentario,
  toggleIdeiaReaction,
  getMembros,
  type Ideia,
} from '@/store';
import { useQuery } from '@tanstack/react-query';
import { sanitizeUrl } from '@/utils/security';
import { useAuth } from '@/context/AuthContext';

const ALLOWED_EMOJI = ['👍', '❤️', '🔥', '💡', '🎯'] as const;

const STATUS_OPTIONS: { value: Ideia['status']; label: string }[] = [
  { value: 'nova', label: 'Nova' },
  { value: 'em_analise', label: 'Em análise' },
  { value: 'aprovada', label: 'Aprovada' },
  { value: 'descartada', label: 'Descartada' },
];

interface IdeiaDrawerProps {
  ideia: Ideia;
  queryKey: unknown[];
  onClose: () => void;
}

export function IdeiaDrawer({ ideia, queryKey, onClose }: IdeiaDrawerProps) {
  const qc = useQueryClient();
  const { profile } = useAuth();

  // Resolve the membros.id for the current logged-in user.
  // Profile only has the auth user_id (profile.id); membros.user_id links them.
  const { data: membros = [] } = useQuery({
    queryKey: ['membros'],
    queryFn: getMembros,
  });
  const membroId: number | undefined = membros.find((m: any) => m.user_id === profile?.id)?.id;

  const [statusSaving, setStatusSaving] = useState(false);
  const [comentario, setComentario] = useState(ideia.comentario_agencia ?? '');
  const [comentarioSaving, setComentarioSaving] = useState(false);
  const [reactionLoading, setReactionLoading] = useState<string | null>(null);

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  }

  async function handleStatusChange(newStatus: Ideia['status']) {
    setStatusSaving(true);
    try {
      await updateIdeiaStatus(ideia.id, newStatus);
      qc.invalidateQueries({ queryKey });
      toast.success('Status atualizado.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao atualizar status.');
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleSaveComentario() {
    if (!membroId) return;
    setComentarioSaving(true);
    try {
      await upsertIdeiaComentario(ideia.id, comentario, membroId);
      qc.invalidateQueries({ queryKey });
      toast.success('Comentário salvo.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao salvar comentário.');
    } finally {
      setComentarioSaving(false);
    }
  }

  async function handleReaction(emoji: string) {
    if (!membroId) return;
    setReactionLoading(emoji);
    try {
      await toggleIdeiaReaction(ideia.id, membroId, emoji);
      qc.invalidateQueries({ queryKey });
    } catch (e: any) {
      toast.error(e.message ?? 'Erro.');
    } finally {
      setReactionLoading(null);
    }
  }

  // Group reactions by emoji
  const reactionMap = new Map<string, { count: number; names: string[]; myReaction: boolean }>();
  for (const r of ideia.ideia_reactions) {
    const entry = reactionMap.get(r.emoji) ?? { count: 0, names: [], myReaction: false };
    entry.count++;
    entry.names.push(r.membros.nome);
    if (r.membro_id === membroId) entry.myReaction = true;
    reactionMap.set(r.emoji, entry);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-white w-full max-w-lg h-full shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 py-5 border-b border-stone-100">
          <div className="flex-1 min-w-0">
            <div className="mb-1.5">
              <IdeiaStatusBadge status={ideia.status} />
            </div>
            <h2 className="font-semibold text-stone-900 text-base leading-snug">{ideia.titulo}</h2>
            <p className="text-xs text-stone-400 mt-0.5">
              {ideia.clientes.nome} · {formatDate(ideia.created_at)}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-400 transition-colors shrink-0">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Description */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-400 mb-1.5">Descrição</p>
            <p className="text-sm text-stone-700 whitespace-pre-wrap">{ideia.descricao}</p>
          </div>

          {/* Links */}
          {ideia.links.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-400 mb-1.5">Links de referência</p>
              <div className="space-y-1">
                {ideia.links.map((link, i) => (
                  <a
                    key={i}
                    href={sanitizeUrl(link)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800 underline underline-offset-2 transition-colors"
                  >
                    <ExternalLink size={12} />
                    {link.length > 55 ? link.slice(0, 55) + '…' : link}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Status */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-400 mb-1.5">Status</p>
            <Select
              value={ideia.status}
              onValueChange={(v) => handleStatusChange(v as Ideia['status'])}
              disabled={statusSaving}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Reactions */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-400 mb-2">Reações</p>
            <div className="flex flex-wrap gap-2">
              {ALLOWED_EMOJI.map(emoji => {
                const entry = reactionMap.get(emoji);
                const active = entry?.myReaction ?? false;
                return (
                  <button
                    key={emoji}
                    onClick={() => handleReaction(emoji)}
                    disabled={reactionLoading === emoji}
                    title={entry?.names.join(', ') ?? ''}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-all ${
                      active
                        ? 'border-stone-900 bg-stone-900 text-white'
                        : 'border-stone-200 hover:border-stone-400 bg-white text-stone-700'
                    }`}
                  >
                    {reactionLoading === emoji ? <Loader2 size={13} className="animate-spin" /> : emoji}
                    {entry && <span className="font-medium text-[12px]">{entry.count}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Agency comment */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-400 mb-1.5">
              Resposta da agência
              {ideia.comentario_at && (
                <span className="ml-1.5 normal-case tracking-normal text-stone-300 font-normal">
                  — editado em {formatDate(ideia.comentario_at)}
                  {ideia.comentario_autor && ` por ${ideia.comentario_autor.nome}`}
                </span>
              )}
            </p>
            <textarea
              className="w-full border border-stone-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900/20 resize-none min-h-[90px]"
              value={comentario}
              onChange={e => setComentario(e.target.value)}
              placeholder="Escreva uma resposta para o cliente..."
            />
            <Button
              size="sm"
              className="mt-2"
              onClick={handleSaveComentario}
              disabled={comentarioSaving}
            >
              {comentarioSaving && <Loader2 size={13} className="animate-spin mr-1.5" />}
              <Save size={13} className="mr-1.5" />
              Salvar comentário
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/crm && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/components/ideias/
git commit -m "feat: add shared IdeiaDrawer and IdeiaStatusBadge CRM components"
```

---

## Task 7: CRM client detail — Ideias tab in HubTab

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/HubTab.tsx`

- [ ] **Step 1: Add Ideias tab to `HubTab.tsx`**

At the top of the file, add the import for IdeiaDrawer and Ideia type and store helpers:

```typescript
import { IdeiaDrawer } from '@/components/ideias/IdeiaDrawer';
import { IdeiaStatusBadge } from '@/components/ideias/IdeiaStatusBadge';
import { getIdeias, type Ideia } from '@/store';
```

In the `HubTab` component, update the `<TabsList>` to add the new trigger (after `paginas`):

```typescript
<TabsTrigger value="ideias">Ideias</TabsTrigger>
```

Add a new `<TabsContent value="ideias">` block after the paginas content:

```typescript
<TabsContent value="ideias">
  <IdeiasTab clienteId={clienteId} />
</TabsContent>
```

Add the `IdeiasTab` component at the bottom of the file (outside `HubTab`):

```typescript
function IdeiasTab({ clienteId }: { clienteId: number }) {
  const queryKey = ['hub-ideias-crm', clienteId];
  const { data: ideias = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => getIdeias({ cliente_id: clienteId }),
  });

  const [selectedIdeia, setSelectedIdeia] = useState<Ideia | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = statusFilter === 'all' ? ideias : ideias.filter(i => i.status === statusFilter);

  if (isLoading) {
    return <div className="py-8 flex justify-center"><div className="animate-spin h-5 w-5 rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Ideias do cliente</h3>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="text-sm border border-stone-200 rounded-lg px-2 py-1 outline-none"
        >
          <option value="all">Todos os status</option>
          <option value="nova">Nova</option>
          <option value="em_analise">Em análise</option>
          <option value="aprovada">Aprovada</option>
          <option value="descartada">Descartada</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">Nenhuma ideia encontrada.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map(ideia => (
            <button
              key={ideia.id}
              onClick={() => setSelectedIdeia(ideia)}
              className="w-full text-left border rounded-lg p-3 hover:bg-stone-50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <IdeiaStatusBadge status={ideia.status} />
                    {ideia.ideia_reactions.length > 0 && (
                      <span className="text-xs text-stone-400">{ideia.ideia_reactions.length} reação(ões)</span>
                    )}
                    {ideia.comentario_agencia && (
                      <span className="text-xs text-stone-400">com resposta</span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-stone-900 truncate">{ideia.titulo}</p>
                  <p className="text-xs text-stone-500 line-clamp-1 mt-0.5">{ideia.descricao}</p>
                </div>
                <span className="text-xs text-stone-400 shrink-0">
                  {new Date(ideia.created_at).toLocaleDateString('pt-BR')}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {selectedIdeia && (
        <IdeiaDrawer
          ideia={selectedIdeia}
          queryKey={queryKey}
          onClose={() => setSelectedIdeia(null)}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/crm && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe/HubTab.tsx
git commit -m "feat: add Ideias tab to CRM client detail HubTab"
```

---

## Task 8: CRM top-level Ideias page

**Files:**
- Create: `apps/crm/src/pages/ideias/IdeiasPage.tsx`
- Modify: `apps/crm/src/App.tsx`
- Modify: `apps/crm/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Create `apps/crm/src/pages/ideias/IdeiasPage.tsx`**

```typescript
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getIdeias, getClientes, type Ideia } from '@/store';
import { IdeiaStatusBadge } from '@/components/ideias/IdeiaStatusBadge';
import { IdeiaDrawer } from '@/components/ideias/IdeiaDrawer';

const ALL_STATUSES = ['nova', 'em_analise', 'aprovada', 'descartada'] as const;
const STATUS_LABELS: Record<string, string> = {
  nova: 'Nova', em_analise: 'Em análise', aprovada: 'Aprovada', descartada: 'Descartada',
};

export default function IdeiasPage() {
  const queryKey = ['hub-ideias-all'];
  const { data: ideias = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => getIdeias(),
  });
  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: getClientes,
  });

  const [selectedIdeia, setSelectedIdeia] = useState<Ideia | null>(null);
  const [clienteFilter, setClienteFilter] = useState<string>('all');
  const [statusFilters, setStatusFilters] = useState<Set<string>>(new Set());
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  function toggleStatus(s: string) {
    setStatusFilters(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  }

  const filtered = ideias.filter(i => {
    if (clienteFilter !== 'all' && String(i.cliente_id) !== clienteFilter) return false;
    if (statusFilters.size > 0 && !statusFilters.has(i.status)) return false;
    if (dateFrom && i.created_at < dateFrom) return false;
    if (dateTo && i.created_at > dateTo + 'T23:59:59') return false;
    return true;
  });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-stone-900 mb-6">Ideias</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select
          value={clienteFilter}
          onChange={e => setClienteFilter(e.target.value)}
          className="text-sm border border-stone-200 rounded-lg px-3 py-1.5 outline-none"
        >
          <option value="all">Todos os clientes</option>
          {clientes.map((c: any) => (
            <option key={c.id} value={String(c.id)}>{c.nome}</option>
          ))}
        </select>

        <div className="flex gap-1">
          {ALL_STATUSES.map(s => (
            <button
              key={s}
              onClick={() => toggleStatus(s)}
              className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
                statusFilters.has(s) ? 'bg-stone-900 text-white border-stone-900' : 'border-stone-200 text-stone-600 hover:border-stone-400'
              }`}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        <input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          className="text-sm border border-stone-200 rounded-lg px-2 py-1.5 outline-none"
        />
        <span className="text-sm text-stone-400 self-center">até</span>
        <input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          className="text-sm border border-stone-200 rounded-lg px-2 py-1.5 outline-none"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-stone-500 py-8 text-center">Nenhuma ideia encontrada.</p>
      ) : (
        <div className="border border-stone-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Cliente</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Título</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Reações</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Resposta</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Data</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ideia, i) => (
                <tr
                  key={ideia.id}
                  onClick={() => setSelectedIdeia(ideia)}
                  className={`cursor-pointer hover:bg-stone-50 transition-colors ${i !== 0 ? 'border-t border-stone-100' : ''}`}
                >
                  <td className="px-4 py-3 text-stone-600">{ideia.clientes.nome}</td>
                  <td className="px-4 py-3 font-medium text-stone-900 max-w-[200px] truncate">{ideia.titulo}</td>
                  <td className="px-4 py-3"><IdeiaStatusBadge status={ideia.status} /></td>
                  <td className="px-4 py-3 text-stone-500">{ideia.ideia_reactions.length || '—'}</td>
                  <td className="px-4 py-3 text-stone-500">{ideia.comentario_agencia ? '✓' : '—'}</td>
                  <td className="px-4 py-3 text-stone-400">{new Date(ideia.created_at).toLocaleDateString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedIdeia && (
        <IdeiaDrawer
          ideia={selectedIdeia}
          queryKey={queryKey}
          onClose={() => setSelectedIdeia(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add lazy import and route in `apps/crm/src/App.tsx`**

Add with the other lazy imports:
```typescript
const IdeiasPage = lazy(() => import('./pages/ideias/IdeiasPage'));
```

Add inside the protected `<Route element={<ProtectedRoute>...}>` block, with the other routes:
```typescript
<Route path="/ideias" element={<IdeiasPage />} />
```

- [ ] **Step 3: Add nav item to `apps/crm/src/components/layout/Sidebar.tsx`**

In the `ALL_NAV_GROUPS` array, find the `'crm'` group and add an Ideias item. The sidebar uses Phosphor icon class names (strings), so use `'ph-lightbulb'`:

```typescript
{ id: 'ideias', route: '/ideias', label: 'Ideias', icon: 'ph-lightbulb' },
```

Add it as the last item in the `crm` group's `items` array (after `clientes`).

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/crm && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/ideias/ apps/crm/src/App.tsx apps/crm/src/components/layout/Sidebar.tsx
git commit -m "feat: add top-level Ideias page to CRM with filters and drawer"
```

---

## Task 9: Verify end-to-end

- [ ] **Step 1: Start the hub dev server**

```bash
cd apps/hub && npm run dev
```

Visit `http://localhost:<port>/<workspace>/hub/<token>`. Verify:
- "Ideias" card appears on the home page.
- Navigating to `/ideias` shows the empty state.
- Creating an idea shows it in the list.
- Status badge shows "Nova".
- Edit/Delete buttons are visible (idea is unlocked).
- Submitting with empty title or description shows validation errors.

- [ ] **Step 2: Start the CRM dev server**

```bash
cd apps/crm && npm run dev
```

Verify:
- "Ideias" nav item appears in the sidebar.
- `/ideias` page loads and shows ideas from all clients.
- Clicking a row opens the `IdeiaDrawer`.
- Changing status via the dropdown works.
- Clicking emoji buttons toggles reactions (try adding then removing same emoji).
- Typing a comment and saving persists it.
- Navigate to a client detail page → Hub tab → Ideias tab → same ideas appear.

- [ ] **Step 3: Test the mutability lock**

From the CRM drawer, change the status of an idea from "Nova" to "Em análise". Then go back to the hub and verify that idea's Edit/Delete buttons are no longer visible.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete client hub Ideias feature - hub page, CRM tab, CRM Ideias page"
```
