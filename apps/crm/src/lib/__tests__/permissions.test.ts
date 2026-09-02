import { describe, expect, it } from 'vitest';
import { AGENT_ROLE_PRESET, PERMISSION_MODULES, derivePermission } from '../permissions';
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

// TT-05..08 paridade extra: iterar AGENT_ROLE_PRESET inteiro contra o legado.
it('TT-05..08 paridade: agent legado segue AGENT_ROLE_PRESET para TODOS os módulos', () => {
  const m = legacy('agent');
  for (const mod of PERMISSION_MODULES) {
    const level = AGENT_ROLE_PRESET[mod];
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

// Não é um caso TT (não tem par no pgTAP 72, que nunca produz esta forma):
// role_id setado mas permissions null/undefined — o formato que uma falha de
// embed no getMyMembership() (RLS bloqueando o JOIN embutido, papel deletado
// entre o JOIN e a leitura, hiccup de rede) produziria. Regressão direta do
// bug fail-OPEN: a versão anterior de derivePermission chaveava em
// `permissions !== null`, então essa forma caía no fallback `agent`
// (AGENT_ROLE_PRESET), liberando 'editar' em 7 módulos para alguém que
// deveria estar restrito a um papel customizado. Correto é falhar FECHADO:
// tudo 'none' quando role_id aponta para um papel mas o conteúdo dele não
// chegou.
it('role_id setado + permissions null (falha de embed) => tudo false, NUNCA o fallback agent', () => {
  const m: MyMembership = {
    role: 'agent',
    can_see_financials: true,
    role_id: 'r-1',
    permissions: null,
  };
  for (const mod of PERMISSION_MODULES) {
    expect(derivePermission(m, mod, 'ver')).toBe(false);
    expect(derivePermission(m, mod, 'editar')).toBe(false);
  }
  // Especificamente os módulos que AGENT_ROLE_PRESET libera para o agent
  // legado — são exatamente os que um fail-open vazaria aqui.
  expect(derivePermission(m, 'clientes', 'editar')).toBe(false);
  expect(derivePermission(m, 'tarefas', 'editar')).toBe(false);
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
// valida a ação ANTES de resolver o papel, `IF p_action NOT IN ('ver','editar')
// THEN RETURN false`); módulo inexistente ('xyz') => false — pgTAP só exercita
// esta metade com um AGENT (`has_permission_for(v_agent, ...)`), nunca com
// owner.
//
// Isso importa porque a SQL NÃO tem um catálogo de módulos de verdade: owner
// (`IF v_role = 'owner' THEN RETURN true`) e admin fora de financeiro
// retornam antes de qualquer checagem de `p_module` — só a branch `agent`
// nega módulo desconhecido, via o `ELSE false` do seu CASE (e a branch de
// papel customizado, via `COALESCE(v_perms ->> p_module, 'none')`). Um
// `has_permission_for(owner, ws, 'xyz', 'ver')` de verdade retornaria `true`
// na SQL.
//
// O mirror TS (`derivePermission`) tem um `PERMISSION_MODULES.includes()`
// explícito logo no topo, ANTES de checar o papel — isso é uma divergência
// TS-side DELIBERADA (defesa em profundidade: nega módulo inválido para
// TODO papel, owner incluso), não paridade com a SQL. É por isso que o teste
// abaixo cobre agent E owner com módulo inválido: não é reproduzir o
// comportamento da SQL para owner (que seria `true`), é travar o
// comportamento mais estrito que este arquivo escolheu ter.
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
it('TT-15: módulo inválido => false para qualquer papel (checagem TS-only, mais estrita que a SQL); ação inválida é inatingível sob o tipo PermissionAction', () => {
  const badModule = 'xyz' as unknown as (typeof PERMISSION_MODULES)[number];
  // Este é o caso que a SQL de fato testa (TT-15, com agent) — o `ELSE
  // false` do CASE do agent nega módulo desconhecido.
  expect(derivePermission(legacy('agent'), badModule, 'ver')).toBe(false);
  // Este NÃO tem par na SQL: `has_permission_for(owner, ...)` retornaria
  // `true` para qualquer módulo, incluindo um inexistente, porque a branch
  // de owner roda antes de qualquer checagem de módulo. O mirror TS nega
  // aqui de propósito (guard mais estrito) — ver o comentário acima.
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

// Snapshot congelando AGENT_ROLE_PRESET: uma mudança acidental do preset
// (que precisa ficar em sincronia com o preset hardcoded na SQL, em
// public.has_permission_for — supabase/functions/_shared/permissions.ts NÃO
// tem preset próprio, é só catálogo + wrapper de RPC) deve falhar este teste.
it('AGENT_ROLE_PRESET snapshot (mudar aqui exige mudar public.has_permission_for junto)', () => {
  expect(AGENT_ROLE_PRESET).toMatchInlineSnapshot(`
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
