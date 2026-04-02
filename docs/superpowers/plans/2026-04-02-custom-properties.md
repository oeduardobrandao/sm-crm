# Custom Properties for Workflow Posts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add template-level custom property fields (10 types) to workflow posts, editable in the post drawer and optionally visible in the client portal.

**Architecture:** Three new DB tables (`template_property_definitions`, `post_property_values`, `workflow_select_options`) using a definition-table + per-value JSONB strategy. New React components (`PropertyPanel`, `PropertyValue`, `PropertyDefinitionPanel`, `PortalPropertyTable`) are wired into the existing `WorkflowDrawer`, `TemplatesModal`, and `PortalPage`. The `portal-data` edge function is extended to return portal-visible properties.

**Tech Stack:** Supabase (Postgres + RLS + Edge Functions), React, TypeScript, TanStack Query, Tailwind, shadcn/ui, Lucide icons, Sonner toasts.

> **Note:** This codebase has no automated test infrastructure. Each task ends with a TypeScript type-check (`npx tsc --noEmit`) and a manual verification step. Run `npm run dev` to test UI changes.

---

## File Map

**New files:**
- `supabase/migrations/20260403_custom_properties.sql`
- `src/pages/entregas/components/PropertyDefinitionPanel.tsx`
- `src/pages/entregas/components/PropertyValue.tsx`
- `src/pages/entregas/components/PropertyPanel.tsx`
- `src/pages/portal/PortalPropertyTable.tsx`

**Modified files:**
- `src/store.ts` — new types + 7 new store functions
- `src/pages/entregas/components/WorkflowDrawer.tsx` — add `PropertyPanel` above editor
- `src/pages/entregas/components/WorkflowModals.tsx` — add Propriedades tab to `TemplatesModal`
- `src/pages/portal/PortalPage.tsx` — add `PortalPropertyTable` above post content
- `supabase/functions/portal-data/index.ts` — include property data in response

---

## Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/20260403_custom_properties.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- ============================================================
-- custom_properties — template-level property fields for posts
-- ============================================================

-- 1. Property definitions (schema, defined on a template)
CREATE TABLE IF NOT EXISTS template_property_definitions (
  id             bigserial PRIMARY KEY,
  template_id    bigint NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
  conta_id       uuid NOT NULL,
  name           text NOT NULL,
  type           text NOT NULL CHECK (type IN (
                   'text','number','select','multiselect','status',
                   'date','person','checkbox','url','email','phone','created_time'
                 )),
  config         jsonb NOT NULL DEFAULT '{}',
  portal_visible boolean NOT NULL DEFAULT false,
  display_order  integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tpd_template ON template_property_definitions(template_id);
CREATE INDEX IF NOT EXISTS idx_tpd_conta ON template_property_definitions(conta_id);

-- 2. Property values (one row per post × definition)
CREATE TABLE IF NOT EXISTS post_property_values (
  id                     bigserial PRIMARY KEY,
  post_id                bigint NOT NULL REFERENCES workflow_posts(id) ON DELETE CASCADE,
  property_definition_id bigint NOT NULL REFERENCES template_property_definitions(id) ON DELETE CASCADE,
  value                  jsonb,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, property_definition_id)
);

CREATE INDEX IF NOT EXISTS idx_ppv_post ON post_property_values(post_id);
CREATE INDEX IF NOT EXISTS idx_ppv_definition ON post_property_values(property_definition_id);
CREATE INDEX IF NOT EXISTS idx_ppv_value ON post_property_values USING GIN (value);

