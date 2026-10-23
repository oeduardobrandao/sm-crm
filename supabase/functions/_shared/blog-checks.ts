// Checks automáticos de um rascunho do blog (spec 2026-10-23-blog-automatico §3). Rodam no
// create/update (mcp-admin) e no Editar texto do Admin (platform-admin) e ficam gravados em
// blog_posts.checks; falhar não impede salvar nem aprovar, só vira chip vermelho no Admin. Nada aqui lança: um check que não consegue rodar devolve
// o resultado neutro e loga.
// deno-lint-ignore-file no-explicit-any
import { BLOG_FILE_POSTS } from "./blog-file-posts.ts";
import { collectBodyLinkUrls } from "./blog-validate.ts";
import { checkPublicHost, isAbortError, withDeadline } from "./safe-image-fetch.ts";

export interface BlogChecks {
  links: { ok: boolean; broken: string[] };
  images: { ok: boolean; missing_license: string[] };
  cover: boolean;
  copy: { em_dash: boolean; meta_endorsement: boolean };
  similar_titles: string[];
}

export interface BlogCheckPost {
  id?: string | null;
  title?: unknown;
  h1?: unknown;
  description?: unknown;
  lede?: unknown;
  body_md?: unknown;
  cover_image?: unknown;
  images?: unknown;
  sources?: unknown;
}

export const LINK_CHECK_MAX_URLS = 20;
export const LINK_CHECK_TIMEOUT_MS = 5_000;
export const SIMILAR_TITLE_THRESHOLD = 0.6;
export const SIMILAR_TITLE_WINDOW_DAYS = 60;

/** O que os checks precisam do mundo (mcp-admin e platform-admin passam os seus). */
export interface BlogCheckDeps {
  db: any;
  /** Instante atual em ISO. */
  now: () => string;
  resolveDns: (hostname: string, recordType: "A" | "AAAA") => Promise<string[]>;
  fetchUrl: (url: string, init: RequestInit) => Promise<Response>;
}
type CheckDeps = BlogCheckDeps;


const text = (v: unknown): string => (typeof v === "string" ? v : "");
const records = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];

/** URLs http(s) únicas, na ordem: fontes primeiro, depois links do corpo. */
export function collectLinkUrls(post: BlogCheckPost): string[] {
  const urls: string[] = [];
  for (const s of records(post.sources)) if (typeof s.url === "string") urls.push(s.url);
  urls.push(...collectBodyLinkUrls(text(post.body_md)));
  return [...new Set(urls.filter((u) => /^https?:\/\//i.test(u)))];
}

/** Uma requisição com o mesmo prazo no AbortSignal e num relógio próprio: um fetch que
 * ignora o signal ainda assim termina em `timeout`. */
async function request(d: CheckDeps, url: string, method: "HEAD" | "GET", ms: number): Promise<Response | "timeout" | "error"> {
  try {
    return await withDeadline(
      d.fetchUrl(url, { method, redirect: "manual", signal: AbortSignal.timeout(ms), headers: { Accept: "*/*" } }),
      ms,
    );
  } catch (e) {
    return isAbortError(e) || (e instanceof Error && e.message === "deadline exceeded") ? "timeout" : "error";
  }
}

/** 2xx ou 3xx = o link responde (redirect não é seguido: o destino não é buscado). */
const answers = (r: Response) => r.status >= 200 && r.status < 400;

async function linkAnswers(d: CheckDeps, raw: string, ms: number): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  // Risco residual aceito: DNS rebinding entre checkPublicHost e o fetch (o fetch do Deno não
  // permite pinar o IP). Mitigado porque o corpo nunca é lido nem devolvido (só o status),
  // redirects não são seguidos e porta explícita é recusada.
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.port !== "") {
    return false;
  }
  if ((await checkPublicHost({ resolveDns: d.resolveDns, dnsTimeoutMs: ms }, url.hostname)) !== "ok") return false;

  const head = await request(d, url.toString(), "HEAD", ms);
  if (head instanceof Response) {
    await head.body?.cancel().catch(() => undefined);
    if (answers(head)) return true;
  } else if (head === "timeout") {
    return false;
  }
  const get = await request(d, url.toString(), "GET", ms);
  if (!(get instanceof Response)) return false;
  await get.body?.cancel().catch(() => undefined);
  return answers(get);
}

async function checkLinks(d: CheckDeps, post: BlogCheckPost, ms: number): Promise<BlogChecks["links"]> {
  const urls = collectLinkUrls(post).slice(0, LINK_CHECK_MAX_URLS);
  const settled = await Promise.allSettled(urls.map((u) => linkAnswers(d, u, ms)));
  const broken = urls.filter((_, i) => {
    const r = settled[i];
    return r.status === "rejected" || r.value === false;
  });
  return { ok: broken.length === 0, broken };
}

function blank(v: unknown): boolean {
  return typeof v !== "string" || v.trim() === "";
}

function checkImages(post: BlogCheckPost): BlogChecks["images"] {
  const missing: string[] = [];
  const cover = post.cover_image;
  if (cover && typeof cover === "object") {
    const c = cover as Record<string, unknown>;
    if (blank(c.credit) || blank(c.license)) missing.push("capa");
  }
  records(post.images).forEach((img, i) => {
    if (blank(img.credit) || blank(img.license)) missing.push(typeof img.key === "string" ? img.key : `images[${i}]`);
  });
  return { ok: missing.length === 0, missing_license: missing };
}

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function checkCopy(post: BlogCheckPost): BlogChecks["copy"] {
  const all = [post.title, post.h1, post.description, post.lede, post.body_md].map(text).join("\n");
  return {
    em_dash: all.includes("\u2014"),
    meta_endorsement: /aprovad[oa]s?\s+pel[oa]\s+meta\b/.test(normalize(all)),
  };
}

function words(title: string): Set<string> {
  return new Set(normalize(title).replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean));
}

/** Jaccard dos conjuntos de palavras normalizadas (sem acento, caixa ou pontuação). */
export function titleSimilarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

async function similarTitles(d: CheckDeps, post: BlogCheckPost): Promise<string[]> {
  const title = text(post.title);
  if (!title) return [];
  const since = new Date(Date.parse(d.now()) - SIMILAR_TITLE_WINDOW_DAYS * 86_400_000).toISOString();
  let rows: Array<{ id?: unknown; title?: unknown }> = [];
  try {
    const { data, error } = await d.db.from("blog_posts").select("id, title").gte("created_at", since);
    if (error) throw error;
    rows = Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("[blog-checks] similar titles query failed:", e);
  }
  const candidates = [
    ...rows.filter((r) => r.id !== post.id && typeof r.title === "string").map((r) => r.title as string),
    ...BLOG_FILE_POSTS.map((p) => p.title),
  ];
  const out = candidates.filter((t) => titleSimilarity(title, t) >= SIMILAR_TITLE_THRESHOLD);
  return [...new Set(out)];
}

export async function runBlogChecks(
  d: CheckDeps,
  post: BlogCheckPost,
  opts: { linkTimeoutMs?: number } = {},
): Promise<BlogChecks> {
  const ms = opts.linkTimeoutMs ?? LINK_CHECK_TIMEOUT_MS;
  const [links, similar] = await Promise.all([
    checkLinks(d, post, ms).catch((e) => {
      console.error("[blog-checks] link check failed:", e);
      return { ok: false, broken: [] as string[] };
    }),
    similarTitles(d, post),
  ]);
  return {
    links,
    images: checkImages(post),
    cover: !!post.cover_image && typeof post.cover_image === "object",
    copy: checkCopy(post),
    similar_titles: similar,
  };
}
