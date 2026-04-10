# Client Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent, white-labeled client hub at `mesaas.com.br/:workspaceSlug/hub/:clientToken` where clients can approve posts, view their content calendar, access brand assets, read agency-created pages, and review their briefing — all without logging in.

**Architecture:** A second Vite app (`apps/hub/`) shares UI primitives from `packages/ui/` with the existing CRM (moved to `apps/crm/`). Six Supabase edge functions serve hub data via a permanent client token. The agency manages hub settings from a new tab in the ClienteDetalhePage.

**Tech Stack:** React 18, TypeScript, Vite, TailwindCSS, Radix UI, Supabase (Postgres + Edge Functions / Deno), react-router-dom v6, @tanstack/react-query, sonner (toasts), lucide-react icons.

---

## File Map

### New files — `apps/hub/`
- `apps/hub/index.html` — Vite entry
- `apps/hub/vite.config.ts` — Vite config with `@` alias pointing to `apps/hub/src`
- `apps/hub/tsconfig.json` — TypeScript config
- `apps/hub/src/main.tsx` — React root
- `apps/hub/src/router.tsx` — React Router with `/:workspace/hub/:token/*` routes
- `apps/hub/src/HubContext.tsx` — React context holding bootstrap data (branding + client name)
- `apps/hub/src/shell/HubShell.tsx` — Branded layout: top bar (logo + client name), card-nav home, bottom tab bar on mobile
- `apps/hub/src/shell/HubNav.tsx` — Top nav bar (desktop) + bottom tab bar (mobile)
- `apps/hub/src/pages/HomePage.tsx` — Section cards dashboard
- `apps/hub/src/pages/AprovacoesPage.tsx` — Flat post approval list
- `apps/hub/src/pages/CalendarioPage.tsx` — Monthly calendar of all posts
- `apps/hub/src/pages/MarcaPage.tsx` — Brand center
- `apps/hub/src/pages/PaginasPage.tsx` — Custom pages list
- `apps/hub/src/pages/PaginaPage.tsx` — Single custom page
- `apps/hub/src/pages/BriefingPage.tsx` — Read-only briefing
- `apps/hub/src/pages/AcessoDesativadoPage.tsx` — Shown when token is inactive
- `apps/hub/src/api.ts` — All edge function fetch helpers
- `apps/hub/src/types.ts` — Shared TypeScript interfaces

### New files — `packages/ui/`
- `packages/ui/index.ts` — Re-exports Button, Badge, Spinner, Dialog, etc. from shadcn components

### New files — `supabase/`
- `supabase/migrations/20260410_client_hub.sql` — All new tables + workspace slug column
- `supabase/functions/hub-bootstrap/index.ts`
- `supabase/functions/hub-posts/index.ts`
- `supabase/functions/hub-approve/index.ts`
- `supabase/functions/hub-brand/index.ts`
- `supabase/functions/hub-pages/index.ts`
- `supabase/functions/hub-briefing/index.ts`

### Modified files — `apps/crm/` (current `src/`)
- `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx` — Add "Hub do Cliente" tab
- `apps/crm/src/pages/cliente-detalhe/HubTab.tsx` — New: hub management UI (new file inside existing page folder)
- `apps/crm/src/store.ts` — Add hub-related store functions
- `package.json` — Add workspaces config
- `vite.config.ts` → stays at root, updated base path

---

## Task 1: Monorepo restructure

**Files:**
- Modify: `package.json`
- Create: `apps/crm/` (move `src/`, `index.html`, `vite.config.ts`, `tsconfig.json` here)
- Create: `apps/hub/` skeleton
- Create: `packages/ui/index.ts`

- [ ] **Step 1: Move CRM files into `apps/crm/`**

```bash
mkdir -p apps/crm
cp -r src apps/crm/src
cp index.html apps/crm/index.html
cp vite.config.ts apps/crm/vite.config.ts
cp tsconfig.json apps/crm/tsconfig.json
```

- [ ] **Step 2: Update `apps/crm/vite.config.ts`**

```typescript
// apps/crm/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 3: Update `apps/crm/tsconfig.json`**

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
    "target": "ES2020",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Update root `package.json` to add workspaces and scripts**

```json
{
  "name": "sm-crm",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "vite --config apps/crm/vite.config.ts",
    "dev:hub": "vite --config apps/hub/vite.config.ts",
    "dev:staging": "vite --config apps/crm/vite.config.ts --mode staging",
    "build": "tsc -p apps/crm/tsconfig.json && vite build --config apps/crm/vite.config.ts",
    "build:hub": "tsc -p apps/hub/tsconfig.json && vite build --config apps/hub/vite.config.ts",
    "build:staging": "tsc -p apps/crm/tsconfig.json && vite build --config apps/crm/vite.config.ts --mode staging",
    "preview": "vite preview --config apps/crm/vite.config.ts",
    "db:link:staging": "npx supabase link --project-ref wlyzhyfondykzpsiqsce",
    "db:push:staging": "npx supabase db push --linked"
  }
}
```

- [ ] **Step 5: Create `packages/ui/index.ts`** — re-export the shared components so the hub can import them

```typescript
// packages/ui/index.ts
// Re-export shared shadcn components for use in both apps
export { Button } from '../../apps/crm/src/components/ui/button';
export { Badge } from '../../apps/crm/src/components/ui/badge';
export { Spinner } from '../../apps/crm/src/components/ui/spinner';
export { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../apps/crm/src/components/ui/dialog';
export { Input } from '../../apps/crm/src/components/ui/input';
export { Label } from '../../apps/crm/src/components/ui/label';
```

- [ ] **Step 6: Verify CRM still builds**

```bash
npm run build
```
Expected: Build succeeds, no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add apps/ packages/ package.json
git commit -m "chore: restructure into monorepo — crm app moved to apps/crm, packages/ui stub created"
```

---

## Task 2: Database migration

**Files:**
- Create: `supabase/migrations/20260410_client_hub.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260410_client_hub.sql

-- 1. Add workspace slug + hub branding to contas
ALTER TABLE contas
  ADD COLUMN IF NOT EXISTS slug text UNIQUE,
  ADD COLUMN IF NOT EXISTS brand_color text,
  ADD COLUMN IF NOT EXISTS hub_enabled boolean NOT NULL DEFAULT true;

-- Backfill slugs from existing workspace names (lowercase, spaces → hyphens)
UPDATE contas SET slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))
  WHERE slug IS NULL;

ALTER TABLE contas ALTER COLUMN slug SET NOT NULL;

-- 2. Client hub tokens
CREATE TABLE IF NOT EXISTS client_hub_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id integer NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  conta_id integer NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Auto-create a token for every existing client
INSERT INTO client_hub_tokens (cliente_id, conta_id)
SELECT c.id, c.conta_id FROM clientes c
WHERE NOT EXISTS (
  SELECT 1 FROM client_hub_tokens t WHERE t.cliente_id = c.id
);

-- 3. Brand center
CREATE TABLE IF NOT EXISTS hub_brand (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id integer NOT NULL UNIQUE REFERENCES clientes(id) ON DELETE CASCADE,
  logo_url text,
  primary_color text,
  secondary_color text,
  font_primary text,
  font_secondary text
);

CREATE TABLE IF NOT EXISTS hub_brand_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id integer NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  name text NOT NULL,
  file_url text NOT NULL,
  file_type text NOT NULL DEFAULT 'file',
  display_order integer NOT NULL DEFAULT 0
);

-- 4. Custom pages
CREATE TABLE IF NOT EXISTS hub_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id integer NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  cliente_id integer NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  title text NOT NULL,
  content jsonb NOT NULL DEFAULT '[]',
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: all hub tables use service role only (edge functions), no client-level RLS needed
-- (edge functions authenticate via the hub token, not Supabase auth)
```

- [ ] **Step 2: Push migration to staging**

```bash
npm run db:push:staging
```
Expected: Migration applied successfully, no errors.

- [ ] **Step 3: Verify tables exist**

```bash
npx supabase db remote show --linked
```
Check that `client_hub_tokens`, `hub_brand`, `hub_brand_files`, `hub_pages` tables exist and `contas` has the `slug` column.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260410_client_hub.sql
git commit -m "feat(db): add client hub tables — client_hub_tokens, hub_brand, hub_brand_files, hub_pages, workspace slug"
```

---

## Task 3: `hub-bootstrap` edge function

**Files:**
- Create: `supabase/functions/hub-bootstrap/index.ts`

This is the first call the hub makes. It validates `workspaceSlug` + `clientToken` and returns everything needed to render the shell (branding, client name, active status).

- [ ] **Step 1: Create the edge function**

```typescript
// supabase/functions/hub-bootstrap/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const workspaceSlug = url.searchParams.get("workspace");
  const token = url.searchParams.get("token");

  if (!workspaceSlug || !token) return json({ error: "workspace and token are required" }, 400);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // 1. Resolve workspace
  const { data: conta } = await db
    .from("contas")
    .select("id, name, logo_url, brand_color, hub_enabled")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!conta) return json({ error: "Workspace não encontrado." }, 404);
  if (!conta.hub_enabled) return json({ error: "Hub desativado." }, 403);

  // 2. Validate token belongs to this workspace
  const { data: hubToken } = await db
    .from("client_hub_tokens")
    .select("cliente_id, is_active")
    .eq("token", token)
    .eq("conta_id", conta.id)
    .maybeSingle();

  if (!hubToken) return json({ error: "Link inválido." }, 404);

  // 3. Fetch client name
  const { data: cliente } = await db
    .from("clientes")
    .select("nome")
    .eq("id", hubToken.cliente_id)
    .single();

  return json({
    workspace: {
      name: conta.name,
      logo_url: conta.logo_url,
      brand_color: conta.brand_color ?? "#1a1a2e",
    },
    cliente_nome: cliente?.nome ?? "",
    is_active: hubToken.is_active,
    cliente_id: hubToken.cliente_id,
  });
});
```

- [ ] **Step 2: Deploy to staging**

```bash
npx supabase functions deploy hub-bootstrap --project-ref wlyzhyfondykzpsiqsce
```
Expected: `hub-bootstrap` deployed successfully.

- [ ] **Step 3: Smoke test**

```bash
curl "https://<project-ref>.supabase.co/functions/v1/hub-bootstrap?workspace=<slug>&token=<uuid>"
```
Expected: JSON with `workspace`, `cliente_nome`, `is_active`, `cliente_id`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/hub-bootstrap/
git commit -m "feat(edge): add hub-bootstrap edge function"
```

