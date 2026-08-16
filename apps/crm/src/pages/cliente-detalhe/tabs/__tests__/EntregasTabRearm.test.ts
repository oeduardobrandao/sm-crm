import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Source-level pin for the approval re-arm wiring, migrated from
 * `ClienteDetalheRearm.test.ts` (see git history at commit d30adeea, before
 * the cliente-detalhe tabs split moved this logic into EntregasTab.tsx). The
 * original doc comment still applies: this pins the wiring, not the
 * behaviour. The behaviour itself is covered where it lives —
 * `pages/entregas/__tests__/advanceEtapa.test.ts` for the re-arm decision and
 * toasts, `views/__tests__/KanbanRearm.test.tsx` for the same handler shape
 * driven through a real UI, and `EntregasTab.test.tsx` (sibling file) for a
 * behavioural run of the same three paths through this tab specifically.
 */
const source = readFileSync('apps/crm/src/pages/cliente-detalhe/tabs/EntregasTab.tsx', 'utf8');

describe('EntregasTab approval re-arm wiring', () => {
  it('routes every advance through the shared advance helper', () => {
    expect(source).toContain(
      "import { completeEtapaForAdvance, notifyRearmOutcome } from '@/pages/entregas/advanceEtapa'",
    );
    expect(source).toMatch(/completeEtapaForAdvance\(/);
  });

  it('never calls the non-re-arming completeEtapa directly', () => {
    expect(source).not.toMatch(/\bawait completeEtapa\(/);
    expect(source).not.toMatch(/^\s*completeEtapa,$/m);
  });

  it('reports the re-arm outcome on the two re-arming paths only', () => {
    // Silent all-cleared advance + "Aprovar internamente". The third path opts out of re-arm,
    // so it has nothing to report.
    expect(source.match(/notifyRearmOutcome\(result\)/g)).toHaveLength(2);
  });

  it('opts the "sem alterar posts" path out of re-arm', () => {
    const advanceWithout = source.slice(
      source.indexOf('const handleAdvanceWithoutApproval'),
      source.indexOf('const handleRevertClick'),
    );
    expect(advanceWithout).toContain('{ rearm: false }');
    expect(advanceWithout).not.toContain('notifyRearmOutcome');
  });

  it('warns in the approval dialog when another approval etapa lies ahead', () => {
    expect(source).toContain('hasLaterApprovalEtapa');
    expect(source).toMatch(
      /willRearm=\{\s*approvalChoiceCard\s*\?\s*hasLaterApprovalEtapa\(\s*approvalChoiceCard\.allEtapas,\s*approvalChoiceCard\.etapa\.id!,?\s*\)\s*:\s*false\s*\}/,
    );
  });
});
