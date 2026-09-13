import { createJsonResponder, internalServerError } from "../_shared/http.ts";
import { resolveHubToken, type HubToken } from "../_shared/hub-token.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
import { getClientIP } from "../_shared/rate-limit.ts";
import {
  AUDIO_COLUMNS,
  buildAudioView,
  finalizeBriefingAudio,
  presignBriefingAudio,
  removeBriefingAudio,
  transcribeBriefingAudio,
  type AudioRow,
  type Transcriber,
} from "../_shared/briefing-audio.ts";

type DbClient = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

interface HubBriefingHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  rateLimit: (db: DbClient, key: string, max: number, windowSeconds: number) => Promise<boolean>;
  signPutUrl: (key: string, mime: string) => Promise<string>;
  signGetUrl: (key: string, expiresSeconds?: number) => Promise<string>;
  headObject: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;
  transcribe: Transcriber | null;
  randomUUID?: () => string;
}

const AUDIO_WRITE_MAX = 20;
const AUDIO_WRITE_WINDOW = 3600;

export function createHubBriefingHandler(deps: HubBriefingHandlerDeps) {
  const signGet = (key: string) => deps.signGetUrl(key, 3600);

  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const db = deps.createDb();
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("hub-briefing");
    const seg = idx >= 0 ? parts.slice(idx + 1) : [];
    const isPresign = seg.length === 1 && seg[0] === "upload-url";
    const questionId = seg[0] && seg[0].length === 36 ? seg[0] : null;
    const isAudio = !!questionId && seg.length === 2 && seg[1] === "audio";
    const isTranscribe = !!questionId && seg.length === 3 && seg[1] === "audio" && seg[2] === "transcribe";

    const resolveOrReject = async (token: string | null | undefined): Promise<HubToken | Response> => {
      if (!token) return json({ error: "token required" }, 400);
      const hubToken = await resolveHubToken(db as never, token, deps.now());
      if (!hubToken) {
        const okBadToken = await deps.rateLimit(db, `hub-badtoken:${getClientIP(req)}`, 30, 600);
        if (!okBadToken) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
        return json({ error: "Link inválido." }, 404);
      }
      const okRead = await deps.rateLimit(db, `hub-read:${hubToken.conta_id}:${hubToken.cliente_id}`, 300, 300);
      if (!okRead) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
      return hubToken;
    };

    // ── Rotas de áudio ────────────────────────────────────────────
    if (isPresign || isAudio || isTranscribe) {
      let body: Record<string, unknown> = {};
      if (req.method === "POST") {
        try {
          body = await req.json();
        } catch {
          return json({ error: "Invalid JSON" }, 400);
        }
      } else if (req.method !== "DELETE" || !isAudio) {
        return json({ error: "Method not allowed" }, 405);
      }
      const token = req.method === "DELETE"
        ? url.searchParams.get("token")
        : (typeof body.token === "string" ? body.token : null);
      const resolved = await resolveOrReject(token);
      if (resolved instanceof Response) return resolved;
      const hubToken = resolved;

      // Gate de plano: só a ESCRITA de áudio é paga. O DELETE fica de fora de
      // propósito — depois de um downgrade o cliente ainda pode ouvir (GET) e
      // remover o que já havia gravado, só não pode gravar/transcrever mais.
      if (isPresign || isTranscribe || (isAudio && req.method === "POST")) {
        const audioOn = await effectivePlanFeature(
          db as never,
          hubToken.conta_id,
          "feature_briefing_audio",
        );
        if (!audioOn) return json({ error: "Recurso indisponível no plano atual." }, 403);
      }

      const okWrite = await deps.rateLimit(
        db,
        `hub-write:hub-briefing-audio:${hubToken.conta_id}:${hubToken.cliente_id}`,
        AUDIO_WRITE_MAX,
        AUDIO_WRITE_WINDOW,
      );
      if (!okWrite) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);

      if (isPresign) {
        const question_id = typeof body.question_id === "string" ? body.question_id : "";
        if (!question_id || typeof body.mime_type !== "string" || typeof body.size_bytes !== "number") {
          return json({ error: "question_id, mime_type and size_bytes are required" }, 400);
        }
        const r = await presignBriefingAudio({
          db,
          conta_id: hubToken.conta_id,
          cliente_id: hubToken.cliente_id,
          question_id,
          mime_type: body.mime_type,
          size_bytes: body.size_bytes,
          signPutUrl: deps.signPutUrl,
          randomUUID: deps.randomUUID,
        });
        return json(r.body, r.status);
      }

      if (isAudio && req.method === "POST") {
        if (
          typeof body.r2_key !== "string" || typeof body.mime_type !== "string" ||
          typeof body.size_bytes !== "number"
        ) {
          return json({ error: "r2_key, mime_type and size_bytes are required" }, 400);
        }
        const r = await finalizeBriefingAudio({
          db,
          conta_id: hubToken.conta_id,
          cliente_id: hubToken.cliente_id,
          question_id: questionId!,
          r2_key: body.r2_key,
          mime_type: body.mime_type,
          size_bytes: body.size_bytes,
          duration_seconds: typeof body.duration_seconds === "number" ? body.duration_seconds : null,
          headObject: deps.headObject,
          signGetUrl: signGet,
          transcribe: deps.transcribe,
        });
        return json(r.body, r.status);
      }

      if (isAudio && req.method === "DELETE") {
        const r = await removeBriefingAudio({
          db,
          conta_id: hubToken.conta_id,
          cliente_id: hubToken.cliente_id,
          question_id: questionId!,
        });
        return json(r.body, r.status);
      }

      // isTranscribe
      const r = await transcribeBriefingAudio({
        db,
        conta_id: hubToken.conta_id,
        cliente_id: hubToken.cliente_id,
        question_id: questionId!,
        signGetUrl: signGet,
        transcribe: deps.transcribe,
      });
      return json(r.body, r.status);
    }

    if (req.method === "GET") {
      const resolved = await resolveOrReject(url.searchParams.get("token"));
      if (resolved instanceof Response) return resolved;
      const hubToken = resolved;

      // Parent query: briefings drive the response so empty briefings still render.
      const { data: briefings, error: bErr } = await db
        .from("briefings")
        .select("id, title, display_order")
        .eq("cliente_id", hubToken.cliente_id)
        .order("display_order")
        .order("created_at");
      if (bErr) return internalServerError(json, "hub-briefing:list-briefings", bErr);

      const { data: questions, error: qErr } = await db
        .from("hub_briefing_questions")
        .select(`id, question, answer, section, display_order, briefing_id, ${AUDIO_COLUMNS}`)
        .eq("cliente_id", hubToken.cliente_id)
        .order("display_order");
      if (qErr) return internalServerError(json, "hub-briefing:list-questions", qErr);

      const list = (briefings ?? []) as Array<{ id: string; title: string; display_order: number }>;
      type QRow = AudioRow & {
        id: string;
        question: string;
        answer: string | null;
        section: string | null;
        display_order: number;
        briefing_id: string | null;
      };
      const qs = await Promise.all(((questions ?? []) as QRow[]).map(async (q) => {
        // Assinar a URL do áudio é I/O externo: se o R2 falhar numa pergunta,
        // ela perde só o player — o briefing inteiro não pode virar 500.
        let audio = null;
        try {
          audio = await buildAudioView(q, signGet);
        } catch (e) {
          console.error("hub-briefing:sign-audio", q.id, (e as Error).message ?? e);
        }
        return {
          id: q.id,
          question: q.question,
          answer: q.answer,
          section: q.section,
          display_order: q.display_order,
          briefing_id: q.briefing_id,
          audio,
        };
      }));
      const strip = ({ briefing_id: _b, ...rest }: (typeof qs)[number]) => rest;

      // Legacy rows with a null briefing_id coalesce into the first briefing.
      const firstId = list[0]?.id ?? null;
      const grouped = list.map((b) => ({
        id: b.id,
        title: b.title,
        display_order: b.display_order,
        questions: qs.filter((q) => (q.briefing_id ?? firstId) === b.id).map(strip),
      }));

      // Backward-compat: orphan questions with no parent briefing row surface under a
      // synthetic default briefing so they never disappear from the portal.
      if (list.length === 0 && qs.length > 0) {
        return json({
          briefings: [{ id: "__default__", title: "Briefing", display_order: 0, questions: qs.map(strip) }],
        });
      }
      return json({ briefings: grouped });
    }

    if (req.method === "POST") {
      let body: { token?: string; question_id?: string; answer?: string };
      try {
        body = await req.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }
      const { token, question_id, answer } = body;
      if (!token || !question_id || answer === undefined) {
        return json({ error: "token, question_id, and answer are required" }, 400);
      }
      const resolved = await resolveOrReject(token);
      if (resolved instanceof Response) return resolved;
      const hubToken = resolved;

      const okWrite = await deps.rateLimit(
        db,
        `hub-write:hub-briefing:${hubToken.conta_id}:${hubToken.cliente_id}`,
        30,
        3600,
      );
      if (!okWrite) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);

      const { data: question } = await db
        .from("hub_briefing_questions")
        .select("id")
        .eq("id", question_id)
        .eq("cliente_id", hubToken.cliente_id)
        .maybeSingle();
      if (!question) return json({ error: "Pergunta não encontrada." }, 404);

      const { error } = await db
        .from("hub_briefing_questions")
        .update({ answer })
        .eq("id", question_id)
        .eq("cliente_id", hubToken.cliente_id);
      if (error) return internalServerError(json, "hub-briefing:update-answer", error);
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  };
}
