// Payload da private reply: texto puro ou button template (botões de link).
// Spec: docs/superpowers/specs/2026-08-19-instagram-dm-link-buttons-design.md
// Módulo puro (sem I/O além de console.warn) para ser testável isolado.

export interface DmButton {
  title: string;
  url: string;
}

export type PrivateReplyMessage =
  | { text: string }
  | {
    attachment: {
      type: "template";
      payload: {
        template_type: "button";
        text: string;
        buttons: Array<{ type: "web_url"; url: string; title: string }>;
      };
    };
  }
  | {
    attachment: {
      type: "template";
      payload: {
        template_type: "generic";
        elements: Array<{
          title: string;
          subtitle?: string;
          image_url: string;
          buttons?: Array<{ type: "web_url"; url: string; title: string }>;
        }>;
      };
    };
  };

export const MAX_DM_BUTTONS = 3;
export const MAX_BUTTON_TITLE = 20;
const FALLBACK_MAX = 1000;
const HTTP_URL_RE = /^https?:\/\//i;

// URL com userinfo (https://user:pass@evil.x) é padrão de phishing; espelha o
// CHECK do banco e o form do CRM. @ no path (instagram.com/@handle) é válido.
function hasUserinfo(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.username !== "" || parsed.password !== "";
  } catch {
    return true;
  }
}

// Fail-open POR DESIGN (ver spec): undefined/null -> [] em silêncio (fixtures
// de teste e a janela migration->redeploy); valor presente porém malformado
// descarta itens com console.warn em vez de lançar -- o enforcement da forma
// é o CHECK do banco, e um throw aqui envenenaria envios por causa de uma
// coluna de apresentação.
export function parseDmButtons(raw: unknown): DmButton[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    console.warn("[instagram-dm-payload] dm_buttons não é array; ignorando:", typeof raw);
    return [];
  }
  const out: DmButton[] = [];
  let discarded = 0;
  for (const item of raw) {
    if (out.length >= MAX_DM_BUTTONS) {
      discarded++;
      continue;
    }
    if (typeof item !== "object" || item === null) {
      discarded++;
      continue;
    }
    const title = typeof (item as { title?: unknown }).title === "string"
      ? ((item as { title: string }).title).trim().slice(0, MAX_BUTTON_TITLE)
      : "";
    const url = typeof (item as { url?: unknown }).url === "string"
      ? ((item as { url: string }).url).trim()
      : "";
    if (!title || !HTTP_URL_RE.test(url) || url.includes("\\") || hasUserinfo(url)) {
      discarded++;
      continue;
    }
    out.push({ title, url });
  }
  if (discarded > 0) {
    console.warn(`[instagram-dm-payload] ${discarded} item(ns) de dm_buttons descartado(s)`);
  }
  return out;
}

export function buildPrivateReplyMessage(text: string, buttons: DmButton[]): PrivateReplyMessage {
  if (buttons.length === 0) return { text };
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text,
        buttons: buttons.map((b) => ({ type: "web_url" as const, url: b.url, title: b.title })),
      },
    },
  };
}

// Fallback quando a Meta recusa o template com erro permanente: texto + uma
// linha "Título: url" por botão. <= 1000 chars (limite do CHECK de
// dm_message em texto puro): corta primeiro o TEXTO (com reticências); se só
// as linhas de botão já estouram (3 x título 20 + URL 500 é legal pelo CHECK),
// derruba linhas do FIM até caber -- nunca corta uma URL no meio.
export function buildFallbackText(text: string, buttons: DmButton[]): string {
  const lines = buttons.map((b) => `${b.title}: ${b.url}`);
  let kept = lines.slice();
  let linesBlock = kept.join("\n");
  while (kept.length > 1 && linesBlock.length > FALLBACK_MAX) {
    kept = kept.slice(0, -1);
    linesBlock = kept.join("\n");
  }
  if (linesBlock.length > FALLBACK_MAX) {
    // Uma única linha maior que o limite é impossível com o CHECK do banco
    // (20 + 2 + 500 = 522); guarda defensiva para nunca devolver vazio.
    linesBlock = linesBlock.slice(0, FALLBACK_MAX);
    kept = [linesBlock];
  }
  if (kept.length === 0) return text.slice(0, FALLBACK_MAX);
  const trimmedText = text.trim();
  if (!trimmedText) return linesBlock;
  const budget = FALLBACK_MAX - linesBlock.length - 2; // "\n\n"
  if (budget <= 0) return linesBlock;
  const finalText = trimmedText.length <= budget
    ? trimmedText
    : `${trimmedText.slice(0, Math.max(0, budget - 1))}…`;
  if (!finalText) return linesBlock;
  return `${finalText}\n\n${linesBlock}`;
}

// ---------- DmMedia (generic template support) ----------

export interface DmMedia {
  key: string;
  contentType: string;
  sizeBytes: number;
}

// Fail-open como parseDmButtons: o enforcement é o CHECK do banco; aqui só
// convertemos ou descartamos com warn.
export function parseDmMedia(raw: unknown): DmMedia | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    console.warn("[instagram-dm-payload] dm_media malformado; ignorando:", typeof raw);
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.key !== "string" || typeof o.content_type !== "string" || typeof o.size_bytes !== "number") {
    console.warn("[instagram-dm-payload] dm_media sem campos obrigatórios; ignorando");
    return null;
  }
  return { key: o.key, contentType: o.content_type, sizeBytes: o.size_bytes };
}

export function buildCardText(title: string, subtitle: string | null): string {
  return subtitle ? `${title}\n\n${subtitle}` : title;
}

export function buildCardMessage(
  title: string,
  subtitle: string | null,
  imageUrl: string,
  buttons: DmButton[],
): PrivateReplyMessage {
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "generic",
        elements: [{
          title,
          ...(subtitle ? { subtitle } : {}),
          image_url: imageUrl,
          ...(buttons.length > 0
            ? { buttons: buttons.map((b) => ({ type: "web_url" as const, url: b.url, title: b.title })) }
            : {}),
        }],
      },
    },
  };
}
