import { assertEquals } from "./assert.ts";
import { createJsonResponder, internalServerError } from "../_shared/http.ts";

Deno.test("internalServerError logs details but returns a generic payload", async () => {
  const calls: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => calls.push(args);
  try {
    const json = createJsonResponder({
      "Access-Control-Allow-Origin": "https://app.example",
    });
    const response = internalServerError(
      json,
      "test-scope",
      new Error("db password leaked"),
    );

    assertEquals(response.status, 500);
    assertEquals(await response.json(), { error: "Internal server error" });
    assertEquals(calls.length, 1);
    assertEquals(String(calls[0][0]).includes("test-scope"), true);
  } finally {
    console.error = original;
  }
});
