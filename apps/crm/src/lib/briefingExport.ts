import type { HubBriefingQuestionRow } from '@/store/hub';

// =============================================
// Briefing export — pure formatters (no React/DOM)
// =============================================

export interface ExportQuestion {
  question: string;
  answer: string | null;
}

export interface ExportSection {
  name: string; // '' is the unsectioned bucket
  questions: ExportQuestion[];
}

/**
 * Backslash-escapes Markdown metacharacters so plain-text briefing content
 * cannot alter the exported document's structure.
 */
export function escapeMarkdown(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      // Inline metacharacters anywhere: \ ` * _ [ ] <
      let out = line.replace(/([\\`*_[\]<])/g, '\\$1');
      // Leading block markers (after optional spaces): # > | + - =
      out = out.replace(/^(\s*)([#>|+\-=])/, '$1\\$2');
      // Leading ordered-list marker: escape the punctuation, e.g. "1." -> "1\."
      out = out.replace(/^(\s*)(\d+)([.)])/, '$1$2\\$3');
      return out;
    })
    .join('\n');
}

/** Filename-safe slug: lowercased, accent-stripped, non-alphanumerics -> '-'. */
export function slugifyTitle(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'briefing';
}

/**
 * Filters questions to the selected briefing and groups them into sections in
 * CRM visual order: the unsectioned ('') bucket first, then named sections in
 * first-seen order. Mirrors HubTab.tsx:585 (selection) and :687/:987 (order).
 */
export function buildBriefingExportSections(
  allQuestions: HubBriefingQuestionRow[],
  selectedId: string | null,
  firstId: string | null,
): ExportSection[] {
  const selected = allQuestions.filter((q) => (q.briefing_id ?? firstId) === selectedId);
  const sections: ExportSection[] = [];
  for (const q of selected) {
    const name = q.section ?? '';
    const item: ExportQuestion = { question: q.question, answer: q.answer };
    const existing = sections.find((s) => s.name === name);
    if (existing) existing.questions.push(item);
    else sections.push({ name, questions: [item] });
  }
  const unsectioned = sections.filter((s) => s.name === '');
  const named = sections.filter((s) => s.name !== '');
  return [...unsectioned, ...named];
}

/** Encodes one CSV field: flatten newlines, then RFC-4180 quote if needed. */
function csvField(value: string): string {
  const flat = value.replace(/\r\n|\r|\n/g, ' ');
  return /[",]/.test(flat) ? `"${flat.replace(/"/g, '""')}"` : flat;
}

/**
 * CSV with columns pergunta,secao,resposta (importer-compatible). Rows follow
 * the given section order. No BOM (added only on the download path).
 */
export function briefingToCSV(sections: ExportSection[]): string {
  const rows = ['pergunta,secao,resposta'];
  for (const section of sections) {
    for (const q of section.questions) {
      rows.push([csvField(q.question), csvField(section.name), csvField(q.answer ?? '')].join(','));
    }
  }
  return rows.join('\n');
}
