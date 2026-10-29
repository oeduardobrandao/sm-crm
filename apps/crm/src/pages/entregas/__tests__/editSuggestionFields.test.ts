import { describe, expect, it } from 'vitest';
import type { PostEditSuggestion } from '../../../store/posts';
import { suggestionFieldStates, teamOnlyChangedFields } from '../editSuggestionFields';

const img = (r2Key: string) => ({ type: 'inlineImage', attrs: { r2Key, src: 'x' } });
const doc = (...content: unknown[]) => ({ type: 'doc', content });
const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

function suggestion(over: Partial<PostEditSuggestion> = {}): PostEditSuggestion {
  return {
    id: 4719,
    post_id: 11807,
    suggested_conteudo: doc(para('texto novo do cliente')),
    suggested_conteudo_plain: 'texto novo do cliente',
    suggested_ig_caption: 'legenda',
    changed_fields: ['conteudo', 'conteudo_plain'],
    status: 'pending',
    updated_at: '2026-10-28T23:33:00Z',
    original_conteudo: doc(para('texto original')),
    original_conteudo_plain: 'texto original',
    original_ig_caption: 'legenda',
    ...over,
  };
}

function post(over: Record<string, unknown> = {}) {
  return {
    conteudo: doc(para('texto original')) as Record<string, unknown> | null,
    conteudo_plain: 'texto original',
    ig_caption: 'legenda' as string | null,
    ...over,
  };
}

describe('suggestionFieldStates', () => {
  it('always returns texto then legenda', () => {
    const states = suggestionFieldStates(post(), suggestion());
    expect(states.map((s) => s.field)).toEqual(['texto', 'legenda']);
  });

  it('11807 shape: client changed texto only, team rewrote only the caption', () => {
    const live = post({ ig_caption: 'legenda reescrita pela equipe' });
    const states = suggestionFieldStates(live, suggestion());
    expect(states[0]).toEqual({ field: 'texto', changed: true, conflict: false });
    expect(states[1]).toEqual({ field: 'legenda', changed: false, conflict: false });
    expect(teamOnlyChangedFields(live, suggestion())).toEqual(['legenda']);
  });

  it('flags a legenda conflict when the team edited the caption the client also changed', () => {
    const s = suggestion({
      changed_fields: ['ig_caption'],
      suggested_ig_caption: 'legenda do cliente',
    });
    const states = suggestionFieldStates(post({ ig_caption: 'legenda da equipe' }), s);
    expect(states[1]).toEqual({ field: 'legenda', changed: true, conflict: true });
    expect(states[0]).toEqual({ field: 'texto', changed: false, conflict: false });
  });

  it('treats a null live caption and an empty base as equal', () => {
    const s = suggestion({
      changed_fields: ['ig_caption'],
      suggested_ig_caption: 'nova',
      original_ig_caption: '',
    });
    expect(suggestionFieldStates(post({ ig_caption: null }), s)[1].conflict).toBe(false);
  });

  it('does not flag a texto conflict for bold-only drift on the team side', () => {
    const bold = doc({
      type: 'paragraph',
      content: [{ type: 'text', text: 'texto original', marks: [{ type: 'bold' }] }],
    });
    const states = suggestionFieldStates(post({ conteudo: bold }), suggestion());
    expect(states[0]).toEqual({ field: 'texto', changed: true, conflict: false });
  });

  it('flags a texto conflict when the plain text differs', () => {
    const states = suggestionFieldStates(
      post({ conteudo_plain: 'texto da equipe', conteudo: doc(para('texto da equipe')) }),
      suggestion(),
    );
    expect(states[0].conflict).toBe(true);
  });

  it('flags a texto conflict when the team added an image', () => {
    const withImg = doc(para('texto original'), img('conta/a.png'));
    const states = suggestionFieldStates(post({ conteudo: withImg }), suggestion());
    expect(states[0]).toEqual({ field: 'texto', changed: true, conflict: true });
  });

  it('flags a texto conflict when the team removed an inline image', () => {
    const withImg = doc(para('texto original'), img('conta/a.png'));
    const states = suggestionFieldStates(
      post({ conteudo: doc(para('texto original')) }),
      suggestion({ original_conteudo: withImg }),
    );
    expect(states[0]).toEqual({ field: 'texto', changed: true, conflict: true });
  });

  it('flags a texto conflict when live conteudo is NULL against a base with images', () => {
    const withImg = doc(para('texto original'), img('conta/a.png'));
    const states = suggestionFieldStates(
      post({ conteudo: null }),
      suggestion({ original_conteudo: withImg }),
    );
    expect(states[0].conflict).toBe(true);
  });

  it('no legenda conflict when the base is NULL and the live caption is empty or NULL', () => {
    const s = suggestion({
      changed_fields: ['ig_caption'],
      suggested_ig_caption: 'nova',
      original_ig_caption: null,
    });
    expect(suggestionFieldStates(post({ ig_caption: null }), s)[1].conflict).toBe(false);
    expect(suggestionFieldStates(post({ ig_caption: '' }), s)[1].conflict).toBe(false);
  });

  it('ignores image order and duplicates (set comparison)', () => {
    const base = doc(para('texto original'), img('a'), img('b'));
    const live = doc(para('texto original'), img('b'), img('a'), img('a'));
    const states = suggestionFieldStates(
      post({ conteudo: live }),
      suggestion({ original_conteudo: base }),
    );
    expect(states[0].conflict).toBe(false);
  });

  it('legacy row with NULL originals: base is empty, non-empty live is a conflict', () => {
    const s = suggestion({
      changed_fields: ['conteudo', 'conteudo_plain', 'ig_caption'],
      original_conteudo: null,
      original_conteudo_plain: null,
      original_ig_caption: null,
    });
    const states = suggestionFieldStates(post(), s);
    expect(states[0]).toEqual({ field: 'texto', changed: true, conflict: true });
    expect(states[1]).toEqual({ field: 'legenda', changed: true, conflict: true });
  });

  it('legacy row with NULL originals and an empty live post has no conflict', () => {
    const s = suggestion({
      changed_fields: ['conteudo', 'conteudo_plain', 'ig_caption'],
      original_conteudo: null,
      original_conteudo_plain: null,
      original_ig_caption: null,
    });
    const states = suggestionFieldStates(
      post({ conteudo: null, conteudo_plain: '', ig_caption: null }),
      s,
    );
    expect(states.map((x) => x.conflict)).toEqual([false, false]);
  });

  it('a field is changed when either conteudo or conteudo_plain is in changed_fields', () => {
    expect(
      suggestionFieldStates(post(), suggestion({ changed_fields: ['conteudo'] }))[0].changed,
    ).toBe(true);
    expect(
      suggestionFieldStates(post(), suggestion({ changed_fields: ['conteudo_plain'] }))[0].changed,
    ).toBe(true);
  });

  it('never reports a conflict for a field the client did not change', () => {
    const s = suggestion({ changed_fields: ['conteudo', 'conteudo_plain'] });
    const states = suggestionFieldStates(post({ ig_caption: 'outra' }), s);
    expect(states[1].conflict).toBe(false);
  });
});

