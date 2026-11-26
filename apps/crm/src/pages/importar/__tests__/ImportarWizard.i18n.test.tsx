import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from 'i18next';
import { afterEach, describe, expect, it } from 'vitest';
import StepOrigem from '../components/StepOrigem';
import StepPrevia from '../components/StepPrevia';
import { SOURCE_GUIDES } from '../sourceGuides';
import { reasonLabel } from '../components/StepCommit';

afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('pt');
  });
});

describe('import wizard in English', () => {
  it('renders the source step with English headings and guide copy', async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    render(
      <MemoryRouter>
        <StepOrigem source="notion" onSelect={() => {}} onNext={() => {}} />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', {
        name: 'The most complete way to migrate: ask an AI agent',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How to export from Notion' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spreadsheet (CSV)' })).toBeInTheDocument();
  });

  it('renders the preview step in English', async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    render(
      <StepPrevia
        preview={null}
        rowCount={1}
        ignoredRows={0}
        busy={false}
        error={null}
        onBack={() => {}}
        onImport={() => {}}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Import preview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 1 record' })).toBeInTheDocument();
  });

  it('keeps Portuguese by default and resolves guide copy on every read', async () => {
    expect(SOURCE_GUIDES[3].label).toBe('Planilha (CSV)');
    expect(reasonLabel('plan_limit:max_clients')).toBe('Limite do plano atingido: clientes');
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    expect(SOURCE_GUIDES[3].label).toBe('Spreadsheet (CSV)');
    expect(reasonLabel('plan_limit:max_clients')).toBe('Plan limit reached: clients');
  });
});
