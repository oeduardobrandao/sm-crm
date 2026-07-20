import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * ClienteDetalhePage duplicates the Kanban advance paths, so it has to re-arm the approval
 * cycle the same way. The page is a ~2.5k-line component with no render harness in this
 * directory (every sibling test here is a source/CSS contract test for the same reason), so
 * this pins the wiring rather than the behaviour. The behaviour itself is covered where it
 * lives: `pages/entregas/__tests__/advanceEtapa.test.ts` for the re-arm decision and toasts,
 * and `views/__tests__/KanbanRearm.test.tsx` for the same handlers driven through a real UI.
 */
const source = readFileSync('apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx', 'utf8');

describe('ClienteDetalhePage approval re-arm wiring', () => {
  it('routes every advance through the shared advance helper', () => {
    expect(source).toContain(
      "import { completeEtapaForAdvance, notifyRearmOutcome } from '../entregas/advanceEtapa'",
    );
    // Three advance paths: silent all-cleared, approve-internally, advance-without-changes.
    expect(source.match(/completeEtapaForAdvance\(/g)).toHaveLength(3);
  });

  it('no longer calls the non-re-arming completeEtapa directly', () => {
    expect(source).not.toMatch(/\bawait completeEtapa\(/);
    expect(source).not.toMatch(/^\s*completeEtapa,$/m);
  });

  it('reports the re-arm outcome on the two re-arming paths only', () => {
    // Silent all-cleared advance + "Aprovar internamente". The third path opts out of re-arm,
    // so it has nothing to report.
    expect(source.match(/notifyRearmOutcome\(result\)/g)).toHaveLength(2);
  });

  it('opts the "sem alterar posts" path out of re-arm', () => {
    expect(source).toMatch(
      /toast\.success\('Etapa avançada — status dos posts mantidos\.'\)|\{ rearm: false \}/,
    );
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
