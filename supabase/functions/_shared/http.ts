export type JsonResponder = (body: unknown, status?: number) => Response;

export function createJsonResponder(cors: Record<string, string>): JsonResponder {
  return (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
}

export function internalServerError(
  json: JsonResponder,
  scope: string,
  error: unknown,
): Response {
  console.error(`[${scope}] unexpected error`, error);
  return json({ error: "Internal server error" }, 500);
}
