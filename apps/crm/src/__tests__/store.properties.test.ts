import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase');

import * as supabaseModule from '../lib/supabase';
import * as store from '../store';

type MockedSupabaseModule = typeof supabaseModule & {
  __getSupabaseCalls: () => Array<{
    table: string;
    operation: string;
    payload?: unknown;
    modifiers: Array<{ method: string; args: unknown[] }>;
  }>;
  __queueSupabaseResult: (table: string, operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert', ...responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>) => void;
  __resetSupabaseMock: () => void;
  __setCurrentProfile: (profile: Record<string, unknown> | null) => void;
};

const mockedSupabase = supabaseModule as MockedSupabaseModule;

function getCalls(table: string, operation?: string) {
  return mockedSupabase.__getSupabaseCalls().filter((entry) => entry.table === table && (!operation || entry.operation === operation));
}

describe('store custom properties', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'owner',
      conta_id: 'conta-1',
    });
  });

  it('getPropertyDefinitions fetches by template_id ordered by display_order', async () => {
    mockedSupabase.__queueSupabaseResult('template_property_definitions', 'select', {
      data: [
        { id: 1, name: 'Status', type: 'select', display_order: 0 },
        { id: 2, name: 'Data', type: 'date', display_order: 1 },
      ],
      error: null,
    });

    const result = await store.getPropertyDefinitions(10);

    expect(result).toHaveLength(2);
    const call = getCalls('template_property_definitions', 'select').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['template_id', 10] });
    expect(call.modifiers).toContainEqual({ method: 'order', args: ['display_order', { ascending: true }] });
  });

  it('createPropertyDefinition inserts with template_id and conta_id', async () => {
    mockedSupabase.__queueSupabaseResult('template_property_definitions', 'insert', {
      data: { id: 3, name: 'Categoria', type: 'select', template_id: 10, conta_id: 'conta-1' },
      error: null,
    });

    const result = await store.createPropertyDefinition(10, {
      name: 'Categoria',
      type: 'select',
      config: { options: [] },
      portal_visible: true,
      display_order: 2,
    });

    expect(result).toMatchObject({ id: 3, name: 'Categoria' });
    const call = getCalls('template_property_definitions', 'insert').at(-1)!;
    expect(call.payload).toMatchObject({
      template_id: 10,
      conta_id: 'conta-1',
      name: 'Categoria',
    });
  });

  it('updatePropertyDefinition scopes update to conta_id', async () => {
    mockedSupabase.__queueSupabaseResult('template_property_definitions', 'update', {
      data: { id: 3, name: 'Tipo de Conteúdo' },
      error: null,
    });

    await store.updatePropertyDefinition(3, { name: 'Tipo de Conteúdo' });

    const call = getCalls('template_property_definitions', 'update').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 3] });
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['conta_id', 'conta-1'] });
  });

  it('updatePropertyDefinition throws when not found', async () => {
    mockedSupabase.__queueSupabaseResult('template_property_definitions', 'update', {
      data: null,
      error: null,
    });

    await expect(store.updatePropertyDefinition(999, { name: 'X' })).rejects.toThrow('Property definition not found');
  });

  it('deletePropertyDefinition scopes to conta_id', async () => {
    mockedSupabase.__queueSupabaseResult('template_property_definitions', 'delete', { data: null, error: null });

    await store.deletePropertyDefinition(3);

    const call = getCalls('template_property_definitions', 'delete').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 3] });
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['conta_id', 'conta-1'] });
  });

  it('upsertPostPropertyValue uses upsert with onConflict', async () => {
    mockedSupabase.__queueSupabaseResult('post_property_values', 'upsert', { data: null, error: null });

    await store.upsertPostPropertyValue(100, 3, 'option-1');

    const call = getCalls('post_property_values', 'upsert').at(-1)!;
    expect(call.payload).toMatchObject({
      post_id: 100,
      property_definition_id: 3,
      value: 'option-1',
    });
    expect(call.payload).toHaveProperty('updated_at');
  });

  it('createWorkflowSelectOption inserts with conta_id', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_select_options', 'insert', {
      data: { id: 200, label: 'Em progresso', color: '#eab308', workflow_id: 5 },
      error: null,
    });

    const result = await store.createWorkflowSelectOption(5, 3, 'Em progresso', '#eab308');

    expect(result).toMatchObject({ label: 'Em progresso' });
    const call = getCalls('workflow_select_options', 'insert').at(-1)!;
    expect(call.payload).toMatchObject({
      workflow_id: 5,
      property_definition_id: 3,
      label: 'Em progresso',
      color: '#eab308',
      conta_id: 'conta-1',
    });
  });

  it('getWorkflowSelectOptions filters by workflow_id and definition_id', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_select_options', 'select', {
      data: [{ id: 200, label: 'Aprovado', color: '#3ecf8e' }],
      error: null,
    });

    const result = await store.getWorkflowSelectOptions(5, 3);

    expect(result).toHaveLength(1);
    const call = getCalls('workflow_select_options', 'select').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['workflow_id', 5] });
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['property_definition_id', 3] });
  });
});
