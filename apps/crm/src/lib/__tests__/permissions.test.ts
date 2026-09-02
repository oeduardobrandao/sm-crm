import { describe, expect, it } from 'vitest';
import { AGENT_PRESET, PERMISSION_MODULES, derivePermission } from '../permissions';
import { deriveFinancialAccess } from '../financialAccess';
import type { MyMembership } from '@/store/workspace';

const legacy = (role: MyMembership['role'], canFin = true): MyMembership => ({
  role,
  can_see_financials: canFin,
  role_id: null,
  permissions: null,
});
const custom = (permissions: Record<string, string>): MyMembership => ({
  role: 'agent',
  can_see_financials: true,
  role_id: 'r-1',
  permissions,
});

// Case ids TT-01..TT-16 are the verbatim ids from the task-2 brief, mirrored
// by supabase/tests/entitlements/72_workspace_roles_permissions.sql. TT-17..20
// are SQL-infrastructure cases (RLS grants, realtime publication, FK
// behaviour) with no TS equivalent, so they are not reproduced here.

// TT-01: owner, qualquer módulo/ação => true (financeiro/editar incluso)
it('TT-01: owner: tudo true', () => {
  for (const m of PERMISSION_MODULES) {
    expect(derivePermission(legacy('owner', false), m, 'ver')).toBe(true);
    expect(derivePermission(legacy('owner', false), m, 'editar')).toBe(true);
  }
});

// TT-02: admin legado, can_see_financials=true: financeiro/ver e
// financeiro/editar => true
it('TT-02: admin legado (can_see_financials=true): financeiro/ver e financeiro/editar true', () => {
  const m = legacy('admin', true);
  expect(derivePermission(m, 'financeiro', 'ver')).toBe(true);
  expect(derivePermission(m, 'financeiro', 'editar')).toBe(true);
});

// TT-03: admin legado, can_see_financials=false: financeiro/ver e
// financeiro/editar => false
it('TT-03: admin legado (can_see_financials=false): financeiro/ver e financeiro/editar false', () => {
  const m = legacy('admin', false);
  expect(derivePermission(m, 'financeiro', 'ver')).toBe(false);
  expect(derivePermission(m, 'financeiro', 'editar')).toBe(false);
});

// TT-04: admin legado, módulos fora de financeiro => true independente do flag
it('TT-04: admin legado fora de financeiro: sempre true independente do flag', () => {
  for (const canFin of [true, false]) {
    const m = legacy('admin', canFin);
    for (const mod of PERMISSION_MODULES) {
      if (mod === 'financeiro') continue;
      expect(derivePermission(m, mod, 'editar')).toBe(true);
    }
  }
});

// TT-05: agent legado: clientes/editar=true, tarefas/editar=true
it('TT-05: agent legado: clientes/editar e tarefas/editar true', () => {
  const m = legacy('agent');
  expect(derivePermission(m, 'clientes', 'editar')).toBe(true);
  expect(derivePermission(m, 'tarefas', 'editar')).toBe(true);
});

// TT-06: agent legado: analytics/ver=true, analytics/editar=false
it('TT-06: agent legado: analytics/ver true, analytics/editar false', () => {
  const m = legacy('agent');
  expect(derivePermission(m, 'analytics', 'ver')).toBe(true);
  expect(derivePermission(m, 'analytics', 'editar')).toBe(false);
});

// TT-07: agent legado: automacoes/ver=true, automacoes/editar=false
it('TT-07: agent legado: automacoes/ver true, automacoes/editar false', () => {
  const m = legacy('agent');
  expect(derivePermission(m, 'automacoes', 'ver')).toBe(true);
  expect(derivePermission(m, 'automacoes', 'editar')).toBe(false);
});

