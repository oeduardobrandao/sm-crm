// Thin cron-secret auth gate — mirrors instagram-sync-cron/handler.ts and
// retention-radar-cron/handler.ts exactly. The secret check runs BEFORE `run` is invoked, so
// no DB access happens on an unauthorized request.
interface TikTokRefreshCronDeps {
  cronSecret: string;
  run: (req: Request) => Promise<Response>;
  timingSafeEqual: (a: string, b: string) => boolean;
}

export function createTikTokRefreshCronHandler(deps: TikTokRefreshCronDeps) {
  return async (req: Request): Promise<Response> => {
    if (!deps.timingSafeEqual(req.headers.get("x-cron-secret") ?? "", deps.cronSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    return deps.run(req);
  };
}
