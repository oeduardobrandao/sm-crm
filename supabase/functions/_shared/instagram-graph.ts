// Versão e helper de erro Graph, antes privados em instagram-publish-utils.
export const GRAPH_VERSION = "v22.0";
export const GRAPH_BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;

// deno-lint-ignore no-explicit-any
export function throwGraphError(data: any): never {
  const err: any = new Error(data.error.message);
  if (data.error.code === 190) err.code = "TOKEN_EXPIRED";
  if (typeof data.error.code === "number") err.graphCode = data.error.code;
  if (typeof data.error.error_subcode === "number") err.graphSubcode = data.error.error_subcode;
  if (typeof data.error.fbtrace_id === "string") err.fbtraceId = data.error.fbtrace_id;
  throw err;
}
