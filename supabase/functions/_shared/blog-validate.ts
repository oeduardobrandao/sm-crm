// Validação dos campos de um rascunho do blog (spec 2026-10-23-blog-automatico §2 e §4).
// Usada pelo mcp-admin (rotina) e pelo platform-admin (editor do Admin). Cada erro é uma
// linha "campo: problema; limite", em pt-BR, para quem escreveu conseguir corrigir e tentar
// de novo sem adivinhar. Os limites vêm de blog-rules.ts (espelho do modelo do CRM); lede
// segue o dbPostSchema do CRM (1 a 300).
import { z } from "npm:zod@3";
import { fromMarkdown } from "npm:mdast-util-from-markdown@2.0.3";
import { gfm } from "npm:micromark-extension-gfm@3.0.0";
import { gfmFromMarkdown } from "npm:mdast-util-gfm@3.1.0";
import {
  BLOG_CATEGORIES,
  BLOG_FEATURE_SLUGS,
  BLOG_LIMITS,
  blogImageSchema,
  blogSourceSchema,
  validateInfograficos,
} from "./blog-rules.ts";

export const BLOG_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const BLOG_DRAFT_LIMITS = {
  slug: [3, 80],
  lede: [1, 300],
  body_md: [1, 50_000],
  topic_reason: [1, 500],
  sources: [1, 20],
  images: [0, 20],
} as const;

export const BLOG_DRAFT_FIELDS = [
  "slug",
  "category",
  "title",
  "h1",
  "description",
  "lede",
  "body_md",
  "cover_image",
  "images",
  "sources",
  "feature_slug",
  "topic_reason",
] as const;
export type BlogDraftField = (typeof BLOG_DRAFT_FIELDS)[number];
export type BlogDraftValues = Partial<Record<BlogDraftField, unknown>>;

export type BlogDraftValidation =
  | { ok: true; value: BlogDraftValues }
  | { ok: false; errors: string[] };

export interface BlogDraftValidateOptions {
  /** true: só valida os campos presentes (edição campo a campo). */
  partial: boolean;
  /** Quando informado, url da capa e das imagens precisa começar com ele (bucket blog-images). */
  imageUrlPrefix?: string;
}

const OPTIONAL: ReadonlySet<BlogDraftField> = new Set(["cover_image", "images", "feature_slug"]);

const IMG_TARGET = /^img:([a-z0-9-]{1,40})$/;

const coverSchema = blogImageSchema.omit({ key: true });

function len(value: string): number {
  return value.length;
}

function rangeMessage(field: string, value: string, [min, max]: readonly [number, number]): string | null {
  const n = len(value);
  if (n >= min && n <= max) return null;
  return `${field}: ${n} caracteres; precisa ter de ${min} a ${max}.`;
}

const SITE_BASE = "https://site.invalid";

/** Normaliza como o browser (WHATWG) e como sanitizeUrl do CRM / safe-href do blog: tira
 * tab/CR/LF de qualquer posição, também na forma %09/%0a/%0d, e controles C0 e espaços nas
 * pontas. Sem isso `/\t/evil.com` passaria como caminho e o browser abriria //evil.com. */
export function normalizeLinkTarget(target: string): string {
  return target
    .replace(/[\t\r\n]|%0[9ad]/gi, "")
    .replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "");
}

/** Link http(s) absoluto sem porta, caminho do site (/…) ou âncora (#…), depois de
 * normalizado. Qualquer caractere de controle restante recusa. */
