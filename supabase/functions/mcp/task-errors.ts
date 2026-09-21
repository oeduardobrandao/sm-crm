import { McpInputError } from "../_shared/mcp-token.ts";

/** Maps the two constraint failures a task write can hit because of series
 *  occurrences to agent-readable pt-BR errors; rethrows everything else.
 *  Generic messages only: never leak raw Postgres details to the client. */
export function throwTaskWriteError(error: { code?: string; message?: string }): never {
  const msg = error.message ?? "";
  if (error.code === "23514" && msg.includes("tarefas_serie_exige_prazo")) {
    throw new McpInputError("Tarefas de uma série precisam de prazo.");
  }
  if (error.code === "23505" && msg.includes("tarefas_serie_data_uq")) {
    throw new McpInputError("Já existe uma ocorrência desta série nessa data.");
  }
  throw error;
}
