import { describe, expect, it } from 'vitest';
import type { Membro, TarefaEvento } from '../../../store';
import { buildTarefaTimeline, HISTORICO_DESDE } from '../tarefaTimeline';

const ANA_UID = 'user-ana';
const BRUNO_UID = 'user-bruno';

const membros = [
  { id: 1, nome: 'Ana', crm_user_id: ANA_UID },
  { id: 2, nome: 'Bruno', crm_user_id: BRUNO_UID },
] as unknown as Membro[];

/** 'YYYY-MM-DD' -> 'DD/MM', without going through Date (no timezone drift). */
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

let seq = 0;
function ev(overrides: Partial<TarefaEvento>): TarefaEvento {
  seq += 1;
  return {
    id: seq,
    tarefa_id: 42,
    tipo: 'status',
    actor_user_id: ANA_UID,
    actor_nome: 'Ana',
    de: null,
    para: null,
    txid: 1000 + seq,
    created_at: '2026-10-28T12:00:00Z',
    ...overrides,
  };
}

const at = (sec: number) => new Date(Date.UTC(2026, 9, 28, 12, 0, sec)).toISOString();

describe('buildTarefaTimeline', () => {
  it('exposes the history start date', () => {
    expect(HISTORICO_DESDE).toBe('28/10/2026');
  });

  it('status sentence', () => {
    const nodes = buildTarefaTimeline(
      [ev({ tipo: 'status', de: 'pendente', para: 'em_andamento' })],
      membros,
      ddmm,
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0].text).toBe('Ana mudou o status de A fazer para Em andamento');
    expect(nodes[0].actorLabel).toBe('Ana');
    expect(nodes[0].tone).toBe('info');
  });

  it('status to concluida from nothing (backfill) is a success entry', () => {
    const [node] = buildTarefaTimeline(
      [ev({ tipo: 'status', de: null, para: 'concluida', actor_user_id: null, actor_nome: null })],
      membros,
      ddmm,
    );
    expect(node.text).toBe('Automação mudou o status para Concluída');
    expect(node.tone).toBe('success');
  });

  it('prazo sentence with dd/MM', () => {
    const nodes = buildTarefaTimeline(
      [ev({ tipo: 'prazo', de: '2026-10-12', para: '2026-10-15', actor_user_id: BRUNO_UID })],
      membros,
      ddmm,
    );
    expect(nodes[0].text).toBe('Bruno moveu o prazo de 12/10 para 15/10');
  });

  it('prazo set and removed', () => {
    const nodes = buildTarefaTimeline(
      [
        ev({ tipo: 'prazo', de: null, para: '2026-10-15', created_at: at(0) }),
        ev({ tipo: 'prazo', de: '2026-10-15', para: null, created_at: '2026-10-28T13:00:00Z' }),
      ],
      membros,
      ddmm,
    );
    expect(nodes.map((n) => n.text)).toEqual([
      'Ana removeu o prazo',
      'Ana definiu o prazo para 15/10',
    ]);
  });

  it('responsavel from null', () => {
    const nodes = buildTarefaTimeline(
      [ev({ tipo: 'responsavel', de: null, para: { id: 2, nome: 'Bruno' } })],
      membros,
      ddmm,
    );
    expect(nodes[0].text).toBe('Ana atribuiu a tarefa a Bruno');
  });

  it('responsavel change and a snapshot without a name', () => {
    const nodes = buildTarefaTimeline(
      [
        ev({
          tipo: 'responsavel',
          de: { id: 1, nome: 'Ana' },
          para: { id: 99, nome: null },
        }),
      ],
      membros,
      ddmm,
    );
    expect(nodes[0].text).toBe('Ana mudou o responsável de Ana para membro removido');
  });

  it('actor falls back to actor_nome then Automação', () => {
    const nodes = buildTarefaTimeline(
      [
        ev({
          tipo: 'descricao',
          actor_user_id: 'user-gone',
          actor_nome: 'Carla',
          created_at: at(0),
        }),
        ev({
          tipo: 'titulo',
          actor_user_id: null,
          actor_nome: null,
          de: 'A',
          para: 'B',
          created_at: '2026-10-28T13:00:00Z',
        }),
      ],
      membros,
      ddmm,
    );
    expect(nodes[0].actorLabel).toBe('Automação');
    expect(nodes[0].text).toBe('Automação renomeou a tarefa de “A” para “B”');
    expect(nodes[1].actorLabel).toBe('Carla');
    expect(nodes[1].text).toBe('Carla editou a descrição');
  });

  it('current membro name wins over the snapshot', () => {
    const [node] = buildTarefaTimeline(
      [ev({ tipo: 'descricao', actor_user_id: ANA_UID, actor_nome: 'Ana Antiga' })],
      membros,
      ddmm,
    );
    expect(node.actorLabel).toBe('Ana');
  });

  it('recurrence-created criada', () => {
    const nodes = buildTarefaTimeline(
      [ev({ tipo: 'criada', para: { serie: true }, actor_user_id: null, actor_nome: null })],
      membros,
      ddmm,
    );
    expect(nodes[0].text).toBe('Recorrência criou a tarefa');
    expect(nodes[0].actorLabel).toBe('Recorrência');
  });

  it('plain criada names the creator', () => {
    const [node] = buildTarefaTimeline(
      [ev({ tipo: 'criada', para: { serie: false } })],
      membros,
      ddmm,
    );
    expect(node.text).toBe('Ana criou a tarefa');
    expect(node.tone).toBe('primary');
  });

  it('subtask, tag, cliente and recurrence sentences', () => {
    const nodes = buildTarefaTimeline(
      [
        ev({ tipo: 'subtarefa_adicionada', para: { titulo: 'Briefing' }, created_at: at(0) }),
        ev({
          tipo: 'tag_adicionada',
          para: { id: 3, nome: 'Urgente', cor: '#f00' },
          created_at: at(1),
        }),
        ev({ tipo: 'cliente', de: null, para: { id: 5, nome: 'Clínica X' }, created_at: at(2) }),
        ev({ tipo: 'recorrencia', de: null, para: 7, created_at: at(3) }),
      ],
      membros,
      ddmm,
    );
    expect(nodes.map((n) => n.text)).toEqual([
      'Ana fez a tarefa se repetir',
      'Ana vinculou a tarefa ao cliente Clínica X',
      'Ana adicionou a tag Urgente',
      'Ana adicionou a subtarefa “Briefing”',
    ]);
  });

  it('newest first, ties broken by id', () => {
    const a = ev({ tipo: 'descricao', created_at: at(0) });
    const b = ev({ tipo: 'criada', created_at: at(0), actor_user_id: BRUNO_UID });
    const nodes = buildTarefaTimeline([a, b], membros, ddmm);
    expect(nodes.map((n) => n.key)).toEqual([String(b.id), String(a.id)]);
  });

  describe('nets_same_tag_pairs', () => {
    const tag = { id: 3, nome: 'Urgente', cor: '#f00' };

    it('drops a remove + add of the same tag in one transaction', () => {
      const nodes = buildTarefaTimeline(
        [
          ev({ tipo: 'tag_removida', para: tag, txid: 500, created_at: at(0) }),
          ev({ tipo: 'tag_adicionada', para: tag, txid: 500, created_at: at(0) }),
          ev({
            tipo: 'tag_adicionada',
            para: { id: 4, nome: 'Novo', cor: '#0f0' },
            txid: 500,
            created_at: at(0),
          }),
        ],
        membros,
        ddmm,
      );
      expect(nodes.map((n) => n.text)).toEqual(['Ana adicionou a tag Novo']);
    });

    it('drops the old two-request pair: different txids 2 s apart, same actor', () => {
      const nodes = buildTarefaTimeline(
        [
          ev({ tipo: 'tag_removida', para: tag, txid: 600, created_at: at(0) }),
          ev({ tipo: 'tag_adicionada', para: tag, txid: 601, created_at: at(2) }),
        ],
        membros,
        ddmm,
      );
      expect(nodes).toEqual([]);
    });

    it('keeps a pair by different actors in different transactions', () => {
      const nodes = buildTarefaTimeline(
        [
          ev({ tipo: 'tag_removida', para: tag, txid: 700, created_at: at(0) }),
          ev({
            tipo: 'tag_adicionada',
            para: tag,
            txid: 701,
            created_at: at(2),
            actor_user_id: BRUNO_UID,
          }),
        ],
        membros,
        ddmm,
      );
      expect(nodes).toHaveLength(2);
    });

    it('keeps a pair more than 5 s apart in different transactions', () => {
      const nodes = buildTarefaTimeline(
        [
          ev({ tipo: 'tag_removida', para: tag, txid: 800, created_at: at(0) }),
          ev({ tipo: 'tag_adicionada', para: tag, txid: 801, created_at: at(9) }),
        ],
        membros,
        ddmm,
      );
      expect(nodes).toHaveLength(2);
    });
  });

  it('collapses prazo moves within 2 min', () => {
    const nodes = buildTarefaTimeline(
      [
        ev({ tipo: 'prazo', de: '2026-10-12', para: '2026-10-13', created_at: at(0) }),
        ev({ tipo: 'prazo', de: '2026-10-13', para: '2026-10-14', created_at: at(50) }),
        ev({
          tipo: 'prazo',
          de: '2026-10-14',
          para: '2026-10-15',
          created_at: new Date(Date.UTC(2026, 9, 28, 12, 2, 40)).toISOString(),
        }),
      ],
      membros,
      ddmm,
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0].text).toBe('Ana moveu o prazo de 12/10 para 15/10');
    expect(nodes[0].at).toBe(new Date(Date.UTC(2026, 9, 28, 12, 2, 40)).toISOString());
  });

  it('does not collapse across actors', () => {
    const nodes = buildTarefaTimeline(
      [
        ev({ tipo: 'prazo', de: '2026-10-12', para: '2026-10-13', created_at: at(0) }),
        ev({
          tipo: 'prazo',
          de: '2026-10-13',
          para: '2026-10-14',
          created_at: at(30),
          actor_user_id: BRUNO_UID,
        }),
      ],
      membros,
      ddmm,
    );
    expect(nodes.map((n) => n.text)).toEqual([
      'Bruno moveu o prazo de 13/10 para 14/10',
      'Ana moveu o prazo de 12/10 para 13/10',
    ]);
  });

  it('does not collapse when more than 2 min apart', () => {
    const nodes = buildTarefaTimeline(
      [
        ev({ tipo: 'prazo', de: '2026-10-12', para: '2026-10-13', created_at: at(0) }),
        ev({
          tipo: 'prazo',
          de: '2026-10-13',
          para: '2026-10-14',
          created_at: new Date(Date.UTC(2026, 9, 28, 12, 2, 1)).toISOString(),
        }),
      ],
      membros,
      ddmm,
    );
    expect(nodes).toHaveLength(2);
  });

  it('does not collapse across an event of another type', () => {
    const nodes = buildTarefaTimeline(
      [
        ev({ tipo: 'prazo', de: '2026-10-12', para: '2026-10-13', created_at: at(0) }),
        ev({ tipo: 'descricao', created_at: at(10) }),
        ev({ tipo: 'prazo', de: '2026-10-13', para: '2026-10-14', created_at: at(20) }),
      ],
      membros,
      ddmm,
    );
    expect(nodes).toHaveLength(3);
  });

  it('drops a collapsed change that ends where it started', () => {
    const nodes = buildTarefaTimeline(
      [
        ev({ tipo: 'status', de: 'pendente', para: 'concluida', created_at: at(0) }),
        ev({ tipo: 'status', de: 'concluida', para: 'pendente', created_at: at(5) }),
      ],
      membros,
      ddmm,
    );
    expect(nodes).toEqual([]);
  });

  it('never collapses list events (each subtask stays visible)', () => {
    const nodes = buildTarefaTimeline(
      [
        ev({ tipo: 'subtarefa_adicionada', para: { titulo: 'A' }, created_at: at(0) }),
        ev({ tipo: 'subtarefa_adicionada', para: { titulo: 'B' }, created_at: at(5) }),
      ],
      membros,
      ddmm,
    );
    expect(nodes).toHaveLength(2);
  });
});