export function isAllowedLinkTarget(raw: string): boolean {
  const target = normalizeLinkTarget(raw);
  if (/[\u0000-\u001f\u007f]/.test(target)) return false;
  if (target.startsWith("#")) return true;
  if (target.startsWith("/")) {
    if (/\\|%5c/i.test(target) || target.startsWith("//")) return false;
    try {
      return new URL(target, SITE_BASE).origin === SITE_BASE;
    } catch {
      return false;
    }
  }
  if (!/^https?:\/\//i.test(target)) return false;
  try {
    const u = new URL(target);
    return (u.protocol === "http:" || u.protocol === "https:") && !u.username && !u.password && u.port === "";
  } catch {
    return false;
  }
}

/** True se `url` fica dentro de `prefix` depois de normalizada: sem credenciais, sem porta,
 * sem segmentos . / .. (literais ou codificados) e com o href normalizado começando pelo
 * prefixo. `new URL` resolve "../" sozinho, então a comparação é feita no href resultante. */
export function isUnderUrlPrefix(url: string, prefix: string): boolean {
  if (/%2e|%2f|%5c|\\/i.test(url)) return false;
  let u: URL;
  let p: URL;
  try {
    u = new URL(url);
    p = new URL(prefix);
  } catch {
    return false;
  }
  if (u.username || u.password || u.port !== "") return false;
  const rawPath = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "").split(/[?#]/)[0];
  if (rawPath.split("/").some((seg) => seg === "." || seg === "..")) return false;
  return u.origin === p.origin && (u.origin + u.pathname).startsWith(p.origin + p.pathname);
}

type ZodIssueLike = {
  code: string;
  path: PropertyKey[];
  minimum?: unknown;
  maximum?: unknown;
  type?: string;
  received?: string;
  expected?: unknown;
  keys?: string[];
  validation?: unknown;
};

function pathSuffix(path: PropertyKey[]): string {
  return path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("");
}

function zodIssueText(issue: ZodIssueLike): string {
  const last = String(issue.path[issue.path.length - 1] ?? "");
  switch (issue.code) {
    case "invalid_type":
      return issue.received === "undefined" || issue.received === "null" ? "obrigatório." : `deve ser ${issue.expected === "string" ? "texto" : String(issue.expected)}.`;
    case "too_small":
      if (issue.type === "string") return Number(issue.minimum) <= 1 ? "não pode ficar vazio." : `mínimo de ${Number(issue.minimum)} caracteres.`;
      if (issue.type === "array") return `mínimo de ${Number(issue.minimum)} itens.`;
      return `deve ser maior ou igual a ${Number(issue.minimum)}.`;
    case "too_big":
      if (issue.type === "string") return `máximo de ${Number(issue.maximum)} caracteres.`;
      if (issue.type === "array") return `máximo de ${Number(issue.maximum)} itens.`;
      return `deve ser menor ou igual a ${Number(issue.maximum)}.`;
    case "unrecognized_keys":
      return `chave desconhecida: ${(issue.keys ?? []).join(", ")}.`;
    case "invalid_string":
      if (last === "key") return "use de 1 a 40 caracteres entre a-z, 0-9 e hífen.";
      if (last === "published_at") return "use o formato AAAA-MM-DD.";
      return "precisa ser uma URL http(s) completa.";
    case "custom":
      if (last === "published_at") return "precisa ser uma data real no formato AAAA-MM-DD.";
      return "precisa ser uma URL http(s) completa.";
    default:
      return "valor inválido.";
  }
}

function objectErrors(field: string, schema: z.ZodTypeAny, value: unknown): string[] {
  const out: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [`${field}: deve ser um objeto.`];
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    for (const issue of parsed.error.issues as unknown as ZodIssueLike[]) {
      out.push(`${field}${pathSuffix(issue.path)}: ${zodIssueText(issue)}`);
    }
  }
  // min(1) aceita "  "; crédito, licença e alt precisam de texto de verdade.
  const rec = value as Record<string, unknown>;
  for (const k of ["alt", "credit", "license", "title", "publisher"]) {
    if (typeof rec[k] === "string" && rec[k] !== "" && (rec[k] as string).trim() === "") {
      out.push(`${field}.${k}: não pode ficar vazio.`);
    }
  }
  return out;
}

function urlPrefixError(field: string, value: unknown, prefix: string | undefined): string | null {
  if (!prefix || !value || typeof value !== "object") return null;
  const url = (value as Record<string, unknown>).url;
  if (typeof url !== "string" || isUnderUrlPrefix(url, prefix)) return null;
  return `${field}.url: precisa ser a url devolvida por upload_blog_image (bucket blog-images).`;
}

type MdNode = {
  type: string;
  url?: string;
  value?: string;
  children?: MdNode[];
};

function parseBody(body: string): MdNode | null {
  try {
    return fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }) as unknown as MdNode;
  } catch (e) {
    console.error("[blog-validate] markdown parse failed:", e);
    return null;
  }
}

