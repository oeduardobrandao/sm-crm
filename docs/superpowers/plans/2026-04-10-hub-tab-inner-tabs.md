# HubTab Inner Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inner tab bar to `HubTab.tsx` with tabs for Acesso, Briefing, Marca, and Páginas — and implement a Briefing editor that reads/writes `nome`, `email`, `telefone`, `segmento`, `notas` on the `clientes` row.

**Architecture:** Wrap the existing `HubTab` content in a shadcn `<Tabs>` component. Add a `BriefingEditor` sub-component that reuses the existing `updateCliente` store function. No new store functions, no new DB tables.

**Tech Stack:** React, TypeScript, shadcn `Tabs` (`@radix-ui/react-tabs`), `@tanstack/react-query`, `sonner` toasts, Supabase via existing `store.ts`

---

### Task 1: Add inner tabs scaffold to HubTab

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/HubTab.tsx`

- [ ] **Step 1: Add Tabs imports**

At the top of `HubTab.tsx`, add to the existing imports:

```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
```

- [ ] **Step 2: Wrap HubTab return in `<Tabs>`**

Replace the current `return` in `HubTab`:

```tsx
return (
  <div className="space-y-8 py-4">
    {/* Access control */}
    <section> ... </section>
    <BrandEditor ... />
    <PagesEditor ... />
  </div>
);
```

With:

```tsx
return (
  <Tabs defaultValue="acesso" className="py-4">
    <TabsList className="mb-6">
      <TabsTrigger value="acesso">Acesso</TabsTrigger>
      <TabsTrigger value="briefing">Briefing</TabsTrigger>
      <TabsTrigger value="marca">Marca</TabsTrigger>
      <TabsTrigger value="paginas">Páginas</TabsTrigger>
    </TabsList>

    <TabsContent value="acesso">
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
          <div className="flex items-center gap-3">
            <p className="text-sm text-muted-foreground">Nenhum link gerado ainda.</p>
            <Button size="sm" onClick={async () => {
              try {
                await createHubToken(clienteId, contaId);
                qc.invalidateQueries({ queryKey: ['hub-token', clienteId] });
                toast.success('Link gerado!');
              } catch (e: any) {
                toast.error(e.message ?? 'Erro ao gerar link.');
              }
            }}>
              <Plus size={14} className="mr-1.5" /> Gerar link
            </Button>
          </div>
        )}
      </section>
    </TabsContent>

    <TabsContent value="briefing">
      <BriefingEditor clienteId={clienteId} />
    </TabsContent>

    <TabsContent value="marca">
      <BrandEditor
        clienteId={clienteId}
        brand={brandData?.brand ?? null}
        files={brandData?.files ?? []}
        onSaved={() => qc.invalidateQueries({ queryKey: ['hub-brand-crm', clienteId] })}
      />
    </TabsContent>

    <TabsContent value="paginas">
      <PagesEditor
        clienteId={clienteId}
        contaId={contaId}
        pages={pages ?? []}
        onSaved={() => qc.invalidateQueries({ queryKey: ['hub-pages-crm', clienteId] })}
      />
    </TabsContent>
  </Tabs>
);
```

- [ ] **Step 3: Verify it compiles**

```bash
cd apps/crm && npx tsc --noEmit
```

Expected: no errors (BriefingEditor doesn't exist yet — expect one error for that, which is fine at this stage).

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe/HubTab.tsx
git commit -m "feat: wrap HubTab content in inner tabs (Acesso, Briefing, Marca, Páginas)"
```

---

