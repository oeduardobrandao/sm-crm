import { assert, assertEquals } from "./assert.ts";
import { McpInputError } from "../_shared/mcp-token.ts";
import { throwTaskWriteError } from "../mcp/task-errors.ts";

function capture(fn: () => never): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

Deno.test("throwTaskWriteError: 23514 on tarefas_serie_exige_prazo -> McpInputError pt-BR", () => {
  const e = capture(() =>
    throwTaskWriteError({
      code: "23514",
      message:
        'new row for relation "tarefas" violates check constraint "tarefas_serie_exige_prazo"',
    })
  );
  assert(e instanceof McpInputError);
  assertEquals((e as Error).message, "Tarefas de uma série precisam de prazo.");
});

Deno.test("throwTaskWriteError: 23505 on tarefas_serie_data_uq -> McpInputError pt-BR", () => {
  const e = capture(() =>
    throwTaskWriteError({
      code: "23505",
      message: 'duplicate key value violates unique constraint "tarefas_serie_data_uq"',
    })
  );
  assert(e instanceof McpInputError);
  assertEquals((e as Error).message, "Já existe uma ocorrência desta série nessa data.");
});

Deno.test("throwTaskWriteError: anything else is rethrown untouched", () => {
  const original = { code: "23505", message: "other unique" };
  const e = capture(() => throwTaskWriteError(original));
  assert(!(e instanceof McpInputError));
  assertEquals(e, original);
});
