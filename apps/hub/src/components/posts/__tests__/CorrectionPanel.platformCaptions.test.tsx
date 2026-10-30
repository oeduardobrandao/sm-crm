import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CorrectionPanel, SuggestionPendingNotice } from '../CorrectionPanel';
import type { HubPost } from '../../../types';
import type { useEditSuggestion } from '../../../hooks/useEditSuggestion';

type Edit = ReturnType<typeof useEditSuggestion>;

function post(over: Partial<HubPost> = {}): HubPost {
  return {
    id: 20,
    titulo: 'Reels',
    tipo: 'reels',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: 'Corpo',
    scheduled_at: null,
    ig_caption: 'Legenda IG',
    tiktok_caption: 'Legenda TT',
    geral_caption: 'Legenda G',
    targets: ['instagram', 'tiktok', 'geral'],
    instagram_permalink: null,
    published_at: null,
    publish_error: null,
    workflow_id: null,
    workflow_titulo: null,
    workflow_created_at: null,
    media: [
      {
        id: 1,
        post_id: 20,
        kind: 'video',
        mime_type: 'video/mp4',
        url: 'https://cdn/a.mp4',
        thumbnail_url: null,
        width: 1,
        height: 1,
        duration_seconds: 10,
        is_cover: false,
        sort_order: 0,
      },
    ],
    cover_media: null,
    pending_suggestion: null,
    suggestion_rejected_at: null,
    ...over,
  };
}

/** The hook's drafts mirror the raw post (no pending suggestion). */
function makeEdit(p: HubPost, over: Partial<Edit> = {}): Edit {
  return {
    isEditable: true,
    hasPendingSuggestion: false,
    wasRejected: false,
    saveSuggestion: vi.fn(),
    saveState: 'idle',
    approvalBlocked: false,
    dirty: false,
    saveFailed: false,
    saveError: null,
    discardFailedSave: vi.fn(),
    draftConteudo: null,
    draftConteudoPlain: p.conteudo_plain,
    draftIgCaption: p.ig_caption,
    draftTiktokCaption: p.tiktok_caption ?? null,
    draftGeralCaption: p.geral_caption ?? null,
    suggestion: null,
    ...over,
  };
}

function renderPanel(p: HubPost, edit: Edit) {
  return render(
    <CorrectionPanel
      post={p}
      edit={edit}
      submitting={false}
      onSubmitCorrection={vi.fn()}
      onDirtyChange={vi.fn()}
    />,
  );
}

