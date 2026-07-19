import { timingSafeEqual } from "../_shared/crypto.ts";
import { sendWorkspaceCreatedEmail } from "../_shared/notify.ts";
import { createWorkspaceCreatedNotifyHandler } from "./handler.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? (() => { throw new Error("CRON_SECRET is required"); })();

Deno.serve(createWorkspaceCreatedNotifyHandler({
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async (req) => {
    try {
      const body = await req.json().catch(() => ({}));
      const workspaceName = typeof body.workspace_name === "string" ? body.workspace_name : "?";
      const ownerEmail = typeof body.owner_email === "string" ? body.owner_email : "?";
      const contaId = typeof body.conta_id === "string" ? body.conta_id : "?";

      await sendWorkspaceCreatedEmail({
        workspaceName,
        ownerEmail,
        contaId,
        createdAt: new Date().toISOString(),
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: unknown) {
      console.error("workspace-created-notify failed:", err instanceof Error ? err.message : "unknown");
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
}));
