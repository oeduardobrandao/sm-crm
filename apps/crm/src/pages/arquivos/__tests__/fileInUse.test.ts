import { describe, expect, it } from 'vitest';
import { fileInUseMessage } from '../fileInUse';

describe('fileInUseMessage', () => {
  it('posts e um relatório', () => {
    expect(
      fileInUseMessage({
        linked_posts: [{ post_id: 1 }, { post_id: 2 }],
        linked_reports: [{ report_id: 'a', title: 'Relatório de setembro' }],
      }),
    ).toBe(
      'Este arquivo está em uso em 2 posts e no relatório Relatório de setembro. Remova de lá primeiro.',
    );
  });
  it('um post', () => {
    expect(fileInUseMessage({ linked_posts: [{ post_id: 1 }], linked_reports: [] })).toBe(
      'Este arquivo está em uso em 1 post. Remova de lá primeiro.',
    );
  });
  it('dois relatórios', () => {
    expect(fileInUseMessage({ linked_reports: [{ title: 'A' }, { title: 'B' }] })).toBe(
      'Este arquivo está em uso nos relatórios A e B. Remova de lá primeiro.',
    );
  });
  it('sem detalhes', () => {
    expect(fileInUseMessage({})).toBe('Este arquivo está em uso e não pode ser excluído.');
  });
});