describe('CorrectionPanel: one caption per destination group', () => {
  it('shows a tab per group and marks the changed one; saving touches only that field', () => {
    const p = post();
    const edit = makeEdit(p);
    renderPanel(p, edit);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Instagram', 'TikTok', 'Geral']);
    expect(screen.queryByRole('img', { name: 'alterada' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'TikTok' }));
    const field = screen.getByRole('textbox', { name: 'Legenda do TikTok' });
    expect(field).toHaveValue('Legenda TT');
    expect(screen.getByText('10 / 2.200')).toBeInTheDocument();
    fireEvent.change(field, { target: { value: 'Legenda TT nova' } });
    expect(screen.getByRole('tab', { name: /TikTok/ })).toContainElement(
      screen.getByRole('img', { name: 'alterada' }),
    );
    expect(screen.getByText('15 / 2.200')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Salvar edição/ }));
    expect(edit.saveSuggestion).toHaveBeenCalledWith(
      null,
      'Corpo',
      'Legenda IG',
      { fields: ['legenda_tiktok'], bases: { tiktok_caption: 'Legenda TT' } },
      { tiktok_caption: 'Legenda TT nova', geral_caption: 'Legenda G' },
    );
  });

  it('the Instagram tab has no counter and the Geral tab edits the Geral caption', () => {
    const p = post();
    const edit = makeEdit(p);
    renderPanel(p, edit);
    expect(screen.getByRole('textbox', { name: 'Legenda do Instagram' })).toBeInTheDocument();
    expect(screen.queryByText(/\/ 2\.200/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Geral' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Legenda Geral' }), {
      target: { value: 'G nova' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Salvar edição/ }));
    expect(edit.saveSuggestion).toHaveBeenCalledWith(
      null,
      'Corpo',
      'Legenda IG',
      { fields: ['legenda_geral'], bases: { geral_caption: 'Legenda G' } },
      { tiktok_caption: 'Legenda TT', geral_caption: 'G nova' },
    );
  });

  it('a TikTok that follows Instagram shares its field and is not touched', () => {
    const p = post({ targets: ['instagram', 'tiktok'], tiktok_caption: null });
    const edit = makeEdit(p);
    renderPanel(p, edit);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByText('Esta mudança vale para o Instagram e o TikTok.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Legenda de Instagram e TikTok' }), {
      target: { value: 'Nova para os dois' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Salvar edição/ }));
    expect(edit.saveSuggestion).toHaveBeenCalledWith(
      null,
      'Corpo',
      'Nova para os dois',
      { fields: ['legenda'], bases: { ig_caption: 'Legenda IG' } },
      { tiktok_caption: null, geral_caption: 'Legenda G' },
    );
  });

  it('a TikTok with its own caption equal to Instagram is touched with Instagram', () => {
    const p = post({ targets: ['instagram', 'tiktok'], tiktok_caption: 'Legenda IG' });
    const edit = makeEdit(p);
    renderPanel(p, edit);
    fireEvent.change(screen.getByRole('textbox', { name: 'Legenda de Instagram e TikTok' }), {
      target: { value: 'Igual nos dois' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Salvar edição/ }));
    expect(edit.saveSuggestion).toHaveBeenCalledWith(
      null,
      'Corpo',
      'Igual nos dois',
      {
        fields: ['legenda', 'legenda_tiktok'],
        bases: { ig_caption: 'Legenda IG', tiktok_caption: 'Legenda IG' },
      },
      { tiktok_caption: 'Igual nos dois', geral_caption: 'Legenda G' },
    );
  });

  it('a TikTok-only post with no caption edits it with a null base', () => {
    const p = post({ targets: ['tiktok'], ig_caption: null, tiktok_caption: null });
    const edit = makeEdit(p);
    renderPanel(p, edit);
    expect(screen.getByText('Legenda do TikTok')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Legenda do TikTok' }), {
      target: { value: 'Primeira legenda' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Salvar edição/ }));
    expect(edit.saveSuggestion).toHaveBeenCalledWith(
      null,
      'Corpo',
      null,
      { fields: ['legenda_tiktok'], bases: { tiktok_caption: null } },
      { tiktok_caption: 'Primeira legenda', geral_caption: 'Legenda G' },
    );
  });

  it('keeps the grouping it opened with while the client types', () => {
    const p = post({ targets: ['instagram', 'tiktok'], tiktok_caption: 'Legenda IG' });
    renderPanel(p, makeEdit(p));
    // Typing makes the field differ from nothing else: there is still one field, not two tabs.
    fireEvent.change(screen.getByRole('textbox', { name: 'Legenda de Instagram e TikTok' }), {
      target: { value: 'outra' },
    });
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('keeps the Instagram-only post on the single caption field (no 5th argument)', () => {
    const p = post({ targets: ['instagram'] });
    const edit = makeEdit(p);
    renderPanel(p, edit);
    fireEvent.change(screen.getByRole('textbox', { name: 'Legenda do post' }), {
      target: { value: 'Nova' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Salvar edição/ }));
    expect(edit.saveSuggestion).toHaveBeenCalledWith(null, 'Corpo', 'Nova', {
      fields: ['legenda'],
      bases: { ig_caption: 'Legenda IG' },
    });
  });

  it('drops a destination removed while editing (after target_gone) and stops touching it', () => {
    const p = post();
    const edit = makeEdit(p);
    const { rerender } = renderPanel(p, edit);
    fireEvent.click(screen.getByRole('tab', { name: 'Geral' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Legenda Geral' }), {
      target: { value: 'G nova' },
    });
    fireEvent.click(screen.getByRole('tab', { name: /TikTok/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Legenda do TikTok' }), {
      target: { value: 'TT nova' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Salvar edição/ }));
    // The refetch after a 409 target_gone: the Geral row is gone.
    const reloaded = post({ targets: ['instagram', 'tiktok'], geral_caption: null });
    rerender(
      <CorrectionPanel
        post={reloaded}
        edit={makeEdit(reloaded)}
        submitting={false}
        onSubmitCorrection={vi.fn()}
        onDirtyChange={vi.fn()}
      />,
    );
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Instagram',
      'TikTok',
    ]);
    const retryEdit = makeEdit(reloaded);
    rerender(
      <CorrectionPanel
        post={reloaded}
        edit={retryEdit}
        submitting={false}
        onSubmitCorrection={vi.fn()}
        onDirtyChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Salvar edição/ }));
    expect(retryEdit.saveSuggestion).toHaveBeenCalledWith(
      null,
      'Corpo',
      'Legenda IG',
      { fields: ['legenda_tiktok'], bases: { tiktok_caption: 'Legenda TT' } },
      { tiktok_caption: 'TT nova', geral_caption: null },
    );
  });

  it('a single-caption panel keeps its field when a refetch reveals other destinations', () => {
    // Cached payload: Geral listed without its caption, so the single block.
    const cached = post({ targets: ['instagram', 'geral'], geral_caption: undefined });
    const { rerender } = renderPanel(cached, makeEdit(cached));
    expect(screen.getByRole('textbox', { name: 'Legenda do post' })).toBeInTheDocument();
    const fresh = post({ targets: ['instagram', 'geral'], geral_caption: 'G' });
    rerender(
      <CorrectionPanel
        post={fresh}
        edit={makeEdit(fresh)}
        submitting={false}
        onSubmitCorrection={vi.fn()}
        onDirtyChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Legenda do post' })).toBeInTheDocument();
  });

  it.each([
    ['target_gone', 'Esse destino foi removido do post.'],
    ['retry', 'Não deu para salvar agora. Tente de novo.'],
    ['caption_too_long', 'A legenda do TikTok passou do limite de 2.200 caracteres.'],
    [null, 'Não foi possível salvar. Tente novamente.'],
  ] as const)('says why a save failed (%s)', (saveError, message) => {
    const p = post();
    renderPanel(p, makeEdit(p, { saveFailed: true, dirty: true, saveError }));
    expect(screen.getByRole('alert')).toHaveTextContent(message);
  });
});

describe('SuggestionPendingNotice: the changed fields as a list', () => {
  it('names every changed field, joined with commas and "e"', () => {
    render(
      <SuggestionPendingNotice
        changedFields={['conteudo_plain', 'tiktok_caption', 'geral_caption']}
        multiDestination
        view="suggestion"
        onViewChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        'Abaixo está a versão que você sugeriu, com mudanças no texto, na legenda do TikTok e na legenda Geral.',
      ),
    ).toBeInTheDocument();
  });

  it('names the Instagram caption explicitly only on a multi-destination post', () => {
    const { rerender } = render(
      <SuggestionPendingNotice
        changedFields={['ig_caption']}
        view="suggestion"
        onViewChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText('Abaixo está a versão que você sugeriu, com mudanças na legenda.'),
    ).toBeInTheDocument();
    rerender(
      <SuggestionPendingNotice
        changedFields={['ig_caption']}
        multiDestination
        view="suggestion"
        onViewChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        'Abaixo está a versão que você sugeriu, com mudanças na legenda do Instagram.',
      ),
    ).toBeInTheDocument();
  });
});