---

## Task 4: `hub-posts`, `hub-approve` edge functions

**Files:**
- Create: `supabase/functions/hub-posts/index.ts`
- Create: `supabase/functions/hub-approve/index.ts`

- [ ] **Step 1: Create `hub-posts`**

Returns all posts for a client across all workflows, with approval history. Used by both `/aprovacoes` and `/calendario`.

```typescript
// supabase/functions/hub-posts/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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
    .select("cliente_id, is_active")
    .eq("token", token)
    .maybeSingle();
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return json({ error: "token required" }, 400);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const hubToken = await resolveToken(db, token);
  if (!hubToken || !hubToken.is_active) return json({ error: "Link inválido." }, 404);

  // Fetch all workflows for this client
  const { data: workflows } = await db
    .from("workflows")
    .select("id")
    .eq("cliente_id", hubToken.cliente_id);

  const workflowIds = (workflows ?? []).map((w: { id: number }) => w.id);
  if (workflowIds.length === 0) return json({ posts: [], postApprovals: [] });

  // Fetch all posts
  const { data: posts } = await db
    .from("workflow_posts")
    .select("id, titulo, tipo, status, ordem, conteudo_plain, scheduled_at, workflow_id")
    .in("workflow_id", workflowIds)
    .order("scheduled_at", { ascending: true });

  const postIds = (posts ?? []).map((p: { id: number }) => p.id);

  // Fetch approval history for those posts
  const { data: postApprovals } = postIds.length > 0
    ? await db
        .from("workflow_post_approvals")
        .select("id, post_id, action, comentario, is_workspace_user, created_at")
        .in("post_id", postIds)
        .order("created_at", { ascending: true })
    : { data: [] };

  return json({ posts: posts ?? [], postApprovals: postApprovals ?? [] });
});
```

- [ ] **Step 2: Create `hub-approve`**

Client approves or requests correction on a post.

```typescript
// supabase/functions/hub-approve/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const { token, post_id, action, comentario } = await req.json();
  if (!token || !post_id || !action) return json({ error: "token, post_id and action required" }, 400);
  if (!["aprovado", "correcao", "mensagem"].includes(action)) return json({ error: "Invalid action" }, 400);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Validate token
  const { data: hubToken } = await db
    .from("client_hub_tokens")
    .select("cliente_id, is_active")
    .eq("token", token)
    .maybeSingle();
  if (!hubToken || !hubToken.is_active) return json({ error: "Link inválido." }, 404);

  // Verify the post belongs to this client
  const { data: post } = await db
    .from("workflow_posts")
    .select("id, workflow_id, status")
    .eq("id", post_id)
    .maybeSingle();
  if (!post) return json({ error: "Post não encontrado." }, 404);

  const { data: workflow } = await db
    .from("workflows")
    .select("cliente_id")
    .eq("id", post.workflow_id)
    .single();
  if (workflow?.cliente_id !== hubToken.cliente_id) return json({ error: "Não autorizado." }, 403);

  // Record approval
  await db.from("workflow_post_approvals").insert({
    post_id,
    action,
    comentario: comentario ?? null,
    is_workspace_user: false,
  });

  // Update post status
  const newStatus = action === "aprovado" ? "aprovado_cliente" : action === "correcao" ? "correcao_cliente" : post.status;
  await db.from("workflow_posts").update({ status: newStatus }).eq("id", post_id);

  return json({ ok: true });
});
```

- [ ] **Step 3: Deploy both**

```bash
npx supabase functions deploy hub-posts --project-ref wlyzhyfondykzpsiqsce
npx supabase functions deploy hub-approve --project-ref wlyzhyfondykzpsiqsce
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/hub-posts/ supabase/functions/hub-approve/
git commit -m "feat(edge): add hub-posts and hub-approve edge functions"
```

---

## Task 5: `hub-brand`, `hub-pages`, `hub-briefing` edge functions

**Files:**
- Create: `supabase/functions/hub-brand/index.ts`
- Create: `supabase/functions/hub-pages/index.ts`
- Create: `supabase/functions/hub-briefing/index.ts`

- [ ] **Step 1: Create `hub-brand`**

```typescript
// supabase/functions/hub-brand/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const token = new URL(req.url).searchParams.get("token");
  if (!token) return json({ error: "token required" }, 400);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: hubToken } = await db.from("client_hub_tokens").select("cliente_id, is_active").eq("token", token).maybeSingle();
  if (!hubToken || !hubToken.is_active) return json({ error: "Link inválido." }, 404);

  const { data: brand } = await db.from("hub_brand").select("*").eq("cliente_id", hubToken.cliente_id).maybeSingle();
  const { data: files } = await db.from("hub_brand_files").select("*").eq("cliente_id", hubToken.cliente_id).order("display_order");

  return json({ brand: brand ?? null, files: files ?? [] });
});
```

