import { createJsonResponder } from "../_shared/http.ts";

interface InviteExpireCronDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  cronSecret: string;
  run: (req: Request, json: ReturnType<typeof createJsonResponder>) => Promise<Response>;
  timingSafeEqual: (a: string, b: string) => boolean;
}

export function createInviteExpireCronHandler(deps: InviteExpireCronDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (!deps.timingSafeEqual(req.headers.get("x-cron-secret") ?? "", deps.cronSecret)) {
      return json({ error: "Unauthorized" }, 401);
    }

    return deps.run(req, json);
  };
}
