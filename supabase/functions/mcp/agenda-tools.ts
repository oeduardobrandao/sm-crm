// deno-lint-ignore-file no-explicit-any
// Ferramentas MCP da Agenda. Escopos `agenda:read` / `agenda:write`. O `auditArgs` carrega só ids,
// escopo, nomes de campos e contagens: nunca título, descrição, local ou link da reunião.
import { z } from "npm:zod@3";
import { register } from "./register.ts";
import type { Deps } from "./queries.ts";
import { createAgendaEvent, deleteAgendaEvent, getAgendaEvent, listAgendaEvents, updateAgendaEvent } from "./agenda.ts";

const EVENT_TYPE = z.enum(["reuniao", "gravacao", "captacao", "apresentacao", "interno", "outro"]);
const EVENT_COLOR = z.enum(["azul", "verde", "amarelo", "laranja", "rosa", "roxo", "teal", "cinza"]);
const SCOPE = z.enum(["this", "this_and_following", "all"]);
const OCCURRENCE_ID = z.number().int().positive();

const RECURRENCE = z.object({
  freq: z.enum(["daily", "weekly", "monthly", "yearly"]),
  interval: z.number().int().positive().optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  monthly_mode: z.enum(["dia_mes", "dia_semana"]).optional(),
  monthly_ordinal: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)]).optional(),
  until: z.string().nullable().optional(),
  count: z.number().int().positive().nullable().optional(),
});

const NOT_AUDITED_FIELDS = new Set(["occurrence_id", "scope"]);

/** Nomes de todos os campos alterados, inclusive os de texto livre (o nome não é o conteúdo). */
function allChangedNames(a: Record<string, unknown>): string[] {
  return Object.keys(a).filter((k) => a[k] !== undefined && !NOT_AUDITED_FIELDS.has(k));
}

const WRITE_SHAPE = {
  description: z.string().max(5000).nullable().optional(),
  location: z.string().max(300).nullable().optional(),
  meeting_link: z.string().max(500).nullable().optional(),
  type: EVENT_TYPE.optional(),
  color: EVENT_COLOR.nullable().optional(),
  client_id: z.number().int().positive().nullable().optional(),
  share_with_client: z.boolean().optional(),
  private: z.boolean().optional(),
  reminders: z.array(z.number().int().min(-1440).max(40320)).max(5).nullable().optional(),
  all_day: z.boolean().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  recurrence: RECURRENCE.nullable().optional(),
  participant_member_ids: z.array(z.number().int().positive()).max(50).optional(),
};

export function registerAgendaTools(server: any, deps: Deps): void {
  register(server, deps, "list_agenda_events", "agenda:read",
    "Lista os eventos da Agenda do workspace entre from e to (YYYY-MM-DD ou data e hora; as duas pontas são inclusivas). Filtro opcional por client_id (ids vêm de list_clients). O período tem no máximo 100 dias e a resposta traz até 500 ocorrências (acima disso vem truncated: true). Cada item traz occurrence_id (use em get, update e delete), start e end em UTC (ISO), start_date e end_date como datas locais no fuso do evento (end_date inclusivo) e participantes. Eventos privados de uma chave de API aparecem como \"Ocupado\" e eventos recorrentes aparecem uma vez por ocorrência.",
    {
      from: z.string(),
      to: z.string(),
      client_id: z.number().int().positive().optional(),
    },
    (a) => listAgendaEvents(deps, a),
    (a, r) => ({ from: a.from, to: a.to, client_id: a.client_id, count: r?.events?.length ?? 0 }));

  register(server, deps, "get_agenda_event", "agenda:read",
    "Devolve uma ocorrência da Agenda pelo occurrence_id (vem de list_agenda_events), com start e end em UTC (ISO), start_date e end_date como datas locais no fuso do evento, recorrência e participantes (member_id de cada um). Evento privado de uma chave de API volta como \"Ocupado\".",
    { occurrence_id: OCCURRENCE_ID },
    (a) => getAgendaEvent(deps, a),
    (a) => ({ occurrence_id: a.occurrence_id }));

  register(server, deps, "create_agenda_event", "agenda:write",
    "Cria um evento na Agenda. Com horário, start e end são a hora local YYYY-MM-DDTHH:MM no fuso do evento (segundos são aceitos; um instante ISO com Z ou offset é convertido para esse fuso), e timezone é o nome IANA (padrão America/Sao_Paulo). Dia inteiro usa start_date e end_date YYYY-MM-DD, os dois inclusivos. client_id vem de list_clients e participant_member_ids de list_members; recurrence cria uma série (weekly sem weekdays usa o dia da semana do início; monthly sem monthly_mode usa dia_mes; weekdays 0 = domingo). reminders são minutos antes do início (até 5); em evento de dia inteiro contam a partir de 00:00 do primeiro dia, e negativo é durante esse dia (-540 = no dia às 9h). Devolve event_id e occurrence_id.",
    {
      title: z.string().min(1).max(200),
      timezone: z.string().max(64).optional(),
      ...WRITE_SHAPE,
    },
    (a) => createAgendaEvent(deps, a),
    (a, r) => ({
      client_id: a.client_id,
      fields: allChangedNames(a),
      participants: a.participant_member_ids?.length ?? 0,
      occurrence_id: r?.occurrence_id,
    }));

  register(server, deps, "update_agenda_event", "agenda:write",
    "Edita um evento da Agenda a partir do occurrence_id (de list_agenda_events); só os campos enviados mudam. scope diz o que editar: this (só esta ocorrência), this_and_following ou all (a série toda). Para mudar o horário envie start e end juntos (hora local YYYY-MM-DDTHH:MM no fuso do evento) ou start_date e end_date juntos (dia inteiro, inclusivos). Não há timezone na edição: o fuso da série é fixo desde a criação. reminders são minutos antes do início (até 5); em evento de dia inteiro contam a partir de 00:00 do primeiro dia, e negativo é durante esse dia (-540 = no dia às 9h). participant_member_ids SUBSTITUI a lista inteira de participantes (quem ficar de fora é removido, com a resposta): envie a lista completa, com os member_id atuais vindos de get_agenda_event.",
    {
      occurrence_id: OCCURRENCE_ID,
      scope: SCOPE,
      title: z.string().min(1).max(200).optional(),
      ...WRITE_SHAPE,
    },
    (a) => updateAgendaEvent(deps, a),
    (a) => ({ occurrence_id: a.occurrence_id, scope: a.scope, fields: allChangedNames(a) }));

  register(server, deps, "delete_agenda_event", "agenda:write",
    "Exclui um evento da Agenda a partir do occurrence_id (de list_agenda_events). scope é obrigatório: this (só esta ocorrência), this_and_following ou all (a série toda). A exclusão não pode ser desfeita.",
    { occurrence_id: OCCURRENCE_ID, scope: SCOPE },
    (a) => deleteAgendaEvent(deps, a),
    (a) => ({ occurrence_id: a.occurrence_id, scope: a.scope }));
}