describe('teamOnlyChangedFields', () => {
  it('is empty when nothing moved on the team side', () => {
    expect(teamOnlyChangedFields(post(), suggestion())).toEqual([]);
  });

  it('does not list fields the client changed', () => {
    const live = post({ conteudo_plain: 'equipe', ig_caption: 'equipe' });
    const s = suggestion({ changed_fields: ['conteudo', 'conteudo_plain', 'ig_caption'] });
    expect(teamOnlyChangedFields(live, s)).toEqual([]);
  });

  it('lists texto when only the team edited it', () => {
    const s = suggestion({
      changed_fields: ['ig_caption'],
      suggested_ig_caption: 'cliente',
    });
    const live = post({ conteudo_plain: 'equipe', conteudo: doc(para('equipe')) });
    expect(teamOnlyChangedFields(live, s)).toEqual(['texto']);
  });

  it('reads a NULL base as empty: a caption the team wrote on a caption-less post is listed', () => {
    const s = suggestion({
      changed_fields: ['conteudo', 'conteudo_plain'],
      original_ig_caption: null,
    });
    expect(teamOnlyChangedFields(post({ ig_caption: 'legenda nova da equipe' }), s)).toEqual([
      'legenda',
    ]);
  });

  it('does not list legenda when the base is NULL and the live caption is empty or NULL', () => {
    const s = suggestion({
      changed_fields: ['conteudo', 'conteudo_plain'],
      original_ig_caption: null,
    });
    expect(teamOnlyChangedFields(post({ ig_caption: null }), s)).toEqual([]);
    expect(teamOnlyChangedFields(post({ ig_caption: '' }), s)).toEqual([]);
  });

  it('lists texto when the team removed an inline image the client did not touch', () => {
    const withImg = doc(para('texto original'), img('conta/a.png'));
    const s = suggestion({
      changed_fields: ['ig_caption'],
      suggested_ig_caption: 'cliente',
      original_conteudo: withImg,
    });
    expect(teamOnlyChangedFields(post({ conteudo: doc(para('texto original')) }), s)).toEqual([
      'texto',
    ]);
  });
});

describe('caption-only Story suggestion (NULL suggested doc, `conteudo` still listed)', () => {
  const storyCaption = () =>
    suggestion({
      suggested_conteudo: null,
      suggested_conteudo_plain: '',
      suggested_ig_caption: 'legenda do cliente',
      changed_fields: ['conteudo', 'ig_caption'],
    });

  it('does not count texto as changed by the client', () => {
    const states = suggestionFieldStates(post(), storyCaption());
    expect(states[0]).toEqual({ field: 'texto', changed: false, conflict: false });
    expect(states[1]).toEqual({ field: 'legenda', changed: true, conflict: false });
  });

  it('a team texto edit is not a texto conflict: texto becomes a team-only change', () => {
    const live = post({ conteudo_plain: 'texto reescrito pela equipe' });
    const states = suggestionFieldStates(live, storyCaption());
    expect(states[0]).toEqual({ field: 'texto', changed: false, conflict: false });
    expect(teamOnlyChangedFields(live, storyCaption())).toEqual(['texto']);
  });

  it('still counts texto when `conteudo_plain` changed, even with a NULL doc', () => {
    const s = suggestion({
      suggested_conteudo: null,
      changed_fields: ['conteudo', 'conteudo_plain'],
    });
    expect(suggestionFieldStates(post(), s)[0].changed).toBe(true);
  });

  it('still counts a `conteudo` change that carries a real doc', () => {
    const s = suggestion({ changed_fields: ['conteudo'] });
    expect(suggestionFieldStates(post(), s)[0].changed).toBe(true);
  });
});
