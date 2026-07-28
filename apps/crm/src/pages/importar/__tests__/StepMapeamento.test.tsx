import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { ImportBundle, MappingProposal } from '@mesaas/import-parsers';
import type { CommitContainerRow } from '@/services/dataImport';
import StepMapeamento from '../components/StepMapeamento';
import { buildCommitRows, type ExistingCliente } from '../buildCommitRows';

// Regression for the review finding: the mapping-step hint used to compare
// names with a bare `.trim().toLowerCase()`, while buildCommitRows' `norm()`
// additionally strips diacritics — so an existing "Aná Souza" and a typed
// "Ana Souza" would show "será criado" and then get MERGED into the existing
// client, exactly the opposite of what the user read. Both now share `norm`.

const EXISTING: ExistingCliente[] = [{ id: 7, nome: 'Aná Souza' }];

function bundleAndProposal(): { bundle: ImportBundle; proposal: MappingProposal } {
  const bundle: ImportBundle = {
    source: 'csv',
    warnings: [],
    collections: [
      {
        id: 'cal',
        name: 'calendario',
        source: 'csv',
        columns: ['Nome'],
        listNames: [],
        rows: [{ key: 'p1', cells: { Nome: 'Post 1' } }],
      },
    ],
  };
  const proposal: MappingProposal = {
    collections: [
      {
        collectionId: 'cal',
        destination: 'posts',
        columnRoles: { title: 'Nome' },
        statusMap: {},
        // Diacritic-differing from the existing "Aná Souza".
        clientAssignment: { mode: 'fixed', clienteNome: 'Ana Souza' },
      },
    ],
  };
  return { bundle, proposal };
}

describe('StepMapeamento hint agrees with buildCommitRows merge', () => {
  test('shows the "existing client" hint, matching what buildCommitRows actually resolves to', () => {
    const { bundle, proposal } = bundleAndProposal();

    render(
      <StepMapeamento
        bundle={bundle}
        proposal={proposal}
        clientes={EXISTING}
        clientesStatus="ready"
        onRetryClientes={() => {}}
        error={null}
        onChange={() => {}}
        onBack={() => {}}
        onNext={() => {}}
      />,
    );

    // The hint must say the existing client will be used, NOT that a new one
    // will be created.
    expect(screen.getByText('Usaremos o cliente que já existe com esse nome.')).toBeInTheDocument();
    expect(
      screen.queryByText('Se não existir um cliente com esse nome, ele será criado.'),
    ).not.toBeInTheDocument();

    // And buildCommitRows must agree: it resolves to the EXISTING cliente, not
    // a newly created one.
    const rows = buildCommitRows(bundle, proposal, EXISTING, null);
    const container = rows.find((r) => r.kind === 'container') as CommitContainerRow | undefined;
    expect(container).toBeDefined();
    expect(container?.clienteRef).toEqual({ type: 'existing', clienteId: 7 });
  });
});
