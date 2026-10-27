/**
 * blog-view: contador público de visualizações do blog (sem sessão, deploy com
 * --no-verify-jwt). A página do post faz POST { slug } uma vez por visita.
 *
 * Privacidade: visitor_hash = sha256(sal_do_dia + ip + user_agent), usado só para deduplicar
 * em 30 min dentro do record_blog_view. O sal vive só até o fim do dia de São Paulo, então
 * depois disso nem nós ligamos um hash a um IP. IP e UA brutos nunca são gravados, logados
 * nem usados como chave de rate limit. O sal é lido a CADA requisição contada, nunca guardado
 * em memória do módulo.
 *
 * Sempre responde 204 (exceto 405): descartes, rate limit e erros internos não aparecem para
 * o cliente; erros vão só para o log.
 *
 * Spec: docs/superpowers/specs/2026-10-27-blog-metrics-design.md
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { BLOG_SLUG_RE, isLiveBlogSlug } from "../_shared/blog-live.ts";
import { isBotUserAgent, sha256Hex } from "./logic.ts";

export interface BlogViewDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  db: SupabaseClient;
  rateLimit: (key: string, max: number, windowSeconds: number) => Promise<boolean>;
  getClientIP: (req: Request) => string;
}

const RATE_MAX = 120;
const RATE_WINDOW_SECONDS = 3600;
const MAX_BODY_CHARS = 1024;

async function readSlug(req: Request): Promise<string | null> {
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_CHARS) return null;
    const body = JSON.parse(text) as { slug?: unknown } | null;
    const slug = body?.slug;
    return typeof slug === "string" && BLOG_SLUG_RE.test(slug) ? slug : null;
  } catch {
    return null;
  }
}

export function createBlogViewHandler(deps: BlogViewDeps) {
  const { db } = deps;

  return async function handler(req: Request): Promise<Response> {
    const cors = deps.buildCorsHeaders(req);
    const noContent = () => new Response(null, { status: 204, headers: cors });

    if (req.method === "OPTIONS") return noContent();
    if (req.method !== "POST") return new Response(null, { status: 405, headers: cors });

    try {
      const ua = req.headers.get("user-agent");
      if (isBotUserAgent(ua)) return noContent();

      const slug = await readSlug(req);
      if (!slug || !(await isLiveBlogSlug(db, slug))) return noContent();

      const { data: salt, error: saltError } = await db.rpc("blog_view_salt_today");
      if (saltError || typeof salt !== "string" || !salt) {
        console.error("[blog-view] salt unavailable", saltError?.message);
        return noContent();
      }

      const ip = deps.getClientIP(req);
      const ipKey = await sha256Hex(salt + ip);
      if (!(await deps.rateLimit(`blog-view:${ipKey}`, RATE_MAX, RATE_WINDOW_SECONDS))) return noContent();

      const visitorHash = await sha256Hex(salt + ip + (ua ?? ""));
      const { error } = await db.rpc("record_blog_view", { p_slug: slug, p_visitor_hash: visitorHash });
      if (error) console.error("[blog-view] record failed", error.message);
    } catch (err) {
      // PostgREST errors are plain objects, not Error instances.
      console.error("[blog-view] unexpected error", (err as { message?: string } | null)?.message ?? "unknown");
    }
    return noContent();
  };
}
