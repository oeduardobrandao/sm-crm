import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveInlineImageUrlsMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/inlineImage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/inlineImage')>()),
  resolveInlineImageUrls: resolveInlineImageUrlsMock,
}));

import { TarefaDescriptionContent } from '../components/TarefaDescriptionContent';

describe('TarefaDescriptionContent', () => {
  beforeEach(() => {
    resolveInlineImageUrlsMock.mockResolvedValue({
      'contas/1/files/reference.png': 'https://signed.example/reference.png',
    });
  });

  it('resolves an image R2 key before mounting the read-only TipTap document', async () => {
    render(
      <MemoryRouter>
        <TarefaDescriptionContent
          plainText={null}
          richContent={{
            type: 'doc',
            content: [
              {
                type: 'inlineImage',
                attrs: {
                  r2Key: 'contas/1/files/reference.png',
                  alt: 'Referência',
                  width: 800,
                  height: 600,
                },
              },
            ],
          }}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('img', { name: 'Referência' })).toHaveAttribute(
      'src',
      'https://signed.example/reference.png',
    );
  });

  it('navigates when a rich mention is clicked', async () => {
    render(
      <MemoryRouter initialEntries={['/tarefas']}>
        <Routes>
          <Route
            path="/tarefas"
            element={
              <TarefaDescriptionContent
                plainText="@Ana"
                richContent={{
                  type: 'doc',
                  content: [
                    {
                      type: 'paragraph',
                      content: [
                        {
                          type: 'mention',
                          attrs: {
                            entityType: 'membro',
                            id: 7,
                            label: 'Ana',
                            parentId: null,
                          },
                        },
                      ],
                    },
                  ],
                }}
              />
            }
          />
          <Route path="/equipe/7" element={<div>Destino membro</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByText('@Ana'));
    expect(await screen.findByText('Destino membro')).toBeInTheDocument();
  });
});