-- 3. Per-workflow additional select options (on-the-fly additions)
CREATE TABLE IF NOT EXISTS workflow_select_options (
  id                     bigserial PRIMARY KEY,
  workflow_id            bigint NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  property_definition_id bigint NOT NULL REFERENCES template_property_definitions(id) ON DELETE CASCADE,
  conta_id               uuid NOT NULL,
  option_id              uuid NOT NULL DEFAULT gen_random_uuid(),
  label                  text NOT NULL,
  color                  text NOT NULL DEFAULT '#94a3b8',
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wso_workflow ON workflow_select_options(workflow_id);
CREATE INDEX IF NOT EXISTS idx_wso_definition ON workflow_select_options(property_definition_id);

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE template_property_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_property_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_select_options ENABLE ROW LEVEL SECURITY;

-- template_property_definitions: workspace members access own conta
DROP POLICY IF EXISTS "workspace_tpd_all" ON template_property_definitions;
CREATE POLICY "workspace_tpd_all" ON template_property_definitions
  FOR ALL USING (conta_id IN (SELECT public.get_my_conta_id()));

-- post_property_values: check via parent post's conta_id
DROP POLICY IF EXISTS "workspace_ppv_all" ON post_property_values;
CREATE POLICY "workspace_ppv_all" ON post_property_values
  FOR ALL USING (
    post_id IN (
      SELECT wp.id FROM workflow_posts wp
      WHERE wp.conta_id IN (SELECT public.get_my_conta_id())
    )
  );

-- workflow_select_options: workspace members access own conta
DROP POLICY IF EXISTS "workspace_wso_all" ON workflow_select_options;
CREATE POLICY "workspace_wso_all" ON workflow_select_options
  FOR ALL USING (conta_id IN (SELECT public.get_my_conta_id()));

-- Service role bypass (edge functions)
DROP POLICY IF EXISTS "service_role_bypass_tpd" ON template_property_definitions;
CREATE POLICY "service_role_bypass_tpd" ON template_property_definitions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_bypass_ppv" ON post_property_values;
CREATE POLICY "service_role_bypass_ppv" ON post_property_values
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_bypass_wso" ON workflow_select_options;
CREATE POLICY "service_role_bypass_wso" ON workflow_select_options
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Apply the migration**

```bash
npx supabase db push
```

Expected: migration runs without errors. Verify in Supabase dashboard that the three tables exist under Table Editor.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260403_custom_properties.sql
git commit -m "feat: add custom properties DB migration (3 tables + RLS)"
```

---

## Task 2: Store Types + Read Functions

**Files:**
- Modify: `src/store.ts` (append after the `WorkflowPost` / `PostApproval` block near line 1039)

- [ ] **Step 1: Add types to `src/store.ts`**

Find the block after `PostApproval` (around line 1039) and add:

```ts
// =============================================
// CUSTOM PROPERTIES
// =============================================

export type PropertyType =
  | 'text' | 'number' | 'select' | 'multiselect' | 'status'
  | 'date' | 'person' | 'checkbox' | 'url' | 'email' | 'phone' | 'created_time';

export interface SelectOption {
  id: string;      // stable uuid string
  label: string;
  color: string;   // hex color e.g. '#E1306C'
}

export interface TemplatePropertyDefinition {
  id?: number;
  template_id: number;
  conta_id?: string;
  name: string;
  type: PropertyType;
  config: Record<string, unknown>; // shape varies by type — see spec
  portal_visible: boolean;
  display_order: number;
  created_at?: string;
}

export interface PostPropertyValue {
  id?: number;
  post_id: number;
  property_definition_id: number;
  value: unknown;
  definition: TemplatePropertyDefinition;
}

export interface WorkflowSelectOption {
  id?: number;
  workflow_id: number;
  property_definition_id: number;
  conta_id?: string;
  option_id: string;   // uuid string
  label: string;
  color: string;
  created_at?: string;
}
```

- [ ] **Step 2: Add `getPropertyDefinitions` to `src/store.ts`**

Directly after the types block:

```ts
export async function getPropertyDefinitions(templateId: number): Promise<TemplatePropertyDefinition[]> {
  const { data, error } = await supabase
    .from('template_property_definitions')
    .select('*')
    .eq('template_id', templateId)
    .order('display_order', { ascending: true });
  if (error) throw error;
  return data || [];
}
```

- [ ] **Step 3: Add `getWorkflowPostsWithProperties` to `src/store.ts`**

After `getWorkflowPosts`:

```ts
export async function getWorkflowPostsWithProperties(workflowId: number): Promise<(WorkflowPost & { property_values: PostPropertyValue[] })[]> {
  const { data, error } = await supabase
    .from('workflow_posts')
    .select(`
      *,
      post_property_values (
        id,
        property_definition_id,
        value,
        template_property_definitions (
          id, template_id, conta_id, name, type, config, portal_visible, display_order, created_at
        )
      )
    `)
    .eq('workflow_id', workflowId)
    .order('ordem', { ascending: true });
  if (error) throw error;
  return (data || []).map((post: any) => ({
    ...post,
    property_values: (post.post_property_values || []).map((pv: any) => ({
      id: pv.id,
      post_id: post.id,
      property_definition_id: pv.property_definition_id,
      value: pv.value,
      definition: pv.template_property_definitions,
    })),
    post_property_values: undefined,
  }));
}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/store.ts
git commit -m "feat: add custom property types and read functions to store"
```

---

## Task 3: Store Write Functions

**Files:**
- Modify: `src/store.ts` (append to the CUSTOM PROPERTIES section)

- [ ] **Step 1: Add `createPropertyDefinition`**

```ts
export async function createPropertyDefinition(
  templateId: number,
  payload: Omit<TemplatePropertyDefinition, 'id' | 'template_id' | 'conta_id' | 'created_at'>
): Promise<TemplatePropertyDefinition> {
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('template_property_definitions')
    .insert({ ...payload, template_id: templateId, conta_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 2: Add `updatePropertyDefinition`**

```ts
export async function updatePropertyDefinition(
  id: number,
  payload: Partial<Omit<TemplatePropertyDefinition, 'id' | 'template_id' | 'conta_id' | 'created_at'>>
): Promise<TemplatePropertyDefinition> {
  const { data, error } = await supabase
    .from('template_property_definitions')
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 3: Add `deletePropertyDefinition`**

```ts
export async function deletePropertyDefinition(id: number): Promise<void> {
  const { error } = await supabase
    .from('template_property_definitions')
    .delete()
    .eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 4: Add `upsertPostPropertyValue`**

```ts
export async function upsertPostPropertyValue(
  postId: number,
  definitionId: number,
  value: unknown
): Promise<void> {
  const { error } = await supabase
    .from('post_property_values')
    .upsert(
      { post_id: postId, property_definition_id: definitionId, value, updated_at: new Date().toISOString() },
      { onConflict: 'post_id,property_definition_id' }
    );
  if (error) throw error;
}
```

- [ ] **Step 5: Add `createWorkflowSelectOption`**

```ts
export async function createWorkflowSelectOption(
  workflowId: number,
  definitionId: number,
  label: string,
  color: string
): Promise<WorkflowSelectOption> {
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('workflow_select_options')
    .insert({ workflow_id: workflowId, property_definition_id: definitionId, label, color, conta_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 6: Add `getWorkflowSelectOptions`**

```ts
export async function getWorkflowSelectOptions(workflowId: number, definitionId: number): Promise<WorkflowSelectOption[]> {
  const { data, error } = await supabase
    .from('workflow_select_options')
    .select('*')
    .eq('workflow_id', workflowId)
    .eq('property_definition_id', definitionId);
  if (error) throw error;
  return data || [];
}
```

- [ ] **Step 7: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/store.ts
git commit -m "feat: add custom property write functions to store"
```

---

## Task 4: PropertyDefinitionPanel Component

**Files:**
- Create: `src/pages/entregas/components/PropertyDefinitionPanel.tsx`

This is a slide-in panel with a type list on the left and a config form on the right. Used from both `TemplatesModal` and `WorkflowDrawer`.

- [ ] **Step 1: Create the component**

```tsx
import { useState } from 'react';
import { X, Type, Hash, ChevronDown, Calendar, User, CheckSquare, Link, Mail, Phone, Clock, Tag, List } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  createPropertyDefinition, updatePropertyDefinition,
  type PropertyType, type TemplatePropertyDefinition, type SelectOption,
} from '../../../store';

const TYPE_ITEMS: { type: PropertyType; label: string; icon: React.ReactNode }[] = [
  { type: 'text',         label: 'Texto',          icon: <Type className="h-4 w-4" /> },
  { type: 'number',       label: 'Número',          icon: <Hash className="h-4 w-4" /> },
  { type: 'select',       label: 'Seleção',         icon: <ChevronDown className="h-4 w-4" /> },
  { type: 'multiselect',  label: 'Multi-seleção',   icon: <List className="h-4 w-4" /> },
  { type: 'status',       label: 'Status',          icon: <Tag className="h-4 w-4" /> },
  { type: 'date',         label: 'Data',            icon: <Calendar className="h-4 w-4" /> },
  { type: 'person',       label: 'Pessoa',          icon: <User className="h-4 w-4" /> },
  { type: 'checkbox',     label: 'Checkbox',        icon: <CheckSquare className="h-4 w-4" /> },
  { type: 'url',          label: 'URL',             icon: <Link className="h-4 w-4" /> },
  { type: 'email',        label: 'Email',           icon: <Mail className="h-4 w-4" /> },
  { type: 'phone',        label: 'Telefone',        icon: <Phone className="h-4 w-4" /> },
  { type: 'created_time', label: 'Criado em',       icon: <Clock className="h-4 w-4" /> },
];

const PRESET_COLORS = ['#94a3b8','#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899'];

interface Props {
  templateId: number;
  definition?: TemplatePropertyDefinition; // provided when editing
  onSave: () => void;
  onClose: () => void;
}

export function PropertyDefinitionPanel({ templateId, definition, onSave, onClose }: Props) {
  const isEditing = !!definition?.id;
  const [selectedType, setSelectedType] = useState<PropertyType>(definition?.type ?? 'text');
  const [name, setName] = useState(definition?.name ?? '');
  const [portalVisible, setPortalVisible] = useState(definition?.portal_visible ?? false);
  const [saving, setSaving] = useState(false);

  // Options state for select / multiselect / status
  const [options, setOptions] = useState<SelectOption[]>(() => {
    if (definition?.config && (definition.type === 'select' || definition.type === 'multiselect' || definition.type === 'status')) {
      return (definition.config.options as SelectOption[]) ?? [];
    }
    if (selectedType === 'status') {
      return [
        { id: crypto.randomUUID(), label: 'Não iniciado', color: '#94a3b8' },
        { id: crypto.randomUUID(), label: 'Em andamento', color: '#3b82f6' },
        { id: crypto.randomUUID(), label: 'Concluído', color: '#22c55e' },
      ];
    }
    return [];
  });
  const [newOptionLabel, setNewOptionLabel] = useState('');
  const [newOptionColor, setNewOptionColor] = useState('#3b82f6');

  // Number format
  const [numberFormat, setNumberFormat] = useState<string>(
    (definition?.config?.format as string) ?? 'integer'
  );

  const buildConfig = (): Record<string, unknown> => {
    if (selectedType === 'select' || selectedType === 'multiselect' || selectedType === 'status') {
      return { options };
    }
    if (selectedType === 'number') {
      return { format: numberFormat };
    }
    if (selectedType === 'person') {
      return { allow_multiple: false };
    }
    return {};
  };

  const handleAddOption = () => {
    const label = newOptionLabel.trim();
    if (!label) return;
    setOptions(prev => [...prev, { id: crypto.randomUUID(), label, color: newOptionColor }]);
    setNewOptionLabel('');
  };

  const handleRemoveOption = (id: string) => {
    setOptions(prev => prev.filter(o => o.id !== id));
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) { toast.error('Nome da propriedade é obrigatório.'); return; }
    setSaving(true);
    try {
      const payload = {
        name: trimmedName,
        type: selectedType,
        config: buildConfig(),
        portal_visible: portalVisible,
        display_order: definition?.display_order ?? 999,
      };
      if (isEditing) {
        await updatePropertyDefinition(definition!.id!, payload);
        toast.success('Propriedade atualizada!');
      } else {
        await createPropertyDefinition(templateId, payload);
        toast.success('Propriedade criada!');
      }
      onSave();
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao salvar propriedade');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end',
    }}>
      {/* Overlay */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)' }} onClick={onClose} />

      {/* Panel */}
      <div style={{
        position: 'relative', zIndex: 1, width: 520, maxWidth: '95vw',
        background: 'var(--card-bg, white)', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
            {isEditing ? 'Editar propriedade' : 'Nova propriedade'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body: two columns */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Left: type list */}
          <div style={{ width: 160, borderRight: '1px solid var(--border-color)', overflowY: 'auto', padding: '0.5rem' }}>
            <p style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.25rem 0.5rem', margin: '0 0 0.25rem' }}>Tipo</p>
            {TYPE_ITEMS.map(item => (
              <button
                key={item.type}
                onClick={() => setSelectedType(item.type)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 8px',
                  border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.82rem', textAlign: 'left',
                  background: selectedType === item.type ? 'var(--primary-light, #eff6ff)' : 'transparent',
                  color: selectedType === item.type ? 'var(--primary, #1d4ed8)' : 'inherit',
                  fontWeight: selectedType === item.type ? 600 : 400,
                  marginBottom: 1,
                }}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>

          {/* Right: config */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem' }}>
            <div style={{ marginBottom: '1rem' }}>
              <Label style={{ fontSize: '0.8rem' }}>Nome da propriedade *</Label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={`Ex: ${TYPE_ITEMS.find(t => t.type === selectedType)?.label}`}
                style={{ marginTop: 4 }}
                autoFocus
              />
            </div>

            {/* Type-specific config */}
            {(selectedType === 'select' || selectedType === 'multiselect' || selectedType === 'status') && (
              <div style={{ marginBottom: '1rem' }}>
                <Label style={{ fontSize: '0.8rem' }}>Opções</Label>
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {options.map(opt => (
                    <div key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                      <span style={{ width: 14, height: 14, borderRadius: '50%', background: opt.color, flexShrink: 0, display: 'inline-block' }} />
                      <span style={{ flex: 1, fontSize: '0.85rem' }}>{opt.label}</span>
                      <button
                        onClick={() => handleRemoveOption(opt.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                    {PRESET_COLORS.map(c => (
                      <button
                        key={c}
                        onClick={() => setNewOptionColor(c)}
                        style={{
                          width: 16, height: 16, borderRadius: '50%', background: c, border: newOptionColor === c ? '2px solid #1d4ed8' : '2px solid transparent',
                          cursor: 'pointer', padding: 0,
                        }}
                      />
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Input
                    placeholder="Nome da opção"
                    value={newOptionLabel}
                    onChange={e => setNewOptionLabel(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddOption(); } }}
                    style={{ flex: 1, fontSize: '0.82rem' }}
                  />
                  <Button variant="outline" size="sm" onClick={handleAddOption}>+ Adicionar</Button>
                </div>
              </div>
            )}

            {selectedType === 'number' && (
              <div style={{ marginBottom: '1rem' }}>
                <Label style={{ fontSize: '0.8rem' }}>Formato</Label>
                <select
                  className="drawer-select"
                  value={numberFormat}
                  onChange={e => setNumberFormat(e.target.value)}
                  style={{ marginTop: 4, width: '100%' }}
                >
                  <option value="integer">Inteiro</option>
                  <option value="decimal">Decimal</option>
                  <option value="percentage">Percentual (%)</option>
                  <option value="currency">Moeda (R$)</option>
                </select>
              </div>
            )}

            {selectedType === 'created_time' && (
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                Preenchido automaticamente com a data de criação do post.
              </p>
            )}

            {/* Portal visibility */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.75rem 0', borderTop: '1px solid var(--border-color)', marginTop: 'auto' }}>
              <Checkbox
                id="portal-visible"
                checked={portalVisible}
                onCheckedChange={v => setPortalVisible(v as boolean)}
              />
              <label htmlFor="portal-visible" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>
                Visível no portal do cliente
              </label>
            </div>

            {!isEditing && (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                Esta propriedade será adicionada a todos os posts deste template.
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando…' : isEditing ? 'Salvar alterações' : 'Criar propriedade'}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/entregas/components/PropertyDefinitionPanel.tsx
git commit -m "feat: add PropertyDefinitionPanel slide-in component"
```

---

## Task 5: PropertyValue Component

**Files:**
- Create: `src/pages/entregas/components/PropertyValue.tsx`

Renders a single editable property row. Switches on `definition.type` to show the right input. Debounces value saves.

- [ ] **Step 1: Create the component**

```tsx
import { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  upsertPostPropertyValue, createWorkflowSelectOption, getWorkflowSelectOptions,
  type TemplatePropertyDefinition, type SelectOption, type Membro,
} from '../../../store';

interface Props {
  definition: TemplatePropertyDefinition;
  value: unknown;
  postId: number;
  workflowId: number;
  membros: Membro[];
}

function formatDisplayValue(definition: TemplatePropertyDefinition, value: unknown): string {
  if (value == null) return '';
  if (definition.type === 'checkbox') return (value as boolean) ? 'Sim' : 'Não';
  if (definition.type === 'date') {
    try {
      return new Date(value as string).toLocaleDateString('pt-BR');
    } catch { return value as string; }
  }
  if (definition.type === 'number') {
    const fmt = (definition.config.format as string) ?? 'integer';
    const num = Number(value);
    if (fmt === 'currency') return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    if (fmt === 'percentage') return `${num}%`;
    if (fmt === 'decimal') return num.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    return String(Math.round(num));
  }
  if (definition.type === 'person') {
    const v = value as { membro_id?: number; name?: string };
    return v.name ?? '';
  }
  return String(value);
}

export function PropertyValue({ definition, value: initialValue, postId, workflowId, membros }: Props) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [localValue, setLocalValue] = useState<unknown>(initialValue);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [newOptionLabel, setNewOptionLabel] = useState('');

  useEffect(() => { setLocalValue(initialValue); }, [initialValue]);

  // Fetch per-workflow select options (merged with template options)
  const { data: workflowOptions = [] } = useQuery({
    queryKey: ['workflow-select-options', workflowId, definition.id],
    queryFn: () => getWorkflowSelectOptions(workflowId, definition.id!),
    enabled: !!definition.id && (definition.type === 'select' || definition.type === 'multiselect' || definition.type === 'status'),
  });

  const allOptions: SelectOption[] = [
    ...((definition.config.options as SelectOption[]) ?? []),
    ...workflowOptions.map(wo => ({ id: wo.option_id, label: wo.label, color: wo.color })),
  ];

  const save = (val: unknown) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await upsertPostPropertyValue(postId, definition.id!, val);
        qc.invalidateQueries({ queryKey: ['workflow-posts-with-props'] });
      } catch { toast.error('Erro ao salvar propriedade'); }
    }, 1500);
  };

  const handleChange = (val: unknown) => {
    setLocalValue(val);
    save(val);
  };

  const handleAddOption = async () => {
    const label = newOptionLabel.trim();
    if (!label) return;
    try {
      const created = await createWorkflowSelectOption(workflowId, definition.id!, label, '#94a3b8');
      qc.invalidateQueries({ queryKey: ['workflow-select-options', workflowId, definition.id] });
      // For select, auto-select the new option
      if (definition.type === 'select' || definition.type === 'status') {
        handleChange(created.option_id);
      } else {
        handleChange([...((localValue as string[]) ?? []), created.option_id]);
      }
      setNewOptionLabel('');
    } catch { toast.error('Erro ao criar opção'); }
  };

  const renderInput = () => {
    if (definition.type === 'created_time') {
      // Computed — not editable
      return null;
    }

    if (definition.type === 'text' || definition.type === 'url' || definition.type === 'email' || definition.type === 'phone') {
      return (
        <input
          className="drawer-input"
          style={{ fontSize: '0.85rem', padding: '3px 6px' }}
          type={definition.type === 'email' ? 'email' : definition.type === 'url' ? 'url' : definition.type === 'phone' ? 'tel' : 'text'}
          value={(localValue as string) ?? ''}
          placeholder={`Inserir ${definition.name.toLowerCase()}…`}
          onChange={e => handleChange(e.target.value)}
          onBlur={() => setEditing(false)}
          autoFocus
        />
      );
    }

    if (definition.type === 'number') {
      return (
        <input
          className="drawer-input"
          style={{ fontSize: '0.85rem', padding: '3px 6px' }}
          type="number"
          value={(localValue as number) ?? ''}
          placeholder="0"
          onChange={e => handleChange(e.target.value === '' ? null : Number(e.target.value))}
          onBlur={() => setEditing(false)}
          autoFocus
        />
      );
    }

    if (definition.type === 'date') {
      return (
        <input
          className="drawer-input"
          style={{ fontSize: '0.85rem', padding: '3px 6px' }}
          type="date"
          value={(localValue as string) ?? ''}
          onChange={e => { handleChange(e.target.value); setEditing(false); }}
          autoFocus
        />
      );
    }

    if (definition.type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={!!localValue}
          onChange={e => { handleChange(e.target.checked); setEditing(false); }}
          style={{ cursor: 'pointer' }}
          autoFocus
        />
      );
    }

    if (definition.type === 'select' || definition.type === 'status') {
      return (
        <div>
          <select
            className="drawer-select"
            style={{ fontSize: '0.82rem', padding: '3px 6px' }}
            value={(localValue as string) ?? ''}
            onChange={e => { handleChange(e.target.value || null); setEditing(false); }}
            autoFocus
          >
            <option value="">Nenhum</option>
            {allOptions.map(opt => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            <input
              className="drawer-input"
              placeholder="+ Nova opção"
              value={newOptionLabel}
              onChange={e => setNewOptionLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddOption(); } }}
              style={{ fontSize: '0.75rem', padding: '2px 6px' }}
            />
          </div>
        </div>
      );
    }

    if (definition.type === 'multiselect') {
      const selected = (localValue as string[]) ?? [];
      return (
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
            {allOptions.map(opt => {
              const isSelected = selected.includes(opt.id);
              return (
                <button
                  key={opt.id}
                  onClick={() => {
                    const next = isSelected ? selected.filter(id => id !== opt.id) : [...selected, opt.id];
                    handleChange(next);
                  }}
                  style={{
                    padding: '2px 8px', borderRadius: 12, fontSize: '0.75rem', cursor: 'pointer',
                    background: isSelected ? opt.color : 'transparent',
                    color: isSelected ? 'white' : 'inherit',
                    border: `1px solid ${opt.color}`,
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              className="drawer-input"
              placeholder="+ Nova opção"
              value={newOptionLabel}
              onChange={e => setNewOptionLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddOption(); } }}
              style={{ fontSize: '0.75rem', padding: '2px 6px' }}
            />
          </div>
        </div>
      );
    }

    if (definition.type === 'person') {
      const val = (localValue as { membro_id?: number; name?: string }) ?? {};
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <select
            className="drawer-select"
            style={{ fontSize: '0.82rem', padding: '3px 6px' }}
            value={val.membro_id ?? ''}
            onChange={e => {
              if (e.target.value) {
                const m = membros.find(m => m.id === Number(e.target.value));
                handleChange({ membro_id: Number(e.target.value), name: m?.nome ?? '' });
              } else {
                handleChange(null);
              }
              setEditing(false);
            }}
          >
            <option value="">Selecionar membro…</option>
            {membros.map(m => (
              <option key={m.id} value={m.id}>{m.nome}</option>
            ))}
          </select>
          <input
            className="drawer-input"
            placeholder="Ou nome externo…"
            value={val.membro_id ? '' : (val.name ?? '')}
            onChange={e => handleChange({ name: e.target.value })}
            style={{ fontSize: '0.82rem', padding: '3px 6px' }}
            onBlur={() => setEditing(false)}
          />
        </div>
      );
    }

    return null;
  };

  const renderDisplay = () => {
    if (definition.type === 'created_time') {
      return <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Auto</span>;
    }
    if (localValue == null || localValue === '' || (Array.isArray(localValue) && localValue.length === 0)) {
      return <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Vazio</span>;
    }
    if (definition.type === 'checkbox') {
      return <span style={{ fontSize: '0.82rem' }}>{(localValue as boolean) ? '☑ Sim' : '☐ Não'}</span>;
    }
    if (definition.type === 'select' || definition.type === 'status') {
      const opt = allOptions.find(o => o.id === localValue);
      if (!opt) return <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Vazio</span>;
      return (
        <span style={{
          fontSize: '0.75rem', padding: '2px 8px', borderRadius: 12,
          background: opt.color + '22', color: opt.color, border: `1px solid ${opt.color}55`,
        }}>
          {opt.label}
        </span>
      );
    }
    if (definition.type === 'multiselect') {
      const selected = (localValue as string[]).map(id => allOptions.find(o => o.id === id)).filter(Boolean) as SelectOption[];
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {selected.map(opt => (
            <span key={opt.id} style={{
              fontSize: '0.75rem', padding: '2px 8px', borderRadius: 12,
              background: opt.color + '22', color: opt.color, border: `1px solid ${opt.color}55`,
            }}>
              {opt.label}
            </span>
          ))}
        </div>
      );
    }
    if (definition.type === 'url') {
      return (
        <a href={localValue as string} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.82rem', color: 'var(--primary)' }}>
          {(localValue as string).replace(/^https?:\/\//, '')}
        </a>
      );
    }
    return <span style={{ fontSize: '0.82rem' }}>{formatDisplayValue(definition, localValue)}</span>;
  };

  const isEditable = definition.type !== 'created_time';

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      padding: '5px 0', borderBottom: '1px solid var(--border-color, #f1f5f9)',
      fontSize: '0.85rem',
    }}>
      <div style={{ width: '40%', color: 'var(--text-muted)', paddingTop: 3, flexShrink: 0, fontSize: '0.82rem' }}>
        {definition.name}
      </div>
      <div style={{ flex: 1 }}>
        {editing && isEditable
          ? renderInput()
          : (
            <div
              onClick={() => isEditable && setEditing(true)}
              style={{ cursor: isEditable ? 'pointer' : 'default', minHeight: 22, borderRadius: 4, padding: '2px 4px', transition: 'background 0.1s' }}
              onMouseEnter={e => isEditable && ((e.currentTarget as HTMLDivElement).style.background = 'var(--hover-bg, #f1f5f9)')}
              onMouseLeave={e => ((e.currentTarget as HTMLDivElement).style.background = 'transparent')}
            >
              {renderDisplay()}
            </div>
          )
        }
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/entregas/components/PropertyValue.tsx
git commit -m "feat: add PropertyValue component with all 12 input types"
```

---

## Task 6: PropertyPanel Component

**Files:**
- Create: `src/pages/entregas/components/PropertyPanel.tsx`

Container that renders the properties block in the post drawer. Queries definitions itself, renders `PropertyValue` for each.

- [ ] **Step 1: Create the component**

```tsx
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { getPropertyDefinitions, type PostPropertyValue, type Membro } from '../../../store';
import { PropertyValue } from './PropertyValue';
import { PropertyDefinitionPanel } from './PropertyDefinitionPanel';

interface Props {
  templateId: number;
  postId: number;
  workflowId: number;
  propertyValues: PostPropertyValue[];
  membros: Membro[];
}

export function PropertyPanel({ templateId, postId, workflowId, propertyValues, membros }: Props) {
  const qc = useQueryClient();
  const [showPanel, setShowPanel] = useState(false);

  const { data: definitions = [] } = useQuery({
    queryKey: ['property-definitions', templateId],
    queryFn: () => getPropertyDefinitions(templateId),
  });

  if (definitions.length === 0 && !showPanel) {
    return (
      <div style={{ marginBottom: '0.75rem' }}>
        <button
          onClick={() => setShowPanel(true)}
          style={{
            background: 'none', border: '1px dashed var(--border-color, #e2e8f0)',
            borderRadius: 6, padding: '4px 10px', fontSize: '0.78rem',
            color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          <Plus className="h-3 w-3" /> Adicionar propriedade
        </button>
        {showPanel && (
          <PropertyDefinitionPanel
            templateId={templateId}
            onSave={() => {
              setShowPanel(false);
              qc.invalidateQueries({ queryKey: ['property-definitions', templateId] });
              qc.invalidateQueries({ queryKey: ['workflow-posts-with-props', workflowId] });
            }}
            onClose={() => setShowPanel(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: '1rem' }}>
      <div style={{
        background: 'var(--card-bg-secondary, #f8fafc)',
        border: '1px solid var(--border-color, #e2e8f0)',
        borderRadius: 8, padding: '10px 12px', marginBottom: 4,
      }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
          Propriedades
        </div>
        {definitions.map(def => {
          const pv = propertyValues.find(v => v.property_definition_id === def.id);
          return (
            <PropertyValue
              key={def.id}
              definition={def}
              value={pv?.value ?? null}
              postId={postId}
              workflowId={workflowId}
              membros={membros}
            />
          );
        })}
        <button
          onClick={() => setShowPanel(true)}
          style={{
            background: 'none', border: 'none', padding: '5px 0 0', fontSize: '0.78rem',
            color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2,
          }}
        >
          <Plus className="h-3 w-3" /> Adicionar propriedade
        </button>
      </div>

      {showPanel && (
        <PropertyDefinitionPanel
          templateId={templateId}
          onSave={() => {
            setShowPanel(false);
            qc.invalidateQueries({ queryKey: ['property-definitions', templateId] });
            qc.invalidateQueries({ queryKey: ['workflow-posts-with-props', workflowId] });
          }}
          onClose={() => setShowPanel(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/entregas/components/PropertyPanel.tsx
git commit -m "feat: add PropertyPanel component for post drawer"
```

---

## Task 7: Add PropertyPanel to WorkflowDrawer

**Files:**
- Modify: `src/pages/entregas/components/WorkflowDrawer.tsx`

Three changes: (1) switch to `getWorkflowPostsWithProperties`, (2) pass `property_values` down to `SortablePostItem`, (3) render `PropertyPanel` above `PostEditor` in the expanded post view.

- [ ] **Step 1: Update imports in `WorkflowDrawer.tsx`**

Find the existing imports block and add `getWorkflowPostsWithProperties` and `PropertyPanel`:

```tsx
// Replace the getWorkflowPosts import line with:
import {
  getWorkflowPostsWithProperties, addWorkflowPost, updateWorkflowPost, removeWorkflowPost,
  reorderWorkflowPosts, sendPostsToCliente, getPostApprovals, replyToPostApproval,
  completeEtapa,
  type WorkflowPost, type PostApproval, type Membro,
} from '../../../store';
import { PropertyPanel } from './PropertyPanel';
```

- [ ] **Step 2: Update the posts query (around line 76)**

```tsx
// Replace:
const { data: posts = [], isLoading } = useQuery({
  queryKey: ['workflow-posts', workflowId],
  queryFn: () => getWorkflowPosts(workflowId),
});

// With:
const { data: posts = [], isLoading } = useQuery({
  queryKey: ['workflow-posts-with-props', workflowId],
  queryFn: () => getWorkflowPostsWithProperties(workflowId),
});
```

- [ ] **Step 3: Update `refresh` to also invalidate the new query key (around line 94)**

```tsx
const refresh = useCallback(() => {
  setLocalOrder(null);
  qc.invalidateQueries({ queryKey: ['workflow-posts-with-props', workflowId] });
  qc.invalidateQueries({ queryKey: ['post-approvals'] });
}, [qc, workflowId]);
```

- [ ] **Step 4: Pass `property_values` and `templateId` to `SortablePostItem`**

In the `SortablePostItemProps` interface (around line 347), add two fields:

```tsx
interface SortablePostItemProps {
  // existing fields...
  post: WorkflowPost & { property_values?: import('../../../store').PostPropertyValue[] };
  templateId: number | null | undefined;
  workflowId: number;
  membros: Membro[];
  // ...rest of existing fields
}
```

In the JSX where `SortablePostItem` is rendered (around line 303), add the new props:

```tsx
<SortablePostItem
  key={post.id}
  post={post}
  templateId={card.workflow.template_id}
  workflowId={workflowId}
  isExpanded={expandedId === post.id}
  isSaving={savingIds.has(post.id!)}
  approvals={approvals.filter(a => a.post_id === post.id)}
  membros={membros}
  replyText={replyText[post.id!] || ''}
  sendingReply={sendingReply === post.id}
  onToggle={() => setExpandedId(expandedId === post.id ? null : post.id!)}
  onDelete={() => handleDeletePost(post.id!)}
  onFieldChange={(field, value) => handleFieldChange(post.id!, field, value)}
  onContentUpdate={(json, plain) => scheduleContentSave(post, json, plain)}
  onReplyChange={text => setReplyText(prev => ({ ...prev, [post.id!]: text }))}
  onReplySend={() => handleReply(post.id!)}
/>
```

- [ ] **Step 5: Update `SortablePostItem` function signature to accept new props**

```tsx
function SortablePostItem({
  post, templateId, workflowId, isExpanded, isSaving, approvals, membros,
  replyText, sendingReply,
  onToggle, onDelete, onFieldChange, onContentUpdate, onReplyChange, onReplySend,
}: SortablePostItemProps) {
```

- [ ] **Step 6: Add `PropertyPanel` above `PostEditor` in the expanded content (around line 475)**

Find the `PostEditor` usage and add `PropertyPanel` immediately before it:

```tsx
{/* Custom properties — shown when template has properties defined */}
{templateId && (
  <PropertyPanel
    templateId={templateId}
    postId={post.id!}
    workflowId={workflowId}
    propertyValues={(post as any).property_values ?? []}
    membros={membros}
  />
)}

<PostEditor
  key={post.id}
  initialContent={post.conteudo}
  disabled={isReadonly}
  onUpdate={onContentUpdate}
/>
```

- [ ] **Step 7: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Verify in browser**

Run `npm run dev`. Open a workflow that was created from a template. Open the post drawer and expand a post. The properties panel should appear above the editor. Clicking "+ Adicionar propriedade" should open the slide-in panel. After creating a property, it should appear in the panel for all posts in the drawer.

- [ ] **Step 9: Commit**

```bash
git add src/pages/entregas/components/WorkflowDrawer.tsx
git commit -m "feat: integrate PropertyPanel into WorkflowDrawer"
```

---

## Task 8: Add Propriedades Tab to TemplatesModal

**Files:**
- Modify: `src/pages/entregas/components/WorkflowModals.tsx`

Add a "Propriedades" tab to `TemplatesModal`. The tab lists all property definitions for the selected template with drag-to-reorder, edit, and delete actions.

- [ ] **Step 1: Add new imports to `WorkflowModals.tsx`**

```tsx
// Add to existing imports:
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Settings } from 'lucide-react';
import {
  getPropertyDefinitions, deletePropertyDefinition, updatePropertyDefinition,
  type TemplatePropertyDefinition,
} from '../../../store';
import { PropertyDefinitionPanel } from './PropertyDefinitionPanel';
```

- [ ] **Step 2: Add state and tab logic inside `TemplatesModal`**

Inside the `TemplatesModal` function body, after the existing state declarations, add:

```tsx
const qc = useQueryClient();
const [activeTab, setActiveTab] = useState<'templates' | 'properties'>('templates');
const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
const [showDefPanel, setShowDefPanel] = useState(false);
const [editingDef, setEditingDef] = useState<TemplatePropertyDefinition | undefined>(undefined);
const [deletingDefId, setDeletingDefId] = useState<number | null>(null);

const { data: propertyDefinitions = [] } = useQuery({
  queryKey: ['property-definitions', selectedTemplateId],
  queryFn: () => getPropertyDefinitions(selectedTemplateId!),
  enabled: !!selectedTemplateId,
});

const handleDeleteDefinition = async () => {
  if (!deletingDefId) return;
  try {
    await deletePropertyDefinition(deletingDefId);
    toast.success('Propriedade excluída.');
    qc.invalidateQueries({ queryKey: ['property-definitions', selectedTemplateId] });
  } catch { toast.error('Erro ao excluir propriedade.'); }
  setDeletingDefId(null);
};
```

- [ ] **Step 3: Add the "Propriedades" tab header to the modal**

In the `TemplatesModal` JSX, just before the `<div style={{ marginBottom: '1rem' }}>` that lists templates (around line 495), add the tab navigation and template selector for the properties tab:

```tsx
{/* Tab navigation */}
<div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-color)', marginBottom: '1rem' }}>
  <button
    onClick={() => setActiveTab('templates')}
    style={{
      padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.9rem',
      borderBottom: activeTab === 'templates' ? '2px solid var(--primary, #1d4ed8)' : '2px solid transparent',
      color: activeTab === 'templates' ? 'var(--primary, #1d4ed8)' : 'inherit',
      fontWeight: activeTab === 'templates' ? 600 : 400, marginBottom: -1,
    }}
  >
    Templates
  </button>
  <button
    onClick={() => setActiveTab('properties')}
    style={{
      padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.9rem',
      borderBottom: activeTab === 'properties' ? '2px solid var(--primary, #1d4ed8)' : '2px solid transparent',
      color: activeTab === 'properties' ? 'var(--primary, #1d4ed8)' : 'inherit',
      fontWeight: activeTab === 'properties' ? 600 : 400, marginBottom: -1,
    }}
  >
    <Settings className="h-3.5 w-3.5" style={{ display: 'inline', marginRight: 4 }} />
    Propriedades
  </button>
</div>
```

- [ ] **Step 4: Wrap existing templates list content with `activeTab === 'templates'` and add the properties tab content**

Wrap the existing template list `<div style={{ marginBottom: '1rem' }}>` and the form section in `{activeTab === 'templates' && (...)}`. Then add the properties tab:

```tsx
{activeTab === 'properties' && (
  <div>
    {/* Template selector for properties tab */}
    <div style={{ marginBottom: '1rem' }}>
      <Label style={{ fontSize: '0.8rem' }}>Selecionar template</Label>
      <select
        className="drawer-select"
        style={{ marginTop: 4, width: '100%' }}
        value={selectedTemplateId ?? ''}
        onChange={e => setSelectedTemplateId(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">Escolha um template…</option>
        {templates.map(t => (
          <option key={t.id} value={t.id}>{t.nome}</option>
        ))}
      </select>
    </div>

    {selectedTemplateId && (
      <>
        {propertyDefinitions.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
            Nenhuma propriedade definida neste template.
          </p>
        ) : (
          <div style={{ marginBottom: '0.75rem' }}>
            {propertyDefinitions.map(def => (
              <div
                key={def.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '7px 10px', background: 'var(--card-bg-secondary, #f8fafc)',
                  border: '1px solid var(--border-color)', borderRadius: 6, marginBottom: 4,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
                  <span style={{
                    background: 'var(--primary-light, #eff6ff)', color: 'var(--primary, #1d4ed8)',
                    padding: '1px 6px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600,
                  }}>
                    {def.type}
                  </span>
                  <span style={{ fontWeight: 500 }}>{def.name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {def.portal_visible && (
                    <span style={{
                      background: '#dcfce7', color: '#15803d',
                      padding: '1px 8px', borderRadius: 10, fontSize: '0.72rem',
                    }}>
                      Portal
                    </span>
                  )}
                  <Button
                    size="icon" variant="ghost"
                    onClick={() => { setEditingDef(def); setShowDefPanel(true); }}
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon" variant="ghost" className="text-destructive"
                    onClick={() => setDeletingDefId(def.id!)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <Button
          variant="outline" size="sm"
          style={{ borderStyle: 'dashed' }}
          onClick={() => { setEditingDef(undefined); setShowDefPanel(true); }}
        >
          + Adicionar propriedade
        </Button>
      </>
    )}

    {showDefPanel && selectedTemplateId && (
      <PropertyDefinitionPanel
        templateId={selectedTemplateId}
        definition={editingDef}
        onSave={() => {
          setShowDefPanel(false);
          setEditingDef(undefined);
          qc.invalidateQueries({ queryKey: ['property-definitions', selectedTemplateId] });
        }}
        onClose={() => { setShowDefPanel(false); setEditingDef(undefined); }}
      />
    )}
  </div>
)}
```

- [ ] **Step 5: Add delete confirmation dialog for property definitions**

Inside the `TemplatesModal` JSX (before the closing `</>` of the outer fragment), add:

```tsx
<AlertDialog open={deletingDefId !== null} onOpenChange={open => { if (!open) setDeletingDefId(null); }}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Excluir propriedade?</AlertDialogTitle>
      <AlertDialogDescription>
        Isso removerá os valores preenchidos em todos os posts deste template. Esta ação não pode ser desfeita.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancelar</AlertDialogCancel>
      <AlertDialogAction onClick={handleDeleteDefinition} className="bg-destructive text-destructive-foreground">
        Excluir
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Verify in browser**

Open the Templates modal. Click the "Propriedades" tab. Select a template. Click "+ Adicionar propriedade". Create a property. Verify it appears in the list. Click the edit button — the panel should re-open with existing values. Click delete — confirmation dialog should appear.

- [ ] **Step 8: Note on drag-to-reorder**

The spec mentions drag handles for reordering definitions. `display_order` is stored in the DB and `updatePropertyDefinition` supports updating it. Drag-to-reorder in the properties list (using the same dnd-kit pattern from `WorkflowDrawer`) is deferred as a follow-up enhancement — the current list renders in creation order and properties are primarily ordered at definition time. Add it using the same `DndContext` + `SortableContext` + `arrayMove` pattern already in `WorkflowDrawer.tsx`.

- [ ] **Step 9: Commit**

```bash
git add src/pages/entregas/components/WorkflowModals.tsx
git commit -m "feat: add Propriedades tab to TemplatesModal"
```

---

## Task 9: PortalPropertyTable Component

**Files:**
- Create: `src/pages/portal/PortalPropertyTable.tsx`

Read-only labeled property table for the client portal. Receives pre-filtered (portal-visible) definitions and values.

- [ ] **Step 1: Create the component**

```tsx
interface PortalPropertyDef {
  id: number;
  name: string;
  type: string;
  config: Record<string, unknown>;
  display_order: number;
}

interface PortalSelectOption {
  id: string;
  label: string;
  color: string;
}

interface PortalPropertyValue {
  property_definition_id: number;
  value: unknown;
}

interface PortalWorkflowSelectOption {
  option_id: string;
  property_definition_id: number;
  label: string;
  color: string;
}

interface Props {
  definitions: PortalPropertyDef[];
  values: PortalPropertyValue[]; // pre-filtered to this post's values by the parent
  selectOptions: PortalWorkflowSelectOption[]; // per-workflow additions
}

function renderPortalValue(
  def: PortalPropertyDef,
  value: unknown,
  selectOptions: PortalWorkflowSelectOption[]
): React.ReactNode {
  if (value == null || value === '') {
    return <span style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '0.85rem' }}>—</span>;
  }

  const allOptions: PortalSelectOption[] = [
    ...((def.config.options as PortalSelectOption[]) ?? []),
    ...selectOptions
      .filter(o => o.property_definition_id === def.id)
      .map(o => ({ id: o.option_id, label: o.label, color: o.color })),
  ];

  if (def.type === 'checkbox') {
    return <span style={{ fontSize: '0.85rem' }}>{(value as boolean) ? '✓ Sim' : '✗ Não'}</span>;
  }

  if (def.type === 'select' || def.type === 'status') {
    const opt = allOptions.find(o => o.id === value);
    if (!opt) return <span style={{ fontSize: '0.85rem' }}>{String(value)}</span>;
    return (
      <span style={{
        fontSize: '0.75rem', padding: '2px 10px', borderRadius: 12,
        background: opt.color + '22', color: opt.color, border: `1px solid ${opt.color}55`,
      }}>
        {opt.label}
      </span>
    );
  }

  if (def.type === 'multiselect') {
    const selected = (value as string[])
      .map(id => allOptions.find(o => o.id === id))
      .filter(Boolean) as PortalSelectOption[];
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {selected.map(opt => (
          <span key={opt.id} style={{
            fontSize: '0.75rem', padding: '2px 10px', borderRadius: 12,
            background: opt.color + '22', color: opt.color, border: `1px solid ${opt.color}55`,
          }}>
            {opt.label}
          </span>
        ))}
      </div>
    );
  }

  if (def.type === 'date') {
    try {
      return <span style={{ fontSize: '0.85rem' }}>{new Date(value as string).toLocaleDateString('pt-BR')}</span>;
    } catch {
      return <span style={{ fontSize: '0.85rem' }}>{String(value)}</span>;
    }
  }

  if (def.type === 'url') {
    return (
      <a href={value as string} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.85rem', color: '#3b82f6' }}>
        {(value as string).replace(/^https?:\/\//, '')}
      </a>
    );
  }

  if (def.type === 'number') {
    const fmt = (def.config.format as string) ?? 'integer';
    const num = Number(value);
    if (fmt === 'currency') return <span style={{ fontSize: '0.85rem' }}>{num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>;
    if (fmt === 'percentage') return <span style={{ fontSize: '0.85rem' }}>{num}%</span>;
    return <span style={{ fontSize: '0.85rem' }}>{String(value)}</span>;
  }

  if (def.type === 'person') {
    const v = value as { name?: string };
    return <span style={{ fontSize: '0.85rem' }}>{v.name ?? '—'}</span>;
  }

  return <span style={{ fontSize: '0.85rem' }}>{String(value)}</span>;
}

export function PortalPropertyTable({ definitions, values, selectOptions }: Props) {
  if (definitions.length === 0) return null;

  const sorted = [...definitions].sort((a, b) => a.display_order - b.display_order);

  return (
    <div style={{
      background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
      padding: '10px 14px', marginBottom: 14,
    }}>
      {sorted.map(def => {
        const pv = values.find(v => v.property_definition_id === def.id);
        return (
          <div
            key={def.id}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 12,
              padding: '5px 0', borderBottom: '1px solid #f1f5f9', fontSize: '0.9rem',
            }}
          >
            <div style={{ width: '40%', color: '#64748b', fontSize: '0.82rem', paddingTop: 2, flexShrink: 0 }}>
              {def.name}
            </div>
            <div style={{ flex: 1 }}>
              {renderPortalValue(def, pv?.value ?? null, selectOptions)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/portal/PortalPropertyTable.tsx
git commit -m "feat: add PortalPropertyTable read-only component"
```

---

## Task 10: Extend PortalPage with Property Table

**Files:**
- Modify: `src/pages/portal/PortalPage.tsx`

- [ ] **Step 1: Add import for `PortalPropertyTable`**

```tsx
import { PortalPropertyTable } from './PortalPropertyTable';
```

- [ ] **Step 2: Update the `PortalData` type to include property fields**

Find the interface or type that defines the shape of `data` received from the `portal-data` edge function (look for an interface with fields like `posts`, `etapas`, `approvals`). Add:

```ts
propertyDefinitions?: Array<{
  id: number;
  name: string;
  type: string;
  config: Record<string, unknown>;
  display_order: number;
}>;
propertyValues?: Array<{
  property_definition_id: number;
  post_id: number;
  value: unknown;
}>;
selectOptions?: Array<{
  option_id: string;
  property_definition_id: number;
  label: string;
  color: string;
}>;
```

- [ ] **Step 3: Add `PortalPropertyTable` above the post content**

Find the section that renders each post (around line 435 where `post.conteudo_plain` is rendered). Add `PortalPropertyTable` immediately before `post.conteudo_plain`:

```tsx
{/* Custom properties (portal-visible only) */}
{(data.propertyDefinitions ?? []).length > 0 && (
  <PortalPropertyTable
    definitions={data.propertyDefinitions ?? []}
    values={(data.propertyValues ?? []).filter((v: any) => v.post_id === post.id)}
    selectOptions={data.selectOptions ?? []}
  />
)}

{post.conteudo_plain && (
  <p className="portal-post-content">{post.conteudo_plain}</p>
)}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/portal/PortalPage.tsx
git commit -m "feat: add PortalPropertyTable to PortalPage"
```

---

## Task 11: Extend portal-data Edge Function

**Files:**
- Modify: `supabase/functions/portal-data/index.ts`

- [ ] **Step 1: Add `template_id` to the workflow select and fetch portal-visible properties**

The current workflow query (around line 50) selects several fields but not `template_id`. Add it:

```ts
// Replace:
const { data: workflow, error: wfErr } = await db
  .from("workflows")
  .select("titulo, status, etapa_atual, link_notion, link_drive, created_at, cliente_id, conta_id")
  .eq("id", tokenRow.workflow_id)
  .single();

// With:
const { data: workflow, error: wfErr } = await db
  .from("workflows")
  .select("titulo, status, etapa_atual, link_notion, link_drive, created_at, cliente_id, conta_id, template_id")
  .eq("id", tokenRow.workflow_id)
  .single();
```

- [ ] **Step 2: Add property data fetching after step 8 (post approvals)**

Find the comment `// 8. Fetch post approvals for visible posts` block and add the following after the `postApprovals` assignment:

```ts
// 9. Fetch portal-visible property definitions + values
let propertyDefinitions: unknown[] = [];
let propertyValues: unknown[] = [];
let selectOptions: unknown[] = [];

const templateId = (workflow as any).template_id;
if (templateId && visiblePostIds.length > 0) {
  const { data: defs } = await db
    .from("template_property_definitions")
    .select("id, name, type, config, display_order")
    .eq("template_id", templateId)
    .eq("portal_visible", true)
    .order("display_order", { ascending: true });
  propertyDefinitions = defs || [];

  if (propertyDefinitions.length > 0) {
    const defIds = (propertyDefinitions as any[]).map((d: any) => d.id);

    const { data: vals } = await db
      .from("post_property_values")
      .select("post_id, property_definition_id, value")
      .in("post_id", visiblePostIds)
      .in("property_definition_id", defIds);
    propertyValues = vals || [];

    const { data: opts } = await db
      .from("workflow_select_options")
      .select("option_id, property_definition_id, label, color")
      .eq("workflow_id", tokenRow.workflow_id)
      .in("property_definition_id", defIds);
    selectOptions = opts || [];
  }
}
```

- [ ] **Step 3: Add property data to the return JSON**

```ts
// Replace the return json(...) call with:
return json({
  workflow: workflowSafe,
  etapas: etapas || [],
  approvals: approvals || [],
  posts: posts || [],
  postApprovals,
  propertyDefinitions,
  propertyValues,
  selectOptions,
  cliente_nome: cliente?.nome || "Cliente",
  workspace: {
    name: ws?.name || "Workspace",
    logo_url: ws?.logo_url || null,
  },
});
```

- [ ] **Step 4: Strip `template_id` from `workflowSafe`**

The `workflowSafe` destructuring currently strips `cliente_id` and `conta_id`. Also strip `template_id` (internal FK, clients don't need it):

```ts
// Replace:
const { cliente_id: _, conta_id: _cid, ...workflowSafe } = workflow;

// With:
const { cliente_id: _, conta_id: _cid, template_id: _tid, ...workflowSafe } = workflow;
```

- [ ] **Step 5: Deploy the edge function**

```bash
npx supabase functions deploy portal-data
```

Expected: deployment succeeds.

- [ ] **Step 6: Verify in browser**

Create a workflow from a template that has portal-visible properties. Mark some posts as `enviado_cliente`. Share the portal link. Open the portal link. Verify property values appear above the post content in the labeled table format.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/portal-data/index.ts
git commit -m "feat: extend portal-data edge function with property definitions and values"
```

---

## Task 12: Final Integration Smoke Test

- [ ] **Step 1: Full type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 2: End-to-end verification checklist**

Run `npm run dev` and verify all of the following manually:

1. **Template → Propriedades tab**: Open Templates modal → Propriedades tab → select a template → "+ Adicionar propriedade" → create a "Seleção" property called "Plataforma" with options Instagram / TikTok / LinkedIn, mark as "Visível no portal" → save. Verify it appears in the list with the "Portal" badge.

2. **Post drawer — properties panel**: Open a workflow created from that template → expand a post → properties panel appears above the editor → "Plataforma" field shows as empty → click the field → select dropdown appears → choose "Instagram" → wait 1.5 seconds → close and re-open: value should persist (reload page to confirm DB saved).

3. **Add new select option on-the-fly**: In the post drawer, open "Plataforma" → type "YouTube" in the new option field → press Enter → "YouTube" appears in the dropdown. Check another post in the same drawer — "YouTube" should also appear there.

4. **Workflow without template**: Open a workflow with `template_id = null` → expand a post → no properties panel shown (graceful no-op).

5. **Property definition edit**: In Templates modal → Propriedades tab → edit "Plataforma" → rename to "Rede Social" → save → verify the name updates in the post drawer too (React Query cache invalidation).

6. **Portal visibility**: Create a "Designer Responsável" (Person type) property on the template with "Visível no portal" unchecked. Fill it in on a post. Share the portal link. Verify "Plataforma" / "Rede Social" appears in the portal but "Designer Responsável" does not.

7. **Property deletion**: Delete "Rede Social" from the template — confirm dialog appears → confirm → verify it disappears from post drawers and values are gone.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: custom properties for workflow posts — Phase 1 complete"
```
