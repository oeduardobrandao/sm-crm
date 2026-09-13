import { assertEquals } from "./assert.ts";
import {
  PERMISSION_MODULES,
  validateRolePermissions,
  hasPermissionFor,
} from "../_shared/permissions.ts";

Deno.test("catálogo tem exatamente os 14 módulos da spec", () => {
  assertEquals([...PERMISSION_MODULES].sort(), [
    "analytics", "aprovacoes", "arquivos", "automacoes", "calendario",
    "clientes", "configuracoes", "contratos", "entregas", "equipe",
    "financeiro", "ideias", "leads", "tarefas",
  ]);
});

Deno.test("validateRolePermissions aceita payload válido e rejeita inválidos", () => {
  assertEquals(validateRolePermissions({ clientes: "editar", leads: "none" }), null);
  assertEquals(validateRolePermissions({}), null);
  assertEquals(validateRolePermissions(null), "invalid_shape");
  assertEquals(validateRolePermissions([]), "invalid_shape");
  assertEquals(validateRolePermissions({ foo: "ver" }), "invalid_module");
  assertEquals(validateRolePermissions({ leads: "talvez" }), "invalid_level");
});

Deno.test("hasPermissionFor devolve o boolean do RPC e falha fechado em erro", async () => {
  const okClient = { rpc: () => Promise.resolve({ data: true, error: null }) };
  assertEquals(await hasPermissionFor(okClient as never, "u", "w", "leads", "ver"), true);
  const errClient = { rpc: () => Promise.resolve({ data: null, error: { message: "boom" } }) };
  assertEquals(await hasPermissionFor(errClient as never, "u", "w", "leads", "ver"), false);
  const throwClient = { rpc: () => Promise.reject(new Error("net")) };
  assertEquals(await hasPermissionFor(throwClient as never, "u", "w", "leads", "ver"), false);
});