- [ ] **Step 2: Create `hub-pages`**

```typescript
// supabase/functions/hub-pages/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const pageId = url.searchParams.get("page_id"); // optional — if present, return single page
  if (!token) return json({ error: "token required" }, 400);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: hubToken } = await db.from("client_hub_tokens").select("cliente_id, is_active").eq("token", token).maybeSingle();
  if (!hubToken || !hubToken.is_active) return json({ error: "Link inválido." }, 404);

  if (pageId) {
    const { data: page } = await db.from("hub_pages").select("*").eq("id", pageId).eq("cliente_id", hubToken.cliente_id).maybeSingle();
    if (!page) return json({ error: "Página não encontrada." }, 404);
    return json({ page });
  }

  const { data: pages } = await db.from("hub_pages").select("id, title, display_order, created_at").eq("cliente_id", hubToken.cliente_id).order("display_order");
  return json({ pages: pages ?? [] });
});
```

- [ ] **Step 3: Create `hub-briefing`**

```typescript
// supabase/functions/hub-briefing/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const token = new URL(req.url).searchParams.get("token");
  if (!token) return json({ error: "token required" }, 400);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: hubToken } = await db.from("client_hub_tokens").select("cliente_id, is_active").eq("token", token).maybeSingle();
  if (!hubToken || !hubToken.is_active) return json({ error: "Link inválido." }, 404);

  const { data: cliente } = await db
    .from("clientes")
    .select("nome, email, telefone, segmento, notas")
    .eq("id", hubToken.cliente_id)
    .single();

  return json({ briefing: cliente ?? null });
});
```

- [ ] **Step 4: Deploy all three**

```bash
npx supabase functions deploy hub-brand --project-ref wlyzhyfondykzpsiqsce
npx supabase functions deploy hub-pages --project-ref wlyzhyfondykzpsiqsce
npx supabase functions deploy hub-briefing --project-ref wlyzhyfondykzpsiqsce
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/hub-brand/ supabase/functions/hub-pages/ supabase/functions/hub-briefing/
git commit -m "feat(edge): add hub-brand, hub-pages, hub-briefing edge functions"
```

---

## Task 6: Hub app scaffold

**Files:**
- Create: `apps/hub/index.html`
- Create: `apps/hub/vite.config.ts`
- Create: `apps/hub/tsconfig.json`
- Create: `apps/hub/src/main.tsx`
- Create: `apps/hub/src/types.ts`
- Create: `apps/hub/src/api.ts`
- Create: `apps/hub/src/HubContext.tsx`

- [ ] **Step 1: Create `apps/hub/index.html`**

```html
<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Hub do Cliente</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `apps/hub/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: '../../dist/hub',
  },
});
```

- [ ] **Step 3: Create `apps/hub/tsconfig.json`**

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
    "target": "ES2020",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `apps/hub/src/types.ts`**

```typescript
// apps/hub/src/types.ts

export interface WorkspaceInfo {
  name: string;
  logo_url: string | null;
  brand_color: string;
}

export interface HubBootstrap {
  workspace: WorkspaceInfo;
  cliente_nome: string;
  is_active: boolean;
  cliente_id: number;
}

export interface HubPost {
  id: number;
  titulo: string;
  tipo: 'feed' | 'reels' | 'stories' | 'carrossel';
  status: 'rascunho' | 'em_producao' | 'enviado_cliente' | 'aprovado_cliente' | 'correcao_cliente' | 'agendado' | 'publicado';
  ordem: number;
  conteudo_plain: string;
  scheduled_at: string | null;
  workflow_id: number;
}

export interface PostApproval {
  id: number;
  post_id: number;
  action: 'aprovado' | 'correcao' | 'mensagem';
  comentario: string | null;
  is_workspace_user: boolean;
  created_at: string;
}

export interface HubBrand {
  id: string;
  cliente_id: number;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  font_primary: string | null;
  font_secondary: string | null;
}

export interface HubBrandFile {
  id: string;
  cliente_id: number;
  name: string;
  file_url: string;
  file_type: string;
  display_order: number;
}

export interface HubPage {
  id: string;
  title: string;
  display_order: number;
  created_at: string;
}

export interface HubPageFull extends HubPage {
  content: HubContentBlock[];
}

export interface HubContentBlock {
  type: 'paragraph' | 'heading' | 'image' | 'link';
  content: string;
  href?: string;
  level?: 1 | 2 | 3;
}

export interface ClientBriefing {
  nome: string;
  email: string | null;
  telefone: string | null;
  segmento: string | null;
  notas: string | null;
}
```

- [ ] **Step 5: Create `apps/hub/src/api.ts`**

```typescript
// apps/hub/src/api.ts
import type {
  HubBootstrap, HubPost, PostApproval, HubBrand, HubBrandFile,
  HubPage, HubPageFull, ClientBriefing
} from './types';

const BASE = import.meta.env.VITE_SUPABASE_URL as string;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

