import { describe, expect, it } from 'vitest';
import { computePermissionTransitions, PERMISSION_MODULES } from '../permissions';
import { fakeMembership } from '@/test/makeCan';
import type { MyMembership } from '@/store/workspace';

const legacy = (role: MyMembership['role'], canFin = true): MyMembership =>
  fakeMembership({ role, can_see_financials: canFin, role_id: null, permissions: null });
const custom = (permissions: Record<string, string>): MyMembership =>
  fakeMembership({ role: 'agent', can_see_financials: true, role_id: 'r-1', permissions });

// computePermissionTransitions compares derivePermission(prev/next, module, 'ver')
// module-by-module — never a coarse role/flag comparison — so a change that
// only touches ONE module's permission never falsely flags every other
// module as transitioned too.

describe('computePermissionTransitions', () => {
  it('admin -> papel custom sem financeiro nem contratos: downgraded inclui financeiro e contratos, módulo a módulo (não um "perdeu tudo" genérico)', () => {
    const prev = legacy('admin', true); // sees everything, incl. financeiro/contratos
    const next = custom({ clientes: 'editar' }); // only clientes granted
    const { downgraded, upgraded } = computePermissionTransitions(prev, next);

    expect(downgraded).toEqual(
      expect.arrayContaining([
        'financeiro',
        'contratos',
        'equipe',
        'leads',
        'entregas',
        'calendario',
      ]),
    );
    // clientes stays true (admin already had it, custom role also grants it) — not a transition.
    expect(downgraded).not.toContain('clientes');
    expect(upgraded).toEqual([]);
  });

  it('papel ganha leads: upgraded=[leads], nada mais muda', () => {
    const prev = custom({ leads: 'none', clientes: 'editar' });
    const next = custom({ leads: 'editar', clientes: 'editar' });
    const { downgraded, upgraded } = computePermissionTransitions(prev, next);

    expect(upgraded).toEqual(['leads']);
    expect(downgraded).toEqual([]);
  });

  it('papel perde um módulo enquanto ganha outro: aparecem em listas separadas, não se cancelam', () => {
    const prev = custom({ leads: 'editar', ideias: 'none' });
    const next = custom({ leads: 'none', ideias: 'editar' });
    const { downgraded, upgraded } = computePermissionTransitions(prev, next);

    expect(downgraded).toEqual(['leads']);
    expect(upgraded).toEqual(['ideias']);
  });

  it('null -> membership resolvida (agent legado): tudo que o preset libera vira upgraded, o resto fica parado', () => {
    const { downgraded, upgraded } = computePermissionTransitions(null, legacy('agent'));

    expect(downgraded).toEqual([]);
    // AGENT_ROLE_PRESET libera clientes/entregas/calendario/... com 'ver' true.
    expect(upgraded).toEqual(expect.arrayContaining(['clientes', 'entregas', 'tarefas']));
    expect(upgraded).not.toContain('leads');
    expect(upgraded).not.toContain('financeiro');
  });

  it('membership resolvida -> null (removido do workspace): tudo que era true vira downgraded', () => {
    const { downgraded, upgraded } = computePermissionTransitions(legacy('owner'), null);

    // Owner via 'unknown' (derivePermission(null, ...) === 'unknown') para TODOS os módulos.
    expect(downgraded).toEqual([...PERMISSION_MODULES]);
    expect(upgraded).toEqual([]);
  });

  it('null -> null: nenhuma transição (unknown -> unknown não é upgrade nem downgrade)', () => {
    const { downgraded, upgraded } = computePermissionTransitions(null, null);
    expect(downgraded).toEqual([]);
    expect(upgraded).toEqual([]);
  });

  it('mesma membership (nenhuma mudança real): nenhuma transição em nenhum módulo', () => {
    const m = legacy('admin', true);
    const { downgraded, upgraded } = computePermissionTransitions(m, { ...m });
    expect(downgraded).toEqual([]);
    expect(upgraded).toEqual([]);
  });

  it('owner -> owner: nenhuma transição mesmo com can_see_financials mudando (owner ignora o flag)', () => {
    const { downgraded, upgraded } = computePermissionTransitions(
      legacy('owner', true),
      legacy('owner', false),
    );
    expect(downgraded).toEqual([]);
    expect(upgraded).toEqual([]);
  });

  it('papel custom com embed quebrado (permissions null apesar de role_id presente): tudo que estava true vira downgraded (falha fechada)', () => {
    const prev = custom({ leads: 'editar', clientes: 'editar' });
    const next: MyMembership = { ...prev, permissions: null };
    const { downgraded, upgraded } = computePermissionTransitions(prev, next);

    expect(downgraded).toEqual(expect.arrayContaining(['leads', 'clientes']));
    expect(upgraded).toEqual([]);
  });
});
