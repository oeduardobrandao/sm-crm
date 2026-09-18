import { describe, expect, it } from 'vitest';
import pt from '../../../../../packages/i18n/locales/pt/hubPosts.json';
import en from '../../../../../packages/i18n/locales/en/hubPosts.json';

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object'
      ? flattenKeys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe('hubPosts locale files', () => {
  it('pt and en expose the same keys', () => {
    expect(flattenKeys(en).sort()).toEqual(flattenKeys(pt).sort());
  });

  it('carries the history, correctionReason, postagens.filter and aprovacoes filter/sort keys', () => {
    const keys = flattenKeys(pt);
    for (const key of [
      'history.toggle',
      'history.summary',
      'history.tabHistory',
      'history.tabComments',
      'history.loading',
      'history.loadError',
      'history.empty',
      'history.emptyComments',
      'history.sentVersion',
      'history.approved',
      'history.correctionRequested',
      'history.actor.team',
      'history.actor.system',
      'history.actor.you',
      'history.showDiff',
      'history.hideDiff',
      'history.kpi.rounds',
      'history.kpi.avgResponse',
      'history.kpi.noData',
      'history.composerPlaceholder',
      'history.send',
      'history.sending',
      'history.sendError',
      'history.motivoLabel',
      'correctionReason.title',
      'correctionReason.midia',
      'correctionReason.texto',
      'correctionReason.legenda',
      'correctionReason.outro',
      'posts.select',
      'posts.done',
      'posts.previous',
      'posts.next',
      'posts.counter',
      'posts.closeDialog',
      'posts.tabCaption',
      'posts.tabText',
      'posts.tabHistory',
      'posts.editCaption',
      'posts.editText',
      'posts.correct',
      'posts.requestCorrection',
      'posts.mediaRemoved',
      'posts.notAvailable',
      'postagens.filter.label',
      'postagens.filter.all',
      'postagens.filter.fluxoLabel',
      'postagens.filter.avulsas',
      'aprovacoes.noResults',
      'aprovacoes.mediaFilter.label',
      'aprovacoes.mediaFilter.with',
      'aprovacoes.mediaFilter.without',
      'aprovacoes.sort.label',
      'aprovacoes.sort.oldest',
      'aprovacoes.sort.newest',
    ]) {
      expect(keys, key).toContain(key);
    }
  });

  it('has no em-dash in any user-facing string', () => {
    expect(
      JSON.stringify(pt.history) + JSON.stringify(pt.correctionReason) + JSON.stringify(pt.posts),
    ).not.toMatch(/—/);
  });
});