// TT-08: agent legado: leads/ver, financeiro/ver, equipe/ver, contratos/ver,
// configuracoes/ver => false
it('TT-08: agent legado: leads/ver, financeiro/ver, equipe/ver, contratos/ver, configuracoes/ver false', () => {
  const m = legacy('agent');
  expect(derivePermission(m, 'leads', 'ver')).toBe(false);
  expect(derivePermission(m, 'financeiro', 'ver')).toBe(false);
  expect(derivePermission(m, 'equipe', 'ver')).toBe(false);
  expect(derivePermission(m, 'contratos', 'ver')).toBe(false);
  expect(derivePermission(m, 'configuracoes', 'ver')).toBe(false);
});

// TT-05..08 paridade extra: iterar AGENT_PRESET inteiro contra o legado.
it('TT-05..08 paridade: agent legado segue AGENT_PRESET para TODOS os módulos', () => {
  const m = legacy('agent');
  for (const mod of PERMISSION_MODULES) {
    const level = AGENT_PRESET[mod];
    expect(derivePermission(m, mod, 'ver')).toBe(level === 'ver' || level === 'editar');
    expect(derivePermission(m, mod, 'editar')).toBe(level === 'editar');
  }
});

// TT-09: papel custom {"leads":"editar"}: leads/ver=true, leads/editar=true
it('TT-09: papel custom {leads:editar}: leads/ver e leads/editar true', () => {
  const m = custom({ leads: 'editar' });
  expect(derivePermission(m, 'leads', 'ver')).toBe(true);
  expect(derivePermission(m, 'leads', 'editar')).toBe(true);
});

// TT-10: papel custom {"leads":"ver"}: leads/ver=true, leads/editar=false
it('TT-10: papel custom {leads:ver}: leads/ver true, leads/editar false', () => {
  const m = custom({ leads: 'ver' });
  expect(derivePermission(m, 'leads', 'ver')).toBe(true);
  expect(derivePermission(m, 'leads', 'editar')).toBe(false);
});

// TT-11: papel custom {"leads":"none"}: leads/ver=false
it('TT-11: papel custom {leads:none}: leads/ver false', () => {
  const m = custom({ leads: 'none' });
  expect(derivePermission(m, 'leads', 'ver')).toBe(false);
});

// TT-12: papel custom, módulo ausente do jsonb: clientes/ver=false (falha
// fechada). O jsonb do papel só tem a chave "leads".
it('TT-12: papel custom com módulo ausente do jsonb falha fechado (clientes/ver false)', () => {
  const m = custom({ leads: 'editar' });
  expect(derivePermission(m, 'clientes', 'ver')).toBe(false);
});

// TT-13: papel custom {}: tudo false
it('TT-13: papel custom {}: tudo false', () => {
  const m = custom({});
  expect(derivePermission(m, 'leads', 'ver')).toBe(false);
  expect(derivePermission(m, 'financeiro', 'ver')).toBe(false);
  expect(derivePermission(m, 'clientes', 'editar')).toBe(false);
});

// TT-14: sem membership => false na SQL (nenhuma linha em workspace_members).
// No cliente essa condição nunca aparece como "linha ausente": membership só
// é null enquanto a hidratação não resolveu (ou falhou), um estado distinto
// que o resto do AuthContext já trata como 'unknown' (ver membershipResolved
// e deriveFinancialAccess). Por isso o equivalente TS de "sem membership" é
// 'unknown', não false — 'false' aqui fecharia a UI para um owner real ainda
// carregando, exatamente o que o tri-state existe para evitar.
it("TT-14 (equivalente TS): membership null => 'unknown', não false", () => {
  for (const m of PERMISSION_MODULES) {
    expect(derivePermission(null, m, 'ver')).toBe('unknown');
    expect(derivePermission(null, m, 'editar')).toBe('unknown');
  }
});

