// supabase/functions/tiktok-publish-cron/handler.ts
//
// Thin cron-secret auth gate — identical shape to instagram-publish-cron/handler.ts and
// tiktok-refresh-cron/handler.ts. The secret check runs BEFORE `run` is invoked, so no DB
// access happens on an unauthorized request.

interface TikTokPublishCronHandlerDeps {
  cronSecret: string;
  timingSafeEqual: (a: string, b: string) => boolean;
  run: (req: Request) => Promise<Response>;
}

export function createTikTokPublishCronHandler(deps: TikTokPublishCronHandlerDeps) {
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
