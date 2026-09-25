// Autosave do editor de modelo (spec 2026-09-25 §3): grava em report_templates.
// O texto de IA nunca vai para um modelo, e o nome não pode ficar vazio
// (coluna NOT NULL): em branco, mantém o último nome salvo.
import { updateReportTemplate } from '../../services/reportTemplates';
import { stripAiTextForTemplate } from './templateOps';
import type { AutosaveTarget } from './useLayoutAutosave';

const TEMPLATES_LIST_KEY = ['report-templates'] as const;

export const TEMPLATE_AUTOSAVE_TARGET: AutosaveTarget = {
  async save(id, patch) {
    if (patch.layout) {
      await updateReportTemplate(id, { layout: stripAiTextForTemplate(patch.layout) });
    }
    if (patch.title !== undefined) {
      const name = patch.title.trim();
      if (name) await updateReportTemplate(id, { name });
    }
  },
  cacheKey: (id) => ['report-template', id],
  titleField: 'name',
  errorMessage: 'Erro ao salvar o modelo',
  // F2 (revisão final): sem isso, Configuração › Relatórios mostra o nome
  // antigo / contagem de blocos antiga até um reload manual -- nada
  // invalidava ['report-templates'] depois de um save no editor.
  onSaved: (qc) => {
    qc.invalidateQueries({ queryKey: TEMPLATES_LIST_KEY });
  },
};
