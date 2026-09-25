import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportLayout } from '@mesaas/report-blocks/types';

const { updateReportTemplateMock } = vi.hoisted(() => ({
  updateReportTemplateMock: vi.fn(),
}));
vi.mock('../../../services/reportTemplates', () => ({
  updateReportTemplate: updateReportTemplateMock,
}));

import { TEMPLATE_AUTOSAVE_TARGET } from '../templateAutosave';

beforeEach(() => {
  updateReportTemplateMock.mockReset();
  updateReportTemplateMock.mockResolvedValue(undefined);
});

describe('TEMPLATE_AUTOSAVE_TARGET', () => {
  it('layout é gravado sem texto de IA', async () => {
    const layout: ReportLayout = {
      version: 1,
      blocks: [
        { id: 'c', type: 'cover', size: 'full' },
        { id: 'a', type: 'ai_summary', size: 'full', text: { type: 'doc', content: [] } },
        { id: 't', type: 'text', size: 'full', text: { type: 'doc', content: [] } },
      ],
    };
    await TEMPLATE_AUTOSAVE_TARGET.save('tpl-1', { layout });
    const [id, patch] = updateReportTemplateMock.mock.calls[0];
    expect(id).toBe('tpl-1');
    expect(patch.layout.blocks[1].text).toBeUndefined();
    expect(patch.layout.blocks[2].text).toEqual({ type: 'doc', content: [] });
  });

  it('title vira name, aparado', async () => {
    await TEMPLATE_AUTOSAVE_TARGET.save('tpl-1', { title: '  Mensal  ' });
    expect(updateReportTemplateMock).toHaveBeenCalledWith('tpl-1', { name: 'Mensal' });
  });

  it('title em branco não grava (name é NOT NULL e vazio não serve)', async () => {
    await TEMPLATE_AUTOSAVE_TARGET.save('tpl-1', { title: '   ' });
    expect(updateReportTemplateMock).not.toHaveBeenCalled();
  });

  it('chave de cache e campo de título', () => {
    expect(TEMPLATE_AUTOSAVE_TARGET.cacheKey('tpl-1')).toEqual(['report-template', 'tpl-1']);
    expect(TEMPLATE_AUTOSAVE_TARGET.titleField).toBe('name');
  });
});
