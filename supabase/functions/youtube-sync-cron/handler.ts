// Thin cron-secret auth gate, same as tiktok-sync-cron/handler.ts. The secret check runs BEFORE
// `run` is invoked, so no DB access happens on an unauthorized request.
interface YouTubeSyncCronHandlerDeps {
  cronSecret: string;
  run: (req: Request) => Promise<Response>;
  timingSafeEqual: (a: string, b: string) => boolean;
}

export function createYouTubeSyncCronHandler(deps: YouTubeSyncCronHandlerDeps) {
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
