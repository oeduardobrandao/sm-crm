import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { usePageDraft } from '../usePageDraft';

// Finding 1 (task-11 fix round 1): o rascunho local só guardava o doc do editor, nunca
// o título -- um edit só de título não gravava nada (a promessa do diálogo de troca de
// página, "elas ficam guardadas neste navegador", ficava falsa) e o pior caso (editar
// título E corpo, trocar de página e voltar) devolvia um par incoerente: corpo do
// rascunho, título do servidor. Esta suíte cobre o hook isoladamente -- PaginasPage.test.tsx
// cobre o mesmo bug em nível de integração (título-só e o par incoerente).

describe('usePageDraft', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('não grava nem lê nada com pageId nulo', () => {
    const { result } = renderHook(() => usePageDraft(null));
    expect(result.current.draft).toBeNull();

    act(() => result.current.saveDraft('Título', { type: 'doc', content: [] }));
    expect(localStorage.length).toBe(0);
  });

  it('grava título e doc juntos e os lê de volta', () => {
    // `draft` é memoizado em `pageId` (só recalcula quando a página troca -- é assim
    // que o hook é realmente usado, via `key={selectedId}` remontando PageEditorPane
    // em PaginasPage.tsx), então ler de volta exige uma NOVA instância do hook, não
    // um `rerender()` da mesma (que manteria o `useMemo` em cache).
    const { result: writer } = renderHook(() => usePageDraft('p1'));
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [] }] };
    act(() => writer.current.saveDraft('Meu título', doc));

    const { result: reader } = renderHook(() => usePageDraft('p1'));
    expect(reader.current.draft).toEqual({ title: 'Meu título', doc });
  });

  it('carrega um rascunho no formato antigo (doc puro, sem título) sem lançar', () => {
    // Formato gravado por versões anteriores ao fix: só o doc, direto, sem wrapper
    // `{ version, title, doc }`.
    const oldDoc = { type: 'doc', content: [{ type: 'paragraph', content: [] }] };
    localStorage.setItem('hub-page-draft:p1', JSON.stringify(oldDoc));

    const { result } = renderHook(() => usePageDraft('p1'));

    // O corpo tem que sobreviver -- perder o rascunho antigo repetiria a mesma
    // promessa quebrada. `title` fica `undefined` (nunca string vazia), pra o
    // caller cair pro título do servidor via `??`, não pra um título em branco.
    expect(result.current.draft).toEqual({ doc: oldDoc });
    expect(result.current.draft?.title).toBeUndefined();
  });

  it('descarta um JSON corrompido em vez de lançar', () => {
    localStorage.setItem('hub-page-draft:p1', '{not json');
    const { result } = renderHook(() => usePageDraft('p1'));
    expect(result.current.draft).toBeNull();
  });

  it('limpa o rascunho gravado', () => {
    const { result: writer } = renderHook(() => usePageDraft('p1'));
    act(() => writer.current.saveDraft('T', { type: 'doc', content: [] }));

    const { result: afterSave } = renderHook(() => usePageDraft('p1'));
    expect(afterSave.current.draft).not.toBeNull();

    act(() => afterSave.current.clearDraft());

    const { result: afterClear } = renderHook(() => usePageDraft('p1'));
    expect(afterClear.current.draft).toBeNull();
  });
});
