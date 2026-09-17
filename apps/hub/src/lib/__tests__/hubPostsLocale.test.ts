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

  it('carries the history, correctionReason and postagens.filter keys', () => {
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
      'correctionReason.required',
      'correctionReason.legenda',
      'correctionReason.imagem_video',
      'correctionReason.data',
      'correctionReason.outro',
      'postagens.filter.all',
      'postagens.filter.label',
    ]) {
      expect(keys, key).toContain(key);
    }
  });

  it('has no em-dash in any user-facing string', () => {
    expect(JSON.stringify(pt.history) + JSON.stringify(pt.correctionReason)).not.toMatch(/—/);
  });
});
