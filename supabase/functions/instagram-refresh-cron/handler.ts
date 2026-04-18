interface InstagramRefreshCronDeps {
  cronSecret: string;
  run: (req: Request) => Promise<Response>;
  timingSafeEqual: (a: string, b: string) => boolean;
}

export function createInstagramRefreshCronHandler(deps: InstagramRefreshCronDeps) {
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
