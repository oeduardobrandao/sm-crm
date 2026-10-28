import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '@mesaas/i18n';
import { fileInUseMessage } from '../fileInUse';

describe('fileInUseMessage (en)', () => {
  afterEach(() => i18n.changeLanguage('pt'));

  it('posts and one report', async () => {
    await i18n.changeLanguage('en');
    expect(
      fileInUseMessage({
        linked_posts: [{ post_id: 1 }, { post_id: 2 }],
        linked_reports: [{ report_id: 'a', title: 'September report' }],
      }),
    ).toBe(
      'This file is in use in 2 posts and in the report September report. Remove it from there first.',
    );
  });

  it('one post', async () => {
    await i18n.changeLanguage('en');
    expect(fileInUseMessage({ linked_posts: [{ post_id: 1 }] })).toBe(
      'This file is in use in 1 post. Remove it from there first.',
    );
  });

  it('several reports, one untitled', async () => {
    await i18n.changeLanguage('en');
    expect(
      fileInUseMessage({ linked_reports: [{ title: 'A' }, { title: '' }, { title: 'B' }] }),
    ).toBe('This file is in use in the reports A, untitled and B. Remove it from there first.');
  });

  it('no details', async () => {
    await i18n.changeLanguage('en');
    expect(fileInUseMessage({})).toBe("This file is in use and can't be deleted.");
  });
});
