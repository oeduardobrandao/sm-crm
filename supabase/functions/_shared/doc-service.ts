// Client for the Estúdio doc service (services/estudio-render on Vercel): scene
// projection (describe), op-based mutation (mutate, MDF1 binary framing — json
// length-prefixed + raw .fig bytes, see services/estudio-render/lib/framing.js)
// and full-frame render (same contract design-render consumes). The service's
// only auth is the shared bearer.

/** Coded 422 from the doc service — surfaced to agents as a structured error. */
export class DocServiceError extends Error {
  constructor(public code: string, public detail?: string) {
    super(detail ?? code);
  }
}

const MAGIC = new TextEncoder().encode("MDF1");

export function encodeFrame(json: unknown, bytes: Uint8Array): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const out = new Uint8Array(8 + jsonBytes.length + bytes.length);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, jsonBytes.length, false);
  out.set(jsonBytes, 8);
  out.set(bytes, 8 + jsonBytes.length);
  return out;
}

export function decodeFrame(u8: Uint8Array): { json: Record<string, unknown>; bytes: Uint8Array } {
  if (u8.length < 8 || u8[0] !== 77 || u8[1] !== 68 || u8[2] !== 70 || u8[3] !== 49) {
    throw new Error("bad_frame");
  }
  const jsonLen = new DataView(u8.buffer, u8.byteOffset).getUint32(4, false);
  if (8 + jsonLen > u8.length) throw new Error("bad_frame");
  const json = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + jsonLen)));
  return { json, bytes: u8.subarray(8 + jsonLen) };
}

async function asDocServiceError(res: Response): Promise<DocServiceError> {
  try {
    const j = await res.json() as { error?: string; message?: string };
    return new DocServiceError(j.error ?? `http_${res.status}`, j.message);
  } catch {
    return new DocServiceError(`http_${res.status}`);
  }
}

export interface RenderServicePage {
  frame_id: string;
  width: number;
  height: number;
  jpeg_b64: string;
}

export function createDocServiceClient(baseUrl: string, secret: string) {
  const auth = { authorization: `Bearer ${secret}` };
  return {
    describe: async (bytes: Uint8Array): Promise<Record<string, unknown>> => {
      const res = await fetch(`${baseUrl}/api/describe`, {
        method: "POST",
        headers: auth,
        body: bytes.buffer as ArrayBuffer,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw await asDocServiceError(res);
      return (await res.json() as { projection: Record<string, unknown> }).projection;
    },

    mutate: async (
      bytes: Uint8Array,
      ops: unknown[],
    ): Promise<{ bytes: Uint8Array; projection: Record<string, unknown>; applied: number }> => {
      const res = await fetch(`${baseUrl}/api/mutate`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/octet-stream" },
        body: encodeFrame({ ops }, bytes).buffer as ArrayBuffer,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw await asDocServiceError(res);
      const frame = decodeFrame(new Uint8Array(await res.arrayBuffer()));
      const meta = frame.json as { projection: Record<string, unknown>; applied: number };
      return { bytes: frame.bytes, projection: meta.projection, applied: meta.applied };
    },

    render: async (
      bytes: Uint8Array,
      tipo: string,
    ): Promise<{ pages: RenderServicePage[] }> => {
      const res = await fetch(`${baseUrl}/api/render`, {
        method: "POST",
        headers: { ...auth, "x-post-tipo": tipo },
        body: bytes.buffer as ArrayBuffer,
        signal: AbortSignal.timeout(55_000),
      });
      if (!res.ok) throw await asDocServiceError(res);
      return await res.json() as { pages: RenderServicePage[] };
    },
  };
}