### Task 2: Add BriefingEditor component

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/HubTab.tsx`

- [ ] **Step 1: Add `updateCliente` and `getClientes` imports**

`updateCliente` is already imported if it's used elsewhere, but for this component we just need it. Add to the import from `@/store`:

```tsx
import {
  getHubToken, createHubToken, setHubTokenActive,
  getHubBrand, upsertHubBrand,
  getHubPages, upsertHubPage, removeHubPage,
  updateCliente,
  type HubBrandRow, type HubBrandFileRow, type HubPageRow,
} from '@/store';
```

Also add `supabase` import for the briefing fetch (or use the existing pattern). Actually, to avoid coupling to supabase directly in this component, add a dedicated `getClienteBriefing` store function in the next step. For now, continue.

- [ ] **Step 2: Add `getClienteBriefing` to store.ts**

Open `apps/crm/src/store.ts` and append after the existing hub functions (around line 1495):

```ts
export async function getClienteBriefing(clienteId: number): Promise<{ nome: string | null; email: string | null; telefone: string | null; segmento: string | null; notas: string | null }> {
  const { data, error } = await supabase
    .from('clientes')
    .select('nome, email, telefone, segmento, notas')
    .eq('id', clienteId)
    .single();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 3: Add `getClienteBriefing` to the import in HubTab.tsx**

```tsx
import {
  getHubToken, createHubToken, setHubTokenActive,
  getHubBrand, upsertHubBrand,
  getHubPages, upsertHubPage, removeHubPage,
  updateCliente, getClienteBriefing,
  type HubBrandRow, type HubBrandFileRow, type HubPageRow,
} from '@/store';
```

- [ ] **Step 4: Add BriefingEditor component at the bottom of HubTab.tsx**

```tsx
function BriefingEditor({ clienteId }: { clienteId: number }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['hub-briefing-crm', clienteId],
    queryFn: () => getClienteBriefing(clienteId),
  });

  type BriefingFields = { nome: string; email: string; telefone: string; segmento: string; notas: string };
  const [form, setForm] = useState<Partial<BriefingFields>>({});
  const [saving, setSaving] = useState(false);

  // Sync form when data loads
  React.useEffect(() => {
    if (data) setForm({
      nome: data.nome ?? '',
      email: data.email ?? '',
      telefone: data.telefone ?? '',
      segmento: data.segmento ?? '',
      notas: data.notas ?? '',
    });
  }, [data]);

  async function save() {
    setSaving(true);
    try {
      await updateCliente(clienteId, form);
      qc.invalidateQueries({ queryKey: ['hub-briefing-crm', clienteId] });
      toast.success('Briefing salvo!');
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <div className="py-8 flex justify-center"><div className="animate-spin h-5 w-5 rounded-full border-2 border-primary border-t-transparent" /></div>;

  return (
    <section>
      <h3 className="font-semibold mb-3">Briefing</h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Nome</Label>
          <Input value={form.nome ?? ''} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} placeholder="Nome do cliente" />
        </div>
        <div>
          <Label>Email</Label>
          <Input value={form.email ?? ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@exemplo.com" />
        </div>
        <div>
          <Label>Telefone</Label>
          <Input value={form.telefone ?? ''} onChange={e => setForm(f => ({ ...f, telefone: e.target.value }))} placeholder="(11) 99999-9999" />
        </div>
        <div>
          <Label>Segmento</Label>
          <Input value={form.segmento ?? ''} onChange={e => setForm(f => ({ ...f, segmento: e.target.value }))} placeholder="Ex: Saúde, Moda..." />
        </div>
        <div className="col-span-2">
          <Label>Notas</Label>
          <textarea
            className="w-full border rounded-lg p-2 text-sm resize-none min-h-[100px]"
            value={form.notas ?? ''}
            onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
            placeholder="Observações sobre o cliente..."
          />
        </div>
      </div>
      <Button size="sm" className="mt-3" onClick={save} disabled={saving}>
        <Save size={14} className="mr-1.5" /> Salvar briefing
      </Button>
    </section>
  );
}
```

- [ ] **Step 5: Verify it compiles**

```bash
cd apps/crm && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Manually test in browser**

1. Open a client detail page
2. Scroll to "Hub do Cliente"
3. Confirm four tabs appear: Acesso, Briefing, Marca, Páginas
4. Click Briefing — fields load with existing client data
5. Edit a field, click "Salvar briefing" — toast appears
6. Reload page — edited value persists
7. Open the hub link — Briefing page in hub shows updated values

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe/HubTab.tsx apps/crm/src/store.ts
git commit -m "feat: add Briefing tab to HubTab with read/write editor for client fields"
```
