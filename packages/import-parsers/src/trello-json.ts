import { ImportParseError } from './errors';
import type { ImportCollection, ImportRow } from './types';

interface TrelloList {
  id: string;
  name: string;
  closed: boolean;
  pos: number;
}

interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  due: string | null;
  idList: string;
  closed: boolean;
  shortUrl?: string;
  labels?: { name: string }[];
}

interface TrelloChecklist {
  idCard: string;
  checkItems: { name: string }[];
}

export function parseTrelloJson(fileName: string, text: string): ImportCollection {
  const parsed: unknown = JSON.parse(text);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    !Array.isArray((parsed as Record<string, unknown>).cards)
  ) {
    throw new ImportParseError('trello-not-a-board');
  }
  const board = parsed as {
    name?: string;
    lists?: TrelloList[];
    cards?: TrelloCard[];
    checklists?: TrelloChecklist[];
  };
  // actions[] (dominates export size) is simply never read.
  const openLists = (board.lists ?? []).filter((l) => !l.closed).sort((a, b) => a.pos - b.pos);
  const listById = new Map(openLists.map((l) => [l.id, l.name]));
  const checklistByCard = new Map<string, string[]>();
  for (const ck of board.checklists ?? []) {
    const items = ck.checkItems.map((i) => i.name);
    checklistByCard.set(ck.idCard, [...(checklistByCard.get(ck.idCard) ?? []), ...items]);
  }
  const rows: ImportRow[] = (board.cards ?? [])
    .filter((c) => !c.closed && listById.has(c.idList))
    .map((c) => ({
      key: c.id,
      cells: {
        Nome: c.name,
        Etiquetas: (c.labels ?? [])
          .map((l) => l.name)
          .filter(Boolean)
          .join(', '),
      },
      listName: listById.get(c.idList)!,
      dueDate: c.due ?? null,
      description: c.desc ?? '',
      checklist: checklistByCard.get(c.id) ?? [],
      sourceUrl: c.shortUrl ?? '',
    }));
  return {
    id: fileName,
    name: board.name ?? fileName,
    source: 'trello',
    columns: ['Nome', 'Etiquetas'],
    listNames: openLists.map((l) => l.name),
    rows,
  };
}