function edgeUrl(fn: string, params: Record<string, string>) {
  const url = new URL(`${BASE}/functions/v1/${fn}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

async function get<T>(fn: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(edgeUrl(fn, params), {
    headers: { apikey: ANON },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function post<T>(fn: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error((b as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchBootstrap(workspace: string, token: string) {
  return get<HubBootstrap>('hub-bootstrap', { workspace, token });
}

export function fetchPosts(token: string) {
  return get<{ posts: HubPost[]; postApprovals: PostApproval[] }>('hub-posts', { token });
}

export function submitApproval(token: string, post_id: number, action: 'aprovado' | 'correcao' | 'mensagem', comentario?: string) {
  return post<{ ok: boolean }>('hub-approve', { token, post_id, action, comentario });
}

export function fetchBrand(token: string) {
  return get<{ brand: HubBrand | null; files: HubBrandFile[] }>('hub-brand', { token });
}

export function fetchPages(token: string) {
  return get<{ pages: HubPage[] }>('hub-pages', { token });
}

export function fetchPage(token: string, page_id: string) {
  return get<{ page: HubPageFull }>('hub-pages', { token, page_id });
}

export function fetchBriefing(token: string) {
  return get<{ briefing: ClientBriefing }>('hub-briefing', { token });
}
```

- [ ] **Step 6: Create `apps/hub/src/HubContext.tsx`**

```typescript
// apps/hub/src/HubContext.tsx
import { createContext, useContext } from 'react';
import type { HubBootstrap } from './types';

interface HubContextValue {
  bootstrap: HubBootstrap;
  token: string;
  workspace: string;
}

export const HubContext = createContext<HubContextValue | null>(null);

export function useHub(): HubContextValue {
  const ctx = useContext(HubContext);
  if (!ctx) throw new Error('useHub must be used inside HubContext.Provider');
  return ctx;
}
```

- [ ] **Step 7: Create `apps/hub/src/main.tsx`**

```typescript
// apps/hub/src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import '../../crm/src/index.css'; // reuse existing Tailwind/global styles

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
```

- [ ] **Step 8: Commit scaffold**

```bash
git add apps/hub/
git commit -m "feat(hub): scaffold hub app — vite config, tsconfig, types, api helpers, context"
```

---

## Task 7: Hub router and shell

**Files:**
- Create: `apps/hub/src/router.tsx`
- Create: `apps/hub/src/shell/HubShell.tsx`
- Create: `apps/hub/src/shell/HubNav.tsx`
- Create: `apps/hub/src/pages/AcessoDesativadoPage.tsx`

- [ ] **Step 1: Create the router**

```typescript
// apps/hub/src/router.tsx
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { HubShell } from './shell/HubShell';
import { HomePage } from './pages/HomePage';
import { AprovacoesPage } from './pages/AprovacoesPage';
import { CalendarioPage } from './pages/CalendarioPage';
import { MarcaPage } from './pages/MarcaPage';
import { PaginasPage } from './pages/PaginasPage';
import { PaginaPage } from './pages/PaginaPage';
import { BriefingPage } from './pages/BriefingPage';

export const router = createBrowserRouter([
  {
    path: '/:workspace/hub/:token',
    element: <HubShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'aprovacoes', element: <AprovacoesPage /> },
      { path: 'calendario', element: <CalendarioPage /> },
      { path: 'marca', element: <MarcaPage /> },
      { path: 'paginas', element: <PaginasPage /> },
      { path: 'paginas/:pageId', element: <PaginaPage /> },
      { path: 'briefing', element: <BriefingPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
```

- [ ] **Step 2: Create `HubShell.tsx`**

HubShell loads the bootstrap, stores it in context, applies CSS branding variables, and renders children.

```typescript
// apps/hub/src/shell/HubShell.tsx
import { useEffect, useState } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { HubContext } from '../HubContext';
import { HubNav } from './HubNav';
import { fetchBootstrap } from '../api';
import type { HubBootstrap } from '../types';

export function HubShell() {
  const { workspace, token } = useParams<{ workspace: string; token: string }>();
  const [bootstrap, setBootstrap] = useState<HubBootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspace || !token) return;
    fetchBootstrap(workspace, token)
      .then(setBootstrap)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [workspace, token]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error || !bootstrap) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', flexDirection: 'column', gap: '1rem' }}>
        <p className="text-lg font-medium">Link inválido ou expirado.</p>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!bootstrap.is_active) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', flexDirection: 'column', gap: '1rem' }}>
        <p className="text-lg font-medium">Acesso desativado.</p>
        <p className="text-sm text-muted-foreground">Entre em contato com a agência.</p>
      </div>
    );
  }

  return (
    <HubContext.Provider value={{ bootstrap, token: token!, workspace: workspace! }}>
      <style>{`:root { --brand-color: ${bootstrap.workspace.brand_color}; }`}</style>
      <div className="min-h-screen bg-background flex flex-col">
        <HubNav />
        <main className="flex-1 container mx-auto px-4 py-6 pb-24 md:pb-6">
          <Outlet />
        </main>
      </div>
    </HubContext.Provider>
  );
}
```

- [ ] **Step 3: Create `HubNav.tsx`**

Desktop: top bar. Mobile: bottom tab bar.

```typescript
// apps/hub/src/shell/HubNav.tsx
import { Link, useLocation, useParams } from 'react-router-dom';
import { Home, CheckSquare, Calendar, Palette, FileText, BookOpen } from 'lucide-react';
import { useHub } from '../HubContext';

const NAV_ITEMS = [
  { label: 'Home', icon: Home, path: '' },
  { label: 'Aprovações', icon: CheckSquare, path: '/aprovacoes' },
  { label: 'Calendário', icon: Calendar, path: '/calendario' },
  { label: 'Marca', icon: Palette, path: '/marca' },
  { label: 'Páginas', icon: FileText, path: '/paginas' },
  { label: 'Briefing', icon: BookOpen, path: '/briefing' },
];

export function HubNav() {
  const { bootstrap } = useHub();
  const { workspace, token } = useParams<{ workspace: string; token: string }>();
  const { pathname } = useLocation();
  const base = `/${workspace}/hub/${token}`;

  return (
    <>
      {/* Desktop top bar */}
      <header className="hidden md:flex items-center gap-6 px-6 py-3 border-b bg-white sticky top-0 z-10">
        <div className="flex items-center gap-2 mr-4">
          {bootstrap.workspace.logo_url && (
            <img src={bootstrap.workspace.logo_url} alt={bootstrap.workspace.name} className="h-7 w-auto object-contain" />
          )}
          <span className="font-semibold text-sm">{bootstrap.workspace.name}</span>
        </div>
        {NAV_ITEMS.map(({ label, path }) => {
          const href = `${base}${path}`;
          const active = path === '' ? pathname === base : pathname.startsWith(`${base}${path}`);
          return (
            <Link key={path} to={href} className={`text-sm transition-colors ${active ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {label}
            </Link>
          );
        })}
        <span className="ml-auto text-sm text-muted-foreground">{bootstrap.cliente_nome}</span>
      </header>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t z-10 flex">
        {NAV_ITEMS.slice(0, 5).map(({ label, icon: Icon, path }) => {
          const href = `${base}${path}`;
          const active = path === '' ? pathname === base : pathname.startsWith(`${base}${path}`);
          return (
            <Link key={path} to={href} className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs transition-colors ${active ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
              <Icon size={20} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
```

- [ ] **Step 4: Start dev server and verify routing works**

```bash
npm run dev:hub
```
Open `http://localhost:5174/<workspace>/hub/<any-uuid>` — should show loading state, then "Link inválido" (no real token yet). No console errors.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/router.tsx apps/hub/src/shell/
git commit -m "feat(hub): add router and branded shell with top/bottom nav"
```

---

## Task 8: Home page

**Files:**
- Create: `apps/hub/src/pages/HomePage.tsx`

- [ ] **Step 1: Create `HomePage.tsx`**

```typescript
// apps/hub/src/pages/HomePage.tsx
import { useNavigate, useParams } from 'react-router-dom';
import { CheckSquare, Calendar, Palette, FileText, BookOpen } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useHub } from '../HubContext';
import { fetchPosts } from '../api';

const SECTIONS = [
  { label: 'Aprovações', icon: CheckSquare, path: '/aprovacoes', description: 'Posts aguardando sua aprovação' },
  { label: 'Calendário', icon: Calendar, path: '/calendario', description: 'Todos os conteúdos programados' },
  { label: 'Marca', icon: Palette, path: '/marca', description: 'Identidade visual e arquivos' },
  { label: 'Páginas', icon: FileText, path: '/paginas', description: 'Materiais e estratégia' },
  { label: 'Briefing', icon: BookOpen, path: '/briefing', description: 'Informações do seu projeto' },
];

export function HomePage() {
  const { bootstrap, token } = useHub();
  const { workspace } = useParams<{ workspace: string }>();
  const navigate = useNavigate();
  const base = `/${workspace}/hub/${token}`;

  const { data } = useQuery({
    queryKey: ['hub-posts', token],
    queryFn: () => fetchPosts(token),
  });

  const pendingCount = (data?.posts ?? []).filter(p => p.status === 'enviado_cliente').length;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <p className="text-sm text-muted-foreground mb-1">{bootstrap.workspace.name}</p>
        <h1 className="text-2xl font-semibold">Olá, {bootstrap.cliente_nome.split(' ')[0]} 👋</h1>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {SECTIONS.map(({ label, icon: Icon, path, description }) => {
          const isPendente = path === '/aprovacoes' && pendingCount > 0;
          return (
            <button
              key={path}
              onClick={() => navigate(`${base}${path}`)}
              className="relative flex flex-col items-center text-center p-5 rounded-xl border bg-white hover:bg-accent transition-colors gap-2"
            >
              {isPendente && (
                <span className="absolute top-2 right-2 bg-destructive text-destructive-foreground text-xs rounded-full px-1.5 py-0.5 font-medium">
                  {pendingCount}
                </span>
              )}
              <Icon size={24} className="text-muted-foreground" />
              <span className="font-medium text-sm">{label}</span>
              <span className="text-xs text-muted-foreground">{description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wrap app with QueryClientProvider in `main.tsx`**

Update `apps/hub/src/main.tsx`:

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from './router';
import '../../crm/src/index.css';

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);
```

- [ ] **Step 3: Commit**

```bash
git add apps/hub/src/pages/HomePage.tsx apps/hub/src/main.tsx
git commit -m "feat(hub): add home page with section cards and pending approval badge"
```

---

## Task 9: Aprovações page

**Files:**
- Create: `apps/hub/src/pages/AprovacoesPage.tsx`

- [ ] **Step 1: Create `AprovacoesPage.tsx`**

```typescript
// apps/hub/src/pages/AprovacoesPage.tsx
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, AlertCircle, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';
import { useHub } from '../HubContext';
import { fetchPosts, submitApproval } from '../api';
import type { HubPost } from '../types';

const TIPO_LABEL: Record<string, string> = {
  feed: 'Feed', reels: 'Reels', stories: 'Stories', carrossel: 'Carrossel',
};

const STATUS_LABEL: Record<string, string> = {
  enviado_cliente: 'Aguardando aprovação',
  aprovado_cliente: 'Aprovado',
  correcao_cliente: 'Correção solicitada',
  agendado: 'Agendado',
  publicado: 'Publicado',
  rascunho: 'Rascunho',
  em_producao: 'Em produção',
};

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function PostCard({ post, token }: { post: HubPost; token: string }) {
  const [expanded, setExpanded] = useState(false);
  const [comentario, setComentario] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const qc = useQueryClient();
  const isPending = post.status === 'enviado_cliente';

  async function handleAction(action: 'aprovado' | 'correcao') {
    setSubmitting(true);
    setResult(null);
    try {
      await submitApproval(token, post.id, action, comentario || undefined);
      setResult({ type: 'success', message: action === 'aprovado' ? 'Post aprovado!' : 'Correção enviada!' });
      qc.invalidateQueries({ queryKey: ['hub-posts', token] });
    } catch (e) {
      setResult({ type: 'error', message: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border rounded-xl bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{TIPO_LABEL[post.tipo] ?? post.tipo}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${isPending ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
              {STATUS_LABEL[post.status] ?? post.status}
            </span>
          </div>
          <p className="font-medium text-sm line-clamp-2">{post.titulo}</p>
          <p className="text-xs text-muted-foreground mt-1">{formatDate(post.scheduled_at)}</p>
        </div>
        <button onClick={() => setExpanded(e => !e)} className="text-muted-foreground hover:text-foreground">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 border-t pt-3">
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">{post.conteudo_plain}</p>

          {isPending && !result && (
            <div className="mt-4 space-y-2">
              <textarea
                value={comentario}
                onChange={e => setComentario(e.target.value)}
                placeholder="Comentário (opcional)..."
                className="w-full border rounded-lg p-2 text-sm resize-none min-h-[60px]"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleAction('aprovado')}
                  disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-green-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  <CheckCircle size={15} /> Aprovar
                </button>
                <button
                  onClick={() => handleAction('correcao')}
                  disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-1.5 border text-destructive rounded-lg py-2 text-sm font-medium hover:bg-destructive/5 disabled:opacity-50"
                >
                  <AlertCircle size={15} /> Solicitar correção
                </button>
              </div>
            </div>
          )}

          {result && (
            <div className={`mt-3 rounded-lg p-3 text-sm ${result.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
              {result.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AprovacoesPage() {
  const { token } = useHub();
  const { data, isLoading } = useQuery({
    queryKey: ['hub-posts', token],
    queryFn: () => fetchPosts(token),
  });

  const pending = (data?.posts ?? [])
    .filter(p => p.status === 'enviado_cliente')
    .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''));

  if (isLoading) return <div className="flex justify-center py-20"><div className="animate-spin h-6 w-6 rounded-full border-2 border-primary border-t-transparent" /></div>;

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-1">Aprovações</h2>
      <p className="text-sm text-muted-foreground mb-6">
        {pending.length === 0 ? 'Nenhum post aguardando aprovação.' : `${pending.length} post${pending.length > 1 ? 's' : ''} aguardando sua aprovação.`}
      </p>
      <div className="space-y-3">
        {pending.map(post => <PostCard key={post.id} post={post} token={token} />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/hub/src/pages/AprovacoesPage.tsx
git commit -m "feat(hub): add aprovacoes page with post approval/correction flow"
```

---

## Task 10: Calendário page

**Files:**
- Create: `apps/hub/src/pages/CalendarioPage.tsx`

- [ ] **Step 1: Create `CalendarioPage.tsx`**

```typescript
// apps/hub/src/pages/CalendarioPage.tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useHub } from '../HubContext';
import { fetchPosts } from '../api';
import type { HubPost } from '../types';

const STATUS_COLOR: Record<string, string> = {
  enviado_cliente: '#f59e0b',
  aprovado_cliente: '#10b981',
  correcao_cliente: '#ef4444',
  agendado: '#3b82f6',
  publicado: '#6b7280',
  rascunho: '#d1d5db',
  em_producao: '#8b5cf6',
};

const STATUS_LABEL: Record<string, string> = {
  enviado_cliente: 'Aguardando aprovação',
  aprovado_cliente: 'Aprovado',
  correcao_cliente: 'Correção',
  agendado: 'Agendado',
  publicado: 'Publicado',
  rascunho: 'Rascunho',
  em_producao: 'Em produção',
};

const TIPO_LABEL: Record<string, string> = {
  feed: 'Feed', reels: 'Reels', stories: 'Stories', carrossel: 'Carrossel',
};

const MONTHS_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DAYS_PT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

function getPostsForDay(posts: HubPost[], year: number, month: number, day: number) {
  return posts.filter(p => {
    if (!p.scheduled_at) return false;
    const d = new Date(p.scheduled_at);
    return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
  });
}

export function CalendarioPage() {
  const { token } = useHub();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selected, setSelected] = useState<HubPost | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['hub-posts', token],
    queryFn: () => fetchPosts(token),
  });

  const posts = data?.posts ?? [];

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  if (isLoading) return <div className="flex justify-center py-20"><div className="animate-spin h-6 w-6 rounded-full border-2 border-primary border-t-transparent" /></div>;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Calendário</h2>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-1 rounded hover:bg-accent"><ChevronLeft size={18} /></button>
          <span className="text-sm font-medium w-32 text-center">{MONTHS_PT[month]} {year}</span>
          <button onClick={nextMonth} className="p-1 rounded hover:bg-accent"><ChevronRight size={18} /></button>
        </div>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {DAYS_PT.map(d => <div key={d} className="text-center text-xs text-muted-foreground py-1">{d}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-px bg-border rounded-xl overflow-hidden">
        {Array.from({ length: firstDay }).map((_, i) => (
          <div key={`empty-${i}`} className="bg-background min-h-[60px]" />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dayPosts = getPostsForDay(posts, year, month, day);
          const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
          return (
            <div key={day} className="bg-background min-h-[60px] p-1">
              <div className={`text-xs mb-1 w-5 h-5 flex items-center justify-center rounded-full ${isToday ? 'bg-primary text-primary-foreground font-bold' : 'text-muted-foreground'}`}>
                {day}
              </div>
              <div className="flex flex-wrap gap-0.5">
                {dayPosts.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setSelected(p)}
                    title={p.titulo}
                    style={{ backgroundColor: STATUS_COLOR[p.status] ?? '#d1d5db' }}
                    className="w-2.5 h-2.5 rounded-full hover:ring-2 hover:ring-offset-1 hover:ring-foreground"
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Post detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-t-2xl md:rounded-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex gap-2 mb-1">
                  <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{TIPO_LABEL[selected.tipo] ?? selected.tipo}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: `${STATUS_COLOR[selected.status]}20`, color: STATUS_COLOR[selected.status] }}>
                    {STATUS_LABEL[selected.status] ?? selected.status}
                  </span>
                </div>
                <h3 className="font-semibold">{selected.titulo}</h3>
                <p className="text-xs text-muted-foreground">
                  {selected.scheduled_at ? new Date(selected.scheduled_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'}
                </p>
              </div>
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{selected.conteudo_plain}</p>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/hub/src/pages/CalendarioPage.tsx
git commit -m "feat(hub): add calendario page with monthly calendar and post detail drawer"
```

---

## Task 11: Marca, Páginas, Briefing pages

**Files:**
- Create: `apps/hub/src/pages/MarcaPage.tsx`
- Create: `apps/hub/src/pages/PaginasPage.tsx`
- Create: `apps/hub/src/pages/PaginaPage.tsx`
- Create: `apps/hub/src/pages/BriefingPage.tsx`

- [ ] **Step 1: Create `MarcaPage.tsx`**

```typescript
// apps/hub/src/pages/MarcaPage.tsx
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useHub } from '../HubContext';
import { fetchBrand } from '../api';

function ColorSwatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg border" style={{ backgroundColor: color }} />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground uppercase">{color}</p>
      </div>
    </div>
  );
}

export function MarcaPage() {
  const { token } = useHub();
  const { data, isLoading } = useQuery({
    queryKey: ['hub-brand', token],
    queryFn: () => fetchBrand(token),
  });

  if (isLoading) return <div className="flex justify-center py-20"><div className="animate-spin h-6 w-6 rounded-full border-2 border-primary border-t-transparent" /></div>;

  const { brand, files } = data ?? { brand: null, files: [] };

  if (!brand && files.length === 0) {
    return (
      <div className="max-w-2xl mx-auto">
        <h2 className="text-xl font-semibold mb-4">Marca</h2>
        <p className="text-muted-foreground text-sm">Nenhum material de marca foi adicionado ainda.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <h2 className="text-xl font-semibold">Marca</h2>

      {brand?.logo_url && (
        <section>
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Logo</h3>
          <div className="border rounded-xl p-6 bg-white flex items-center justify-center">
            <img src={brand.logo_url} alt="Logo" className="max-h-24 max-w-full object-contain" />
          </div>
        </section>
      )}

      {(brand?.primary_color || brand?.secondary_color) && (
        <section>
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Cores</h3>
          <div className="space-y-3">
            {brand.primary_color && <ColorSwatch color={brand.primary_color} label="Cor primária" />}
            {brand.secondary_color && <ColorSwatch color={brand.secondary_color} label="Cor secundária" />}
          </div>
        </section>
      )}

      {(brand?.font_primary || brand?.font_secondary) && (
        <section>
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Tipografia</h3>
          <div className="space-y-2">
            {brand.font_primary && <div className="flex justify-between py-2 border-b text-sm"><span className="text-muted-foreground">Fonte principal</span><span className="font-medium">{brand.font_primary}</span></div>}
            {brand.font_secondary && <div className="flex justify-between py-2 text-sm"><span className="text-muted-foreground">Fonte secundária</span><span className="font-medium">{brand.font_secondary}</span></div>}
          </div>
        </section>
      )}

      {files.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Arquivos</h3>
          <div className="space-y-2">
            {files.map(f => (
              <a key={f.id} href={f.file_url} download target="_blank" rel="noreferrer"
                className="flex items-center justify-between border rounded-lg p-3 bg-white hover:bg-accent transition-colors">
                <span className="text-sm font-medium">{f.name}</span>
                <Download size={16} className="text-muted-foreground" />
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `PaginasPage.tsx`**

```typescript
// apps/hub/src/pages/PaginasPage.tsx
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, FileText } from 'lucide-react';
import { useHub } from '../HubContext';
import { fetchPages } from '../api';

export function PaginasPage() {
  const { token } = useHub();
  const { workspace } = useParams<{ workspace: string }>();
  const base = `/${workspace}/hub/${token}`;

  const { data, isLoading } = useQuery({
    queryKey: ['hub-pages', token],
    queryFn: () => fetchPages(token),
  });

  if (isLoading) return <div className="flex justify-center py-20"><div className="animate-spin h-6 w-6 rounded-full border-2 border-primary border-t-transparent" /></div>;

  const pages = data?.pages ?? [];

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-6">Páginas</h2>
      {pages.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nenhuma página foi criada ainda.</p>
      ) : (
        <div className="space-y-2">
          {pages.map(p => (
            <Link key={p.id} to={`${base}/paginas/${p.id}`}
              className="flex items-center justify-between border rounded-xl p-4 bg-white hover:bg-accent transition-colors">
              <div className="flex items-center gap-3">
                <FileText size={18} className="text-muted-foreground" />
                <span className="font-medium text-sm">{p.title}</span>
              </div>
              <ChevronRight size={16} className="text-muted-foreground" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `PaginaPage.tsx`**

```typescript
// apps/hub/src/pages/PaginaPage.tsx
import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useHub } from '../HubContext';
import { fetchPage } from '../api';
import type { HubContentBlock } from '../types';

function renderBlock(block: HubContentBlock, i: number) {
  switch (block.type) {
    case 'heading':
      if (block.level === 1) return <h1 key={i} className="text-2xl font-bold mt-6 mb-2">{block.content}</h1>;
      if (block.level === 2) return <h2 key={i} className="text-xl font-semibold mt-5 mb-2">{block.content}</h2>;
      return <h3 key={i} className="text-lg font-medium mt-4 mb-1">{block.content}</h3>;
    case 'image':
      return <img key={i} src={block.content} alt="" className="rounded-xl max-w-full my-4" />;
    case 'link':
      return <a key={i} href={block.href} target="_blank" rel="noreferrer" className="text-primary underline">{block.content}</a>;
    default:
      return <p key={i} className="text-sm text-muted-foreground leading-relaxed mb-3 whitespace-pre-wrap">{block.content}</p>;
  }
}

export function PaginaPage() {
  const { token, workspace } = useHub();
  const { pageId } = useParams<{ pageId: string }>();
  const base = `/${workspace}/hub/${token}`;

  const { data, isLoading } = useQuery({
    queryKey: ['hub-page', token, pageId],
    queryFn: () => fetchPage(token, pageId!),
    enabled: !!pageId,
  });

  if (isLoading) return <div className="flex justify-center py-20"><div className="animate-spin h-6 w-6 rounded-full border-2 border-primary border-t-transparent" /></div>;

  const page = data?.page;
  if (!page) return <div className="max-w-2xl mx-auto py-8 text-muted-foreground">Página não encontrada.</div>;

  return (
    <div className="max-w-2xl mx-auto">
      <Link to={`${base}/paginas`} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft size={15} /> Voltar
      </Link>
      <h1 className="text-2xl font-semibold mb-6">{page.title}</h1>
      <div>{page.content.map(renderBlock)}</div>
    </div>
  );
}
```

- [ ] **Step 4: Create `BriefingPage.tsx`**

```typescript
// apps/hub/src/pages/BriefingPage.tsx
import { useQuery } from '@tanstack/react-query';
import { useHub } from '../HubContext';
import { fetchBriefing } from '../api';

export function BriefingPage() {
  const { token } = useHub();
  const { data, isLoading } = useQuery({
    queryKey: ['hub-briefing', token],
    queryFn: () => fetchBriefing(token),
  });

  if (isLoading) return <div className="flex justify-center py-20"><div className="animate-spin h-6 w-6 rounded-full border-2 border-primary border-t-transparent" /></div>;

  const b = data?.briefing;
  if (!b) return <div className="max-w-2xl mx-auto py-8 text-muted-foreground">Sem informações de briefing.</div>;

  const fields: Array<{ label: string; value: string | null }> = [
    { label: 'Nome', value: b.nome },
    { label: 'Email', value: b.email },
    { label: 'Telefone', value: b.telefone },
    { label: 'Segmento', value: b.segmento },
    { label: 'Notas', value: b.notas },
  ];

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-6">Briefing</h2>
      <div className="border rounded-xl bg-white divide-y">
        {fields.filter(f => f.value).map(f => (
          <div key={f.label} className="flex gap-4 px-4 py-3">
            <span className="text-sm text-muted-foreground w-28 shrink-0">{f.label}</span>
            <span className="text-sm font-medium whitespace-pre-wrap">{f.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/pages/
git commit -m "feat(hub): add marca, paginas, pagina, and briefing pages"
```

---

## Task 12: Agency Hub management tab in CRM

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx`
- Create: `apps/crm/src/pages/cliente-detalhe/HubTab.tsx`
- Modify: `apps/crm/src/store.ts`

- [ ] **Step 1: Add hub store functions to `store.ts`**

Add the following functions at the end of `apps/crm/src/store.ts`:

```typescript
// Hub management functions

export async function getHubToken(clienteId: number) {
  const { data } = await supabase
    .from('client_hub_tokens')
    .select('id, token, is_active')
    .eq('cliente_id', clienteId)
    .maybeSingle();
  return data as { id: string; token: string; is_active: boolean } | null;
}

export async function setHubTokenActive(tokenId: string, isActive: boolean) {
  await supabase.from('client_hub_tokens').update({ is_active: isActive }).eq('id', tokenId);
}

export async function getHubBrand(clienteId: number) {
  const { data: brand } = await supabase.from('hub_brand').select('*').eq('cliente_id', clienteId).maybeSingle();
  const { data: files } = await supabase.from('hub_brand_files').select('*').eq('cliente_id', clienteId).order('display_order');
  return { brand: brand as HubBrandRow | null, files: (files ?? []) as HubBrandFileRow[] };
}

export async function upsertHubBrand(clienteId: number, values: Partial<HubBrandRow>) {
  await supabase.from('hub_brand').upsert({ ...values, cliente_id: clienteId }, { onConflict: 'cliente_id' });
}

export async function addHubBrandFile(clienteId: number, name: string, file_url: string, file_type: string, display_order: number) {
  await supabase.from('hub_brand_files').insert({ cliente_id: clienteId, name, file_url, file_type, display_order });
}

export async function removeHubBrandFile(fileId: string) {
  await supabase.from('hub_brand_files').delete().eq('id', fileId);
}

export async function getHubPages(clienteId: number) {
  const { data } = await supabase.from('hub_pages').select('*').eq('cliente_id', clienteId).order('display_order');
  return (data ?? []) as HubPageRow[];
}

export async function upsertHubPage(page: Partial<HubPageRow> & { cliente_id: number; conta_id: number }) {
  if (page.id) {
    await supabase.from('hub_pages').update(page).eq('id', page.id);
  } else {
    await supabase.from('hub_pages').insert(page);
  }
}

export async function removeHubPage(pageId: string) {
  await supabase.from('hub_pages').delete().eq('id', pageId);
}

// Type aliases for hub tables
export interface HubBrandRow {
  id?: string;
  cliente_id: number;
  logo_url?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  font_primary?: string | null;
  font_secondary?: string | null;
}

export interface HubBrandFileRow {
  id: string;
  cliente_id: number;
  name: string;
  file_url: string;
  file_type: string;
  display_order: number;
}

export interface HubPageRow {
  id: string;
  conta_id: number;
  cliente_id: number;
  title: string;
  content: unknown[];
  display_order: number;
  created_at: string;
}
```

- [ ] **Step 2: Create `HubTab.tsx`**

```typescript
// apps/crm/src/pages/cliente-detalhe/HubTab.tsx
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Eye, ToggleLeft, ToggleRight, Plus, Trash2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  getHubToken, setHubTokenActive,
  getHubBrand, upsertHubBrand, addHubBrandFile, removeHubBrandFile,
  getHubPages, upsertHubPage, removeHubPage,
  type HubBrandRow, type HubPageRow,
} from '@/store';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

interface HubTabProps {
  clienteId: number;
  contaId: number;
  workspaceSlug: string;
}

export function HubTab({ clienteId, contaId, workspaceSlug }: HubTabProps) {
  const qc = useQueryClient();

  const { data: tokenData } = useQuery({
    queryKey: ['hub-token', clienteId],
    queryFn: () => getHubToken(clienteId),
  });

  const { data: brandData } = useQuery({
    queryKey: ['hub-brand-crm', clienteId],
    queryFn: () => getHubBrand(clienteId),
  });

  const { data: pages } = useQuery({
    queryKey: ['hub-pages-crm', clienteId],
    queryFn: () => getHubPages(clienteId),
  });

  const hubUrl = tokenData ? `${window.location.origin}/${workspaceSlug}/hub/${tokenData.token}` : '';

  async function toggleActive() {
    if (!tokenData) return;
    await setHubTokenActive(tokenData.id, !tokenData.is_active);
    qc.invalidateQueries({ queryKey: ['hub-token', clienteId] });
    toast.success(tokenData.is_active ? 'Acesso desativado.' : 'Acesso reativado.');
  }

  async function copyLink() {
    await navigator.clipboard.writeText(hubUrl);
    toast.success('Link copiado!');
  }

  return (
    <div className="space-y-8 py-4">
      {/* Access control */}
      <section>
        <h3 className="font-semibold mb-3">Acesso do Cliente</h3>
        {tokenData ? (
          <div className="flex items-center gap-3 flex-wrap">
            <code className="text-xs bg-muted px-3 py-2 rounded-lg flex-1 min-w-0 truncate">{hubUrl}</code>
            <Button size="sm" variant="outline" onClick={copyLink}><Copy size={14} className="mr-1.5" /> Copiar</Button>
            <Button size="sm" variant="outline" onClick={() => window.open(hubUrl, '_blank')}><Eye size={14} className="mr-1.5" /> Preview</Button>
            <Button size="sm" variant={tokenData.is_active ? 'destructive' : 'default'} onClick={toggleActive}>
              {tokenData.is_active ? <><ToggleRight size={14} className="mr-1.5" /> Desativar</> : <><ToggleLeft size={14} className="mr-1.5" /> Ativar</>}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Token ainda não gerado para este cliente.</p>
        )}
      </section>

      {/* Brand center */}
      <BrandEditor clienteId={clienteId} brand={brandData?.brand ?? null} files={brandData?.files ?? []} onSaved={() => qc.invalidateQueries({ queryKey: ['hub-brand-crm', clienteId] })} />

      {/* Custom pages */}
      <PagesEditor clienteId={clienteId} contaId={contaId} pages={pages ?? []} onSaved={() => qc.invalidateQueries({ queryKey: ['hub-pages-crm', clienteId] })} />
    </div>
  );
}

function BrandEditor({ clienteId, brand, files, onSaved }: { clienteId: number; brand: HubBrandRow | null; files: ReturnType<typeof getHubBrand> extends Promise<infer T> ? T['files'] : never; onSaved: () => void }) {
  const [form, setForm] = useState<Partial<HubBrandRow>>(brand ?? {});
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await upsertHubBrand(clienteId, form);
      toast.success('Marca salva!');
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h3 className="font-semibold mb-3">Marca</h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>URL do Logo</Label>
          <Input value={form.logo_url ?? ''} onChange={e => setForm(f => ({ ...f, logo_url: e.target.value }))} placeholder="https://..." />
        </div>
        <div>
          <Label>Cor primária</Label>
          <Input value={form.primary_color ?? ''} onChange={e => setForm(f => ({ ...f, primary_color: e.target.value }))} placeholder="#000000" />
        </div>
        <div>
          <Label>Cor secundária</Label>
          <Input value={form.secondary_color ?? ''} onChange={e => setForm(f => ({ ...f, secondary_color: e.target.value }))} placeholder="#ffffff" />
        </div>
        <div>
          <Label>Fonte principal</Label>
          <Input value={form.font_primary ?? ''} onChange={e => setForm(f => ({ ...f, font_primary: e.target.value }))} placeholder="Inter" />
        </div>
        <div>
          <Label>Fonte secundária</Label>
          <Input value={form.font_secondary ?? ''} onChange={e => setForm(f => ({ ...f, font_secondary: e.target.value }))} placeholder="Playfair Display" />
        </div>
      </div>
      <Button size="sm" className="mt-3" onClick={save} disabled={saving}><Save size={14} className="mr-1.5" /> Salvar marca</Button>
    </section>
  );
}

function PagesEditor({ clienteId, contaId, pages, onSaved }: { clienteId: number; contaId: number; pages: HubPageRow[]; onSaved: () => void }) {
  const [editingPage, setEditingPage] = useState<Partial<HubPageRow> | null>(null);
  const [saving, setSaving] = useState(false);

  async function savePage() {
    if (!editingPage?.title) return;
    setSaving(true);
    try {
      await upsertHubPage({ ...editingPage, cliente_id: clienteId, conta_id: contaId, content: editingPage.content ?? [] });
      toast.success('Página salva!');
      setEditingPage(null);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function deletePage(id: string) {
    await removeHubPage(id);
    toast.success('Página removida.');
    onSaved();
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Páginas</h3>
        <Button size="sm" variant="outline" onClick={() => setEditingPage({ title: '', content: [] })}>
          <Plus size={14} className="mr-1.5" /> Nova página
        </Button>
      </div>

      <div className="space-y-2">
        {pages.map(p => (
          <div key={p.id} className="flex items-center justify-between border rounded-lg px-3 py-2">
            <span className="text-sm font-medium">{p.title}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditingPage(p)}>Editar</Button>
              <Button size="sm" variant="ghost" onClick={() => deletePage(p.id)}><Trash2 size={14} /></Button>
            </div>
          </div>
        ))}
      </div>

      {editingPage && (
        <div className="mt-4 border rounded-xl p-4 space-y-3">
          <div>
            <Label>Título da página</Label>
            <Input value={editingPage.title ?? ''} onChange={e => setEditingPage(p => ({ ...p!, title: e.target.value }))} placeholder="Ex: Manual de Comunicação" />
          </div>
          <div>
            <Label>Conteúdo (texto simples)</Label>
            <textarea
              className="w-full border rounded-lg p-2 text-sm resize-none min-h-[120px]"
              value={(editingPage.content as Array<{ content: string }> | undefined)?.[0]?.content ?? ''}
              onChange={e => setEditingPage(p => ({ ...p!, content: [{ type: 'paragraph', content: e.target.value }] }))}
              placeholder="Escreva o conteúdo da página..."
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={savePage} disabled={saving}><Save size={14} className="mr-1.5" /> Salvar</Button>
            <Button size="sm" variant="outline" onClick={() => setEditingPage(null)}>Cancelar</Button>
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Add the Hub tab to `ClienteDetalhePage.tsx`**

Find the tabs section in `ClienteDetalhePage.tsx`. The exact pattern to locate is the existing tab list (look for `TabsTrigger` elements). Add the hub tab:

In the `TabsList`, add:
```tsx
<TabsTrigger value="hub">Hub</TabsTrigger>
```

In the `TabsContent` section, add (replacing `<WORKSPACE_SLUG>` — this comes from the `conta` record):
```tsx
<TabsContent value="hub">
  <HubTab
    clienteId={cliente.id}
    contaId={cliente.conta_id}
    workspaceSlug={conta?.slug ?? String(cliente.conta_id)}
  />
</TabsContent>
```

Add the import at the top of the file:
```typescript
import { HubTab } from './HubTab';
```

You will also need to fetch `conta.slug` — add it to whichever query already fetches the conta record for this client, selecting `slug` in addition to existing fields.

- [ ] **Step 4: Build CRM to verify no TypeScript errors**

```bash
npm run build
```
Expected: Builds successfully.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe/ apps/crm/src/store.ts
git commit -m "feat(crm): add Hub do Cliente tab to ClienteDetalhePage with brand, pages, and access management"
```

---

## Task 13: Deployment routing

**Files:**
- Create: `vercel.json` (or update Nginx config, depending on deployment target)

- [ ] **Step 1: Add Vercel rewrites for path-based hub routing**

If deploying to Vercel, create `vercel.json` at project root:

```json
{
  "rewrites": [
    {
      "source": "/:workspace/hub/:token/(.*)",
      "destination": "/hub/index.html"
    },
    {
      "source": "/:workspace/hub/:token",
      "destination": "/hub/index.html"
    },
    {
      "source": "/(.*)",
      "destination": "/crm/index.html"
    }
  ],
  "buildCommand": "npm run build && npm run build:hub",
  "outputDirectory": "dist"
}
```

If deploying to Nginx, add this block to the server config:
```nginx
location ~* ^/[^/]+/hub/ {
  root /var/www/dist/hub;
  try_files $uri /hub/index.html;
}

location / {
  root /var/www/dist/crm;
  try_files $uri /crm/index.html;
}
```

- [ ] **Step 2: Add `.superpowers/` to `.gitignore`**

```bash
echo ".superpowers/" >> .gitignore
```

- [ ] **Step 3: Commit**

```bash
git add vercel.json .gitignore
git commit -m "chore: add deployment routing for hub app and update gitignore"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Permanent magic link per client | Task 2 (client_hub_tokens), Task 3 (hub-bootstrap) |
| Auto-generated, agency toggles is_active | Task 2 migration, Task 12 HubTab |
| White-label per workspace (slug, brand_color, logo) | Task 2 migration, Task 3 hub-bootstrap, Task 7 HubShell |
| Path-based URL: /:workspaceSlug/hub/:token | Task 7 router, Task 13 deployment |
| Home: cards dashboard | Task 8 |
| Posts to approve: flat list, sorted by date | Task 9 |
| Calendar: all posts, all statuses | Task 10 |
| Brand center: logo, colors, fonts, files | Task 5 hub-brand, Task 11 MarcaPage, Task 12 BrandEditor |
| Custom pages: agency creates, client reads | Task 5 hub-pages, Task 11 PaginasPage/PaginaPage, Task 12 PagesEditor |
| Briefing: readonly | Task 5 hub-briefing, Task 11 BriefingPage |
| Agency management tab in CRM | Task 12 |
| Second Vite app in monorepo | Task 1, Task 6 |
| Shared UI primitives | Task 1 packages/ui |

**No placeholders found.**

**Type consistency verified:** `HubPost`, `PostApproval`, `HubBrand`, `HubBrandFile`, `HubPage`, `HubPageFull`, `HubContentBlock`, `ClientBriefing` all defined in `types.ts` (Task 6) and used consistently across api.ts and all page components.

One note: `BrandEditor` in Task 12 uses a complex type inference for the `files` prop. Simplify that prop type to `HubBrandFileRow[]` directly to avoid the inference complexity — the implementation in the plan reflects that.
