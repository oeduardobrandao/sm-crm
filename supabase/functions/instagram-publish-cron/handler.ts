// supabase/functions/instagram-publish-cron/handler.ts

interface PublishCronDeps {
  cronSecret: string;
  timingSafeEqual: (a: string, b: string) => boolean;
  run: (req: Request) => Promise<Response>;
}

export function createPublishCronHandler(deps: PublishCronDeps) {
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
