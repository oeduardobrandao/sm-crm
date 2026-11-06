// Handler for resend-webhook. Server-to-server: no CORS, POST only. Authenticated by the Svix
// signature. Never log the payload, recipient or error details (LGPD).

import { classifyEmail, EMAIL_TYPES, eventFromWebhookType, PII_EVENTS } from "../_shared/email-classify.ts";
import { verifySvixSignature } from "../_shared/svix-verify.ts";

export interface ApplyEventArgs {
  svixId: string;
  emailId: string;
  event: string;
  sentAt: string;
  category: string;
  type: string;
  hasTag: boolean;
  bounceType: string | null;
  bounceSubtype: string | null;
  bounceMessage: string | null;
  recipient: string | null;
  subject: string | null;
}

export interface ResendWebhookDeps {
  secret: string;
  now: () => number; // ms
  applyEvent: (args: ApplyEventArgs) => Promise<boolean>;
}

const text = (body: string, status: number) => new Response(body, { status });
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export async function handleResendWebhook(req: Request, deps: ResendWebhookDeps): Promise<Response> {
  if (req.method !== "POST") return text("Method not allowed", 405);

  const body = await req.text();
  const svixId = req.headers.get("svix-id");
  const valid = await verifySvixSignature({
    secret: deps.secret,
    id: svixId,
    timestamp: req.headers.get("svix-timestamp"),
    signature: req.headers.get("svix-signature"),
    body,
    nowSeconds: Math.floor(deps.now() / 1000),
  });
  if (!valid || !svixId) return text("Unauthorized", 401);

  let payload: { type?: unknown; data?: Record<string, unknown> };
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object") return text("Invalid payload", 400);
    payload = parsed;
  } catch {
    return text("Invalid payload", 400);
  }

  const event = typeof payload.type === "string" ? eventFromWebhookType(payload.type) : null;
  if (!event) return text("ok", 200);

  const data = payload.data ?? {};
  const emailId = str(data.email_id);
  const sentAt = str(data.created_at);
  if (!emailId || !sentAt) return text("Invalid payload", 400);

  const rawTags = data.tags && typeof data.tags === "object" && !Array.isArray(data.tags)
    ? data.tags as Record<string, unknown>
    : {};
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawTags)) if (typeof v === "string") tags[k] = v;

  const { category, type } = classifyEmail({
    tags,
    from: str(data.from) ?? "",
    subject: str(data.subject) ?? "",
  });

  const pii = PII_EVENTS.has(event);
  const bounce = data.bounce && typeof data.bounce === "object"
    ? data.bounce as Record<string, unknown>
    : {};
  const failed = data.failed && typeof data.failed === "object"
    ? data.failed as Record<string, unknown>
    : {};
  const suppressed = data.suppressed && typeof data.suppressed === "object"
    ? data.suppressed as Record<string, unknown>
    : {};
  let bounceType = str(bounce.type);
  let bounceMessage = str(bounce.message);
  if (event === "failed") bounceMessage = str(failed.reason);
  if (event === "suppressed") {
    bounceType = str(suppressed.type);
    bounceMessage = str(suppressed.message);
  }
  const to = Array.isArray(data.to) ? str(data.to[0]) : null;

  try {
    await deps.applyEvent({
      svixId,
      emailId,
      event,
      sentAt,
      category,
      type,
      hasTag: typeof tags.type === "string" &&
        Object.prototype.hasOwnProperty.call(EMAIL_TYPES, tags.type),
      bounceType: pii ? bounceType : null,
      bounceSubtype: pii ? str(bounce.subType) : null,
      bounceMessage: pii ? bounceMessage : null,
      recipient: pii ? to : null,
      subject: pii ? str(data.subject) : null,
    });
  } catch {
    console.error("[resend-webhook] apply failed");
    return text("Handler error", 500);
  }
  return text("ok", 200);
}
