// supabase/functions/_shared/r2.ts
import { S3Client, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command, CopyObjectCommand } from "npm:@aws-sdk/client-s3@3.637.0";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3.637.0";
import { PutObjectCommand, GetObjectCommand } from "npm:@aws-sdk/client-s3@3.637.0";

function getEnvOrThrow(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name} required`);
  return v;
}

let _r2Client: S3Client | null = null;
let _bucket: string | null = null;

export function getR2(): S3Client {
  if (!_r2Client) {
    const accountId = getEnvOrThrow("R2_ACCOUNT_ID");
    _r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: getEnvOrThrow("R2_ACCESS_KEY_ID"),
        secretAccessKey: getEnvOrThrow("R2_SECRET_ACCESS_KEY"),
      },
      forcePathStyle: true,
      // Without this, a stalled connection to R2 hangs for the AWS SDK's own much longer
      // default rather than failing fast. This is a per-socket idle timeout (resets on any
      // activity), so it's safe for legitimately slow-but-progressing operations like a large
      // getObjectBytes or listOrphanKeys page — it only fires on a genuine stall.
      requestHandler: { requestTimeout: 10_000 },
    });
  }
  return _r2Client;
}

export function getBucket(): string {
  if (!_bucket) _bucket = getEnvOrThrow("R2_BUCKET");
  return _bucket;
}

export async function signPutUrl(key: string, mimeType: string, expiresSeconds = 900) {
  const cmd = new PutObjectCommand({ Bucket: getBucket(), Key: key, ContentType: mimeType });
  return getSignedUrl(getR2(), cmd, { expiresIn: expiresSeconds });
}

export async function signGetUrl(key: string, expiresSeconds = 3600) {
  const cmd = new GetObjectCommand({ Bucket: getBucket(), Key: key });
  return getSignedUrl(getR2(), cmd, { expiresIn: expiresSeconds });
}

export async function headObject(key: string): Promise<{ contentLength: number; contentType: string | null } | null> {
  try {
    const res = await getR2().send(
      new HeadObjectCommand({ Bucket: getBucket(), Key: key }),
      { abortSignal: AbortSignal.timeout(10_000) },
    );
    return { contentLength: Number(res.ContentLength ?? 0), contentType: res.ContentType ?? null };
  } catch (_e) {
    return null;
  }
}

/** CopyObject via presign + fetch puro. x-amz-copy-source PRECISA ir como
 * header ASSINADO (unhoistableHeaders) E ser enviado no fetch. O default do
 * presigner -- hoistar para a query string -- produz uma URL que o R2 aceita
 * com 200 mas trata como PUT comum de corpo vazio: a query x-amz-copy-source
 * é IGNORADA e o destino nasce com 0 bytes (comprovado contra o R2 real em
 * 2026-09-02; era a causa do "size mismatch" do automation-media e de todo
 * trash/ pós-2026-08-22 ficar vazio). O 403 SignatureDoesNotMatch do
 * incidente de 2026-08 vinha de enviar o header SEM assiná-lo junto -- a
 * correção é assinar E enviar, nunca omitir. Uma cópia real responde XML
 * <CopyObjectResult>; corpo sem isso = PUT vazio, e falhar alto aqui é o que
 * impede a regressão silenciosa. */
async function copyViaSignedFetch(sourceKey: string, destKey: string): Promise<Response> {
  const copySource = `${getBucket()}/${encodeURIComponent(sourceKey).replace(/%2F/g, "/")}`;
  const cmd = new CopyObjectCommand({
    Bucket: getBucket(),
    CopySource: copySource,
    Key: destKey,
  });
  const url = await getSignedUrl(getR2(), cmd, {
    expiresIn: 300,
    unhoistableHeaders: new Set(["x-amz-copy-source"]),
  });
  return await fetch(url, {
    method: "PUT",
    headers: { "x-amz-copy-source": copySource },
    signal: AbortSignal.timeout(30_000),
  });
}

/** Cópia SEM apagar a origem (metade "copy" do trashObject). Lança em falha,
 * inclusive no 200-sem-CopyObjectResult (ver copyViaSignedFetch). */
export async function copyObjectSigned(sourceKey: string, destKey: string): Promise<void> {
  const res = await copyViaSignedFetch(sourceKey, destKey);
  const bodyText = await res.text().catch(() => "");
  if (!res.ok || !bodyText.includes("<CopyObjectResult")) {
    throw new Error(`r2 copy failed: ${res.status}${bodyText ? ` ${bodyText.slice(0, 300)}` : ""}`);
  }
}

/** HEAD via presign + fetch puro (mesmo racional de putObject/deleteObject:
 * o transport do SDK trava no edge runtime; este helper é para handlers que
 * gravam estado). null em 404 ou qualquer falha. */
export async function headObjectSigned(
  key: string,
): Promise<{ contentLength: number; contentType: string | null } | null> {
  try {
    const cmd = new HeadObjectCommand({ Bucket: getBucket(), Key: key });
    const url = await getSignedUrl(getR2(), cmd, { expiresIn: 300 });
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return {
      contentLength: Number(res.headers.get("content-length") ?? 0),
      contentType: res.headers.get("content-type"),
    };
  } catch (_e) {
    return null;
  }
}

/** Two-phase delete: copy to `trash/<key>` then delete the original. Automated
 * cleanup uses this instead of deleteObject so every automated removal has a
 * 30-day undo window (see purgeTrash) — the 2026-08 incident had none. Throws
 * if the copy fails; the original is only removed after the copy succeeds. */
export async function trashObject(key: string): Promise<void> {
  // Presign + plain fetch, same as deleteObject above: the SDK's own transport
  // is the documented edge-runtime hang path, and this function sits on the
  // deletion drains — a hang here stalls every queue. The copy-source signing
  // contract (signed header, sent on the fetch) lives in copyViaSignedFetch.
  const res = await copyViaSignedFetch(key, `trash/${key}`);
  // 404 = the source is already gone — either a previous attempt moved it to
  // trash/ before a downstream step failed, or the object never existed. In
  // both cases there is nothing left to preserve, so the retry must proceed
  // (deleteObject below also treats 404 as done). Without this, a partially
  // successful drain row retries into a copy-404 forever, exhausts its
  // attempts, and the Stream delete behind it is never reached.
  const bodyText = await res.text().catch(() => "");
  if (res.status !== 404) {
    // Diagnostic: R2's XML error body names the actual rejection (e.g.
    // SignatureDoesNotMatch vs AccessDenied) that a bare status code can't
    // distinguish — surfaced via file_deletions.last_error for the next failure.
    // A 200 whose body lacks <CopyObjectResult> is a copy the R2 silently
    // downgraded to an empty PUT (the 2026-08→09 zero-byte-trash bug): treat
    // it as failure BEFORE deleting the original, or the undo window is a lie.
    if (!res.ok || !bodyText.includes("<CopyObjectResult")) {
      throw new Error(`r2 trash copy failed: ${res.status}${bodyText ? ` ${bodyText.slice(0, 300)}` : ""}`);
    }
  }
  await deleteObject(key);
}

/** Permanently removes trash/ entries older than `olderThanDays`, at most
 * `maxPerRun` per call. Bounded and last-resort-safe: a listing error deletes
 * nothing. Returns the number purged. */
export async function purgeTrash(olderThanDays: number, maxPerRun = 200): Promise<number> {
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  let purged = 0;
  let token: string | undefined;
  do {
    const res = await getR2().send(
      new ListObjectsV2Command({ Bucket: getBucket(), Prefix: "trash/", ContinuationToken: token }),
      { abortSignal: AbortSignal.timeout(30_000) },
    );
    for (const obj of res.Contents ?? []) {
      if (purged >= maxPerRun) return purged;
      if (obj.Key && obj.LastModified && obj.LastModified.getTime() < cutoff) {
        await deleteObject(obj.Key);
        purged++;
      }
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return purged;
}

export async function deleteObject(key: string): Promise<void> {
  // Presign + plain fetch + AbortSignal, NOT getR2().send(): the SDK's own network
  // stack has hung indefinitely on the edge runtime despite the client-level
  // requestTimeout above — prod evidence: the cleanup cron's file_deletions drain
  // made zero progress (attempts never incremented) for three weeks, dying at the
  // first DeleteObjectCommand every hourly run. Presigning is local crypto; the
  // DELETE itself goes through fetch with a hard bound, the same pattern
  // getObjectBytes below already uses. 404 = already gone = success.
  const cmd = new DeleteObjectCommand({ Bucket: getBucket(), Key: key });
  const url = await getSignedUrl(getR2(), cmd, { expiresIn: 300 });
  const res = await fetch(url, { method: "DELETE", signal: AbortSignal.timeout(10_000) });
  await res.body?.cancel();
  if (!res.ok && res.status !== 404) {
    throw new Error(`r2 delete failed: ${res.status}`);
  }
}

export async function listOrphanKeys(prefix: string, olderThanMs: number): Promise<string[]> {
  const cutoff = Date.now() - olderThanMs;
  const out: string[] = [];
  let token: string | undefined;
  do {
    // Belt for the same edge-runtime hang class as deleteObject above: bound each
    // page fetch so a stalled listing fails the run instead of freezing it.
    const res = await getR2().send(
      new ListObjectsV2Command({ Bucket: getBucket(), Prefix: prefix, ContinuationToken: token }),
      { abortSignal: AbortSignal.timeout(30_000) },
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key && obj.LastModified && obj.LastModified.getTime() < cutoff) out.push(obj.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

export async function copyObject(sourceKey: string, destKey: string): Promise<void> {
  await getR2().send(new CopyObjectCommand({
    Bucket: getBucket(),
    CopySource: `${getBucket()}/${sourceKey}`,
    Key: destKey,
  }));
}

export async function getObject(key: string): Promise<ReadableStream<Uint8Array> | null> {
  try {
    const res = await getR2().send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
    return (res.Body as ReadableStream<Uint8Array>) ?? null;
  } catch {
    return null;
  }
}

// getObjectBytes/putObject (sole owner — every edge-function R2 read/write goes through
// these, never a second S3Client instance).
//
// Both go through presign + plain fetch instead of `getR2().send(...)`: on the Supabase edge
// runtime the aws-sdk's fetch handler HANGS INDEFINITELY on PutObject (100% reproducible —
// zero bytes back, worker burns to the wall-clock kill, so callers doing an R2 write, e.g.
// brand-logo's upload or tiktok-media's cache-to-R2, die without ever reaching their catch
// block and leave the caller's state update never applied) and intermittently on GetObject
// body streaming. The `requestHandler.requestTimeout` client option demonstrably does not
// apply there. Presigning is pure local crypto (no network), and a plain fetch with
// AbortSignal.timeout can always fail fast instead of hanging.

const OBJECT_FETCH_TIMEOUT_MS = 30_000;

export async function getObjectBytes(key: string): Promise<Uint8Array | null> {
  try {
    const url = await signGetUrl(key, 300);
    const res = await fetch(url, {
      signal: AbortSignal.timeout(OBJECT_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Drain so the connection can be reused; body is small (error XML) or absent.
      await res.body?.cancel();
      return null;
    }
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export async function putObject(
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const url = await signPutUrl(key, contentType, 300);
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    // BodyInit wants Uint8Array<ArrayBuffer>; re-view the same bytes (no copy)
    // so a generically typed Uint8Array<ArrayBufferLike> still type-checks.
    body: new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength),
    signal: AbortSignal.timeout(OBJECT_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`R2 PUT failed for ${key}: ${res.status}`);
  }
}