function eachNode(tree: MdNode, visit: (node: MdNode, ancestors: MdNode[]) => void) {
  const walk = (node: MdNode, ancestors: MdNode[]) => {
    visit(node, ancestors);
    const next = [...ancestors, node];
    for (const child of node.children ?? []) walk(child, next);
  };
  walk(tree, []);
}

/** URLs http(s) de link e definição no corpo (normalizadas, únicas, na ordem), lidas da mesma
 * árvore que o validador usa. Não filtra: os checks de link do mcp-admin marcam como quebrado
 * o que o próprio fetch seguro recusar (porta, host privado...). */
export function collectBodyLinkUrls(body: string): string[] {
  const tree = parseBody(body);
  if (!tree) return [];
  const urls: string[] = [];
  eachNode(tree, (node) => {
    if (node.type !== "link" && node.type !== "definition") return;
    const url = normalizeLinkTarget(node.url ?? "");
    if (/^https?:\/\//i.test(url)) urls.push(url);
  });
  return [...new Set(urls)];
}

const LINK_MESSAGE = (target: string) =>
  `body_md: link "${JSON.stringify(target.slice(0, 80)).slice(1, -1)}" precisa ser http(s), um caminho /… ou uma âncora #….`;

/** Regras do corpo sobre a árvore Markdown (mdast + GFM), a mesma leitura que o renderer
 * faz: colchetes aninhados, code spans e definições dentro de citações ou listas não
 * escapam de uma regex aqui. */
function bodyErrors(body: string, imageKeys: Set<string> | null, sourcesCount: number | null): string[] {
  const out: string[] = [];
  const tree = parseBody(body);
  if (!tree) return ["body_md: não foi possível ler o Markdown."];
  let html = false;
  let refImage = false;
  eachNode(tree, (node, ancestors) => {
    const parent = ancestors[ancestors.length - 1];
    const grandparent = ancestors[ancestors.length - 2];
    switch (node.type) {
      case "html":
        html = true;
        break;
      case "imageReference":
        refImage = true;
        break;
      case "link":
      case "definition":
        if (!isAllowedLinkTarget(node.url ?? "")) out.push(LINK_MESSAGE(node.url ?? ""));
        break;
      case "image": {
        const target = node.url ?? "";
        const img = IMG_TARGET.exec(target);
        if (!img) {
          out.push(`body_md: imagem "${JSON.stringify(target.slice(0, 80)).slice(1, -1)}" precisa usar img:<key> de uma entrada de images.`);
          break;
        }
        if (imageKeys && !imageKeys.has(img[1])) out.push(`body_md: imagem img:${img[1]} não existe em images.`);
        const alone = parent?.type === "paragraph" &&
          (parent.children ?? []).every((c) => c === node || (c.type === "text" && (c.value ?? "").trim() === ""));
        if (!alone) {
          out.push(`body_md: imagem img:${img[1]} precisa ficar sozinha no próprio parágrafo (linha em branco antes e depois).`);
        } else if (grandparent?.type !== "root" && grandparent?.type !== "blockquote") {
          out.push(`body_md: imagem img:${img[1]} precisa ficar num parágrafo próprio no nível principal do texto (fora de listas e tabelas).`);
        }
        break;
      }
    }
  });
  if (html) out.unshift("body_md: HTML não é permitido; use só Markdown.");
  if (refImage) out.push("body_md: imagem só no formato ![alt](img:<key>); imagem por referência não é aceita.");
  // Sem sources conhecidos (edição parcial), checa só o formato dos infográficos.
  for (const msg of validateInfograficos(body, sourcesCount ?? Number.MAX_SAFE_INTEGER)) {
    out.push(msg);
  }
  return out;
}

/** Valida um rascunho inteiro (`partial: false`) ou só os campos presentes (`partial: true`).
 * Campos fora de BLOG_DRAFT_FIELDS são ignorados. `value` traz só os campos validados. */
export function validateBlogDraft(input: unknown, opts: BlogDraftValidateOptions): BlogDraftValidation {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const errors: string[] = [];
  const value: BlogDraftValues = {};
  const present = (f: BlogDraftField) => src[f] !== undefined;

  for (const f of BLOG_DRAFT_FIELDS) {
    if (present(f)) {
      value[f] = src[f];
      continue;
    }
    if (!opts.partial && !OPTIONAL.has(f)) errors.push(`${f}: obrigatório.`);
  }

  const str = (f: BlogDraftField): string | null => {
    if (!present(f)) return null;
    const v = src[f];
    if (typeof v !== "string") {
      errors.push(`${f}: deve ser texto.`);
      return null;
    }
    return v;
  };

  const slug = str("slug");
  if (slug !== null) {
    const r = rangeMessage("slug", slug, BLOG_DRAFT_LIMITS.slug);
    if (r) errors.push(r);
    if (!BLOG_SLUG_RE.test(slug)) {
      errors.push("slug: use só letras minúsculas sem acento, números e hífens (ex.: calendario-editorial).");
    }
  }

  const category = str("category");
  if (category !== null && !(BLOG_CATEGORIES as readonly string[]).includes(category)) {
    errors.push(`category: "${category.slice(0, 40)}" não existe; use uma de: ${BLOG_CATEGORIES.join(", ")}.`);
  }

  for (const f of ["title", "h1", "description"] as const) {
    const v = str(f);
    if (v === null) continue;
    const r = rangeMessage(f, v, BLOG_LIMITS[f]);
    if (r) errors.push(r);
  }
  for (const f of ["lede", "topic_reason"] as const) {
    const v = str(f);
    if (v === null) continue;
    const r = v.trim() === "" ? `${f}: não pode ficar vazio.` : rangeMessage(f, v, BLOG_DRAFT_LIMITS[f]);
    if (r) errors.push(r);
  }

  if (present("feature_slug") && src.feature_slug !== null) {
    const fs = src.feature_slug;
    if (typeof fs !== "string" || !(BLOG_FEATURE_SLUGS as readonly string[]).includes(fs)) {
      errors.push(`feature_slug: desconhecido; use um de: ${BLOG_FEATURE_SLUGS.join(", ")} (ou null).`);
    }
  }

  if (present("cover_image") && src.cover_image !== null) {
    errors.push(...objectErrors("cover_image", coverSchema, src.cover_image));
    const p = urlPrefixError("cover_image", src.cover_image, opts.imageUrlPrefix);
    if (p) errors.push(p);
  }

  let imageKeys: Set<string> | null = null;
  if (present("images")) {
    const images = src.images;
    if (!Array.isArray(images)) {
      errors.push("images: deve ser uma lista.");
    } else {
      imageKeys = new Set();
      const [, maxImages] = BLOG_DRAFT_LIMITS.images;
      if (images.length > maxImages) errors.push(`images: ${images.length} itens; máximo de ${maxImages}.`);
      images.forEach((img, i) => {
        errors.push(...objectErrors(`images[${i}]`, blogImageSchema, img));
        const p = urlPrefixError(`images[${i}]`, img, opts.imageUrlPrefix);
        if (p) errors.push(p);
        const key = img && typeof img === "object" ? (img as Record<string, unknown>).key : undefined;
        if (typeof key === "string") {
          if (imageKeys!.has(key)) errors.push(`images[${i}].key: "${key}" repetida; cada imagem precisa de uma key única.`);
          imageKeys!.add(key);
        }
      });
    }
  } else if (!opts.partial) {
    imageKeys = new Set();
  }

  let sourcesCount: number | null = null;
  if (present("sources")) {
    const sources = src.sources;
    if (!Array.isArray(sources)) {
      errors.push("sources: deve ser uma lista.");
    } else {
      sourcesCount = sources.length;
      const [min, max] = BLOG_DRAFT_LIMITS.sources;
      if (sources.length < min || sources.length > max) {
        errors.push(`sources: ${sources.length} fontes; precisa ter de ${min} a ${max}.`);
      }
      sources.forEach((s, i) => errors.push(...objectErrors(`sources[${i}]`, blogSourceSchema, s)));
    }
  }

  const body = str("body_md");
  if (body !== null) {
    const r = body.trim() === "" ? "body_md: não pode ficar vazio." : rangeMessage("body_md", body, BLOG_DRAFT_LIMITS.body_md);
    if (r) errors.push(r);
    errors.push(...bodyErrors(body, imageKeys, sourcesCount));
  }

  const unique = [...new Set(errors)];
  return unique.length ? { ok: false, errors: unique } : { ok: true, value };
}