// TT-15 na SQL: ação inválida ('excluir') => false mesmo para owner (a query
// valida a ação ANTES de resolver o papel); módulo inexistente ('xyz') =>
// false para agent.
//
// No mirror TS a metade "módulo inválido" é idêntica: o PERMISSION_MODULES
// check roda antes de qualquer resolução de papel (mesma posição do SQL), e
// nem owner escapa dele — testado abaixo para os dois papéis.
//
// A metade "ação inválida" NÃO tem equivalente comportamental aqui: `action`
// é tipado como `PermissionAction = 'ver' | 'editar'` a nível de TypeScript, e
// derivePermission (verbatim do brief) não repete essa validação em runtime —
// só faz sentido na SQL porque o parâmetro chega como texto solto. Nenhum
// chamador tipado do app pode produzir uma ação inválida; o único jeito de
// simular uma aqui é um cast (`as unknown as`) que contorna o compilador, o
// que não é um cenário real. Documentado em vez de forçado: um owner com uma
// ação "inválida" via cast continua resolvendo para `true`, porque a branch
// do owner (`if (membership.role === 'owner') return true;`) não olha para
// `action` — por isso o teste abaixo verifica o comportamento REAL do mirror,
// não a garantia SQL, que TypeScript já garante de outra forma (em
// compile-time, não em runtime).
it('TT-15: módulo inválido => false para qualquer papel (ação inválida é inatingível sob o tipo PermissionAction)', () => {
  const badModule = 'xyz' as unknown as (typeof PERMISSION_MODULES)[number];
  expect(derivePermission(legacy('agent'), badModule, 'ver')).toBe(false);
  expect(derivePermission(legacy('owner'), badModule, 'ver')).toBe(false);

  const badAction = 'excluir' as unknown as 'ver' | 'editar';
  // Divergência documentada acima: SQL nega, o mirror TS (verbatim) não
  // valida `action` em runtime porque o tipo já fecha essa porta em todo
  // chamador real.
  expect(derivePermission(legacy('owner'), 'clientes', badAction)).toBe(true);
});

// TT-16: papel custom em membro com role='agent' e can_see_financials=true:
// financeiro/ver segue o PAPEL (false, ausente do jsonb {}), o flag legado é
// ignorado assim que role_id resolve para um papel.
it('TT-16: papel custom ignora o flag can_see_financials legado', () => {
  const m = custom({});
  expect(m.can_see_financials).toBe(true);
  expect(derivePermission(m, 'financeiro', 'ver')).toBe(false);
});

// Paridade extra: deriveFinancialAccess(m) === derivePermission(m, 'financeiro', 'ver')
// para as 6 formas de membership.
describe('paridade deriveFinancialAccess <-> derivePermission(financeiro, ver)', () => {
  const cases: Array<[string, MyMembership | null]> = [
    ['owner', legacy('owner', false)],
    ['admin com flag true', legacy('admin', true)],
    ['admin com flag false', legacy('admin', false)],
    ['agent legado', legacy('agent')],
    ['papel custom sem financeiro', custom({})],
    ['papel custom com financeiro:ver', custom({ financeiro: 'ver' })],
  ];

  for (const [label, membership] of cases) {
    it(`${label}: deriveFinancialAccess === derivePermission(financeiro, ver)`, () => {
      expect(deriveFinancialAccess(membership)).toBe(
        derivePermission(membership, 'financeiro', 'ver'),
      );
    });
  }
});

// Snapshot congelando AGENT_PRESET: uma mudança acidental do preset (que
// precisa ficar em sincronia com o preset hardcoded em SQL e em
// supabase/functions/_shared/permissions.ts) deve falhar este teste.
it('AGENT_PRESET snapshot (mudar aqui exige mudar SQL + edge function juntos)', () => {
  expect(AGENT_PRESET).toMatchInlineSnapshot(`
    {
      "analytics": "ver",
      "aprovacoes": "editar",
      "arquivos": "editar",
      "automacoes": "ver",
      "calendario": "editar",
      "clientes": "editar",
      "configuracoes": "none",
      "contratos": "none",
      "entregas": "editar",
      "equipe": "none",
      "financeiro": "none",
      "ideias": "editar",
      "leads": "none",
      "tarefas": "editar",
    }
  `);
});
