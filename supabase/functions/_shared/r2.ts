// supabase/functions/_shared/r2.ts
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
  UploadPartCopyCommand,
} from "npm:@aws-sdk/client-s3@3.637.0";
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

/** Presigned PUT bound to the declared size: ContentLength entra em X-Amz-SignedHeaders
 * (content-length;host), então um corpo de outro tamanho falha a assinatura no R2 em vez
 * de gravar e só ser pego (quando é) no HEAD do finalize. O navegador define o
 * Content-Length pelo Blob enviado; o chamador só precisa declarar o MESMO Blob.
 * Lança se o tamanho não for um inteiro positivo: o chamador valida antes (400). */
export async function signPutUrl(
  key: string,
  mimeType: string,
  sizeBytes: number,
  expiresSeconds = 900,
) {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error(`signPutUrl: invalid size ${sizeBytes}`);
  }
  const cmd = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: mimeType,
    ContentLength: sizeBytes,
  });
  return getSignedUrl(getR2(), cmd, { expiresIn: expiresSeconds });
}

/** Content-Disposition de download (RFC 6266 + RFC 5987). encodeURIComponent deixa
 * ' ( ) * ! sem escapar; ' encerraria o ext-value, então os cinco viram %XX. */
export function attachmentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename)
    .replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename*=UTF-8''${encoded}`;
}

/** downloadName (opcional) faz o R2 servir o objeto como anexo com esse nome
 * (post-references download_url). Sem ele a URL é idêntica à de antes. */
export async function signGetUrl(key: string, expiresSeconds = 3600, downloadName?: string) {
  const cmd = new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ...(downloadName ? { ResponseContentDisposition: attachmentDisposition(downloadName) } : {}),
  });
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
function copySourceHeader(sourceKey: string): string {
  return `${getBucket()}/${encodeURIComponent(sourceKey).replace(/%2F/g, "/")}`;
}

async function copyViaSignedFetch(sourceKey: string, destKey: string): Promise<Response> {
  const copySource = copySourceHeader(sourceKey);
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
  if (await copyObjectSized(sourceKey, destKey) === "missing") {
    throw new Error("r2 copy failed: 404");
  }
}

// Objects above SINGLE_COPY_MAX_BYTES are copied with a multipart copy instead of one
// CopyObject. R2 does a single CopyObject server-side and only answers when it's done,
// and for big videos that takes longer than any timeout we can afford: a 679 MB .mp4
// timed out at 30s on every attempt and dead-lettered its file_deletions row
// (prod 2026-10-28, row 2526). Copying in ranged parts keeps each request short and
// bounded no matter how large the object is.
export const SINGLE_COPY_MAX_BYTES = 100 * 1024 * 1024;
// R2 requires every part except the last to be the same size (min 5 MiB).
export const COPY_PART_BYTES = 64 * 1024 * 1024;
const COPY_PART_CONCURRENCY = 4;
const COPY_PART_TIMEOUT_MS = 60_000;
const MULTIPART_CONTROL_TIMEOUT_MS = 30_000;

/** Copies sourceKey to destKey, picking single vs multipart copy by size. Returns
 * "missing" when the source doesn't exist (404); throws on any other failure. Same
 * contract as copyViaSignedFetch for the single path: a 200 without
 * <CopyObjectResult> is a silent empty PUT and is treated as failure. */
export async function copyObjectSized(
  sourceKey: string,
  destKey: string,
  errorPrefix = "r2 copy failed",
): Promise<"copied" | "missing"> {
  // headObjectSigned returns null on 404 AND on any other failure. Either way the
  // single-copy path below gives the authoritative answer (its 404 means missing), so a
  // flaky HEAD only costs a possibly-too-slow single copy, never a wrong result.
  const head = await headObjectSigned(sourceKey);
  if (head && head.contentLength > SINGLE_COPY_MAX_BYTES) {
    await multipartCopy(sourceKey, destKey, head.contentLength, head.contentType);
    return "copied";
  }
  const res = await copyViaSignedFetch(sourceKey, destKey);
  const bodyText = await res.text().catch(() => "");
  if (res.status === 404) return "missing";
  if (!res.ok || !bodyText.includes("<CopyObjectResult")) {
    throw new Error(`${errorPrefix}: ${res.status}${bodyText ? ` ${bodyText.slice(0, 300)}` : ""}`);
  }
  return "copied";
}

function xmlTag(body: string, tag: string): string | null {
  const m = body.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : null;
}

/** Splits [0, size) into equal-size inclusive byte ranges (last one shorter). */
export function copyPartRanges(size: number, partBytes = COPY_PART_BYTES): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (let start = 0; start < size; start += partBytes) {
    ranges.push([start, Math.min(start + partBytes, size) - 1]);
  }
  return ranges;
}

/** Multipart copy via presign + plain fetch: same reason as copyViaSignedFetch (the
 * SDK transport hangs on the edge runtime), and the same signing rule: the
 * x-amz-copy-source* headers must be SIGNED and SENT, never hoisted to the query.
 * Aborts the upload on any failure so no incomplete parts are left behind. */
async function multipartCopy(
  sourceKey: string,
  destKey: string,
  size: number,
  contentType: string | null,
): Promise<void> {
  const bucket = getBucket();
  const createUrl = await getSignedUrl(
    getR2(),
    new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: destKey,
      ...(contentType ? { ContentType: contentType } : {}),
    }),
    { expiresIn: 300 },
  );
  const createRes = await fetch(createUrl, {
    method: "POST",
    headers: contentType ? { "content-type": contentType } : {},
    signal: AbortSignal.timeout(MULTIPART_CONTROL_TIMEOUT_MS),
  });
  const createBody = await createRes.text().catch(() => "");
  const uploadId = createRes.ok ? xmlTag(createBody, "UploadId") : null;
  if (!uploadId) {
    throw new Error(`r2 multipart create failed: ${createRes.status} ${createBody.slice(0, 300)}`);
  }

  try {
    const copySource = copySourceHeader(sourceKey);
    const ranges = copyPartRanges(size);
    const etags: string[] = new Array(ranges.length);
    let next = 0;
    let failed = false;
    const worker = async () => {
      // Stop handing out parts once any part fails: the upload is about to be aborted.
      while (!failed && next < ranges.length) {
        const i = next++;
        const range = `bytes=${ranges[i][0]}-${ranges[i][1]}`;
        const url = await getSignedUrl(
          getR2(),
          new UploadPartCopyCommand({
            Bucket: bucket,
            Key: destKey,
            UploadId: uploadId,
            PartNumber: i + 1,
            CopySource: copySource,
            CopySourceRange: range,
          }),
          {
            expiresIn: 300,
            unhoistableHeaders: new Set(["x-amz-copy-source", "x-amz-copy-source-range"]),
          },
        );
        const res = await fetch(url, {
          method: "PUT",
          headers: { "x-amz-copy-source": copySource, "x-amz-copy-source-range": range },
          signal: AbortSignal.timeout(COPY_PART_TIMEOUT_MS),
        });
        const body = await res.text().catch(() => "");
        const etag = res.ok ? xmlTag(body, "ETag") : null;
        if (!etag) {
          failed = true;
          throw new Error(`r2 part copy ${i + 1}/${ranges.length} failed: ${res.status} ${body.slice(0, 300)}`);
        }
        etags[i] = etag;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(COPY_PART_CONCURRENCY, ranges.length) }, worker),
    );

    const completeUrl = await getSignedUrl(
      getR2(),
      new CompleteMultipartUploadCommand({ Bucket: bucket, Key: destKey, UploadId: uploadId }),
      { expiresIn: 300 },
    );
    // ETags are reused exactly as R2 returned them inside its XML (already escaped).
    const xml = "<CompleteMultipartUpload>" +
      etags.map((etag, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${etag}</ETag></Part>`).join("") +
      "</CompleteMultipartUpload>";
    const completeRes = await fetch(completeUrl, {
      method: "POST",
      body: xml,
      signal: AbortSignal.timeout(MULTIPART_CONTROL_TIMEOUT_MS),
    });
    const completeBody = await completeRes.text().catch(() => "");
    // S3-style APIs can answer 200 with an <Error> body on complete; require the result tag.
    if (!completeRes.ok || !completeBody.includes("<CompleteMultipartUploadResult")) {
      throw new Error(`r2 multipart complete failed: ${completeRes.status} ${completeBody.slice(0, 300)}`);
    }
  } catch (e) {
    try {
      const abortUrl = await getSignedUrl(
        getR2(),
        new AbortMultipartUploadCommand({ Bucket: bucket, Key: destKey, UploadId: uploadId }),
        { expiresIn: 300 },
      );
      const res = await fetch(abortUrl, { method: "DELETE", signal: AbortSignal.timeout(10_000) });
      await res.body?.cancel();
    } catch (_abortError) {
      // Best effort: the original error is what matters for file_deletions.last_error.
    }
    throw e;
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
  // copyObjectSized picks a multipart copy for large objects (see SINGLE_COPY_MAX_BYTES)
  // and keeps the single-copy contract for the rest: a 200 without <CopyObjectResult>
  // is a copy R2 silently downgraded to an empty PUT (the 2026-08→09 zero-byte-trash
  // bug), so it throws BEFORE the original is deleted, or the undo window is a lie.
  // "missing" (404) = the source is already gone, either because a previous attempt
  // moved it to trash/ before a downstream step failed, or because it never existed.
  // Nothing is left to preserve, so the retry proceeds (deleteObject treats 404 as
  // done). Without this, a partly successful drain row retries into a copy-404
  // forever, runs out of attempts, and the Stream delete behind it never runs.
  await copyObjectSized(key, `trash/${key}`, "r2 trash copy failed");
  await deleteObject(key);
}

export interface TrashPage {
  objects: Array<{ key: string; lastModified: Date }>;
  nextToken: string | null;
}

/** Minimal XML entity unescape for ListObjectsV2 response fields. R2 escapes
 * the five predefined entities (and may use numeric references) in <Key> and
 * <NextContinuationToken>; anything fancier does not occur in an S3 listing. */
function unescapeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Parses a ListObjectsV2 XML body into purgeTrash's page shape. Exported
 * for tests only. Regex over a schema'd, flat S3 listing (no nested
 * <Contents>), not a general XML parser. */
export function parseListObjectsXml(xml: string): TrashPage {
  const objects: Array<{ key: string; lastModified: Date }> = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const block = m[1];
    const key = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
    const lastModified = block.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1];
    if (!key || !lastModified) continue;
    const when = new Date(unescapeXml(lastModified));
    if (isNaN(when.getTime())) continue;
    objects.push({ key: unescapeXml(key), lastModified: when });
  }
  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/.test(xml);
  const nextToken = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1];
  return {
    objects,
    nextToken: truncated ? (nextToken != null ? unescapeXml(nextToken) : null) : null,
  };
}

/** ONE page of the trash/ prefix. Presign + plain fetch + AbortSignal, NOT
 * getR2().send(): the aws-sdk transport is the documented edge-runtime hang
 * path (AGENTS.md; same rationale as deleteObject/getObjectBytes below), so
 * the listing goes out as a presigned GET and the XML comes back through
 * fetch with a hard 30s bound. Real implementation for purgeTrash's
 * `listPage` seam. */
async function realListTrashPage(token: string | undefined): Promise<TrashPage> {
  const cmd = new ListObjectsV2Command({
    Bucket: getBucket(),
    Prefix: "trash/",
    ContinuationToken: token,
  });
  const url = await getSignedUrl(getR2(), cmd, { expiresIn: 300 });
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`r2 trash list failed: ${res.status}${text ? ` ${text.slice(0, 300)}` : ""}`);
  }
  return parseListObjectsXml(text);
}

export interface PurgeTrashOpts {
  maxPerRun?: number;
  startToken?: string | null;
  deadlineMs?: number;
  // test seams; default to the real implementations
  listPage?: (token: string | undefined) => Promise<TrashPage>;
  deleteFn?: (key: string) => Promise<void>;
  nowFn?: () => number;
}

export interface PurgeTrashResult {
  purged: number;
  nextToken: string | null;
  cycleCompleted: boolean;
}

/** Permanently removes trash/ entries older than `olderThanDays`, at most
 * `maxPerRun` per call (default 500), bounded by `deadlineMs` (default 55s)
 * checked between pages so a slow/large trash/ prefix can't blow the caller's
 * own watchdog. Checkpointed via `startToken`/`nextToken` — see
 * post-media-cleanup-cron/index.ts, which persists the returned `nextToken`
 * in `cron_scan_state` the same way the orphan scan does. A listing error on
 * a stale/invalid continuation token is retried once from the head of the
 * prefix before propagating. */
export async function purgeTrash(olderThanDays: number, opts: PurgeTrashOpts = {}): Promise<PurgeTrashResult> {
  const { maxPerRun = 500, deadlineMs = 55_000, nowFn = Date.now } = opts;
  const listPage = opts.listPage ?? realListTrashPage;
  const deleteFn = opts.deleteFn ?? deleteObject;
  const cutoff = nowFn() - olderThanDays * 24 * 60 * 60 * 1000;
  const startedAt = nowFn();
  let purged = 0;
  // Token that PRODUCED the page currently being processed. Persisting this
  // (not nextToken) on an early exit means an interrupted page is re-listed,
  // never skipped: deletes are idempotent (deleteObject treats 404 as done).
  let pageToken: string | null = opts.startToken ?? null;
  let retriedFromNull = false;
  while (true) {
    let page: TrashPage;
    try {
      page = await listPage(pageToken ?? undefined);
    } catch (e) {
      if (pageToken !== null && !retriedFromNull) {
        // Stale/invalid continuation token (R2 InvalidArgument): restart cycle.
        console.error("purgeTrash: list failed with token, restarting from head", e);
        pageToken = null;
        retriedFromNull = true;
        continue;
      }
      throw e;
    }
    for (const obj of page.objects) {
      if (purged >= maxPerRun) return { purged, nextToken: pageToken, cycleCompleted: false };
      // Checked before EVERY delete, not just between pages: a single page can
      // hold ~1000 aged objects, and at worst case ~10s per delete (see
      // deleteObject's own timeout) a page can blow well past the deadline on
      // its own. Exiting mid-page returns `pageToken` — the token that
      // PRODUCED this page, same as the cap-exit above — so the interrupted
      // page is re-listed in full next run rather than skipping the objects
      // after the one we stopped on.
      if (nowFn() - startedAt >= deadlineMs) return { purged, nextToken: pageToken, cycleCompleted: false };
      if (obj.lastModified.getTime() < cutoff) {
        await deleteFn(obj.key);
        purged++;
      }
    }
    if (page.nextToken === null) return { purged, nextToken: null, cycleCompleted: true };
    pageToken = page.nextToken;
    // Belt for a page with few/no aged objects (the per-delete check above
    // never ran, or ran only briefly): still bound how long a run keeps
    // listing before returning.
    if (nowFn() - startedAt >= deadlineMs) return { purged, nextToken: pageToken, cycleCompleted: false };
  }
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

export interface OrphanKeyPage {
  /** Aged keys from THIS page only. R2 returns at most 1000 objects per page,
   * so this array is bounded no matter how large the prefix is. */
  keys: string[];
  /** Token to pass back for the next page; null once the prefix is exhausted. */
  nextToken: string | null;
}

/**
 * ONE page of a prefix listing, filtered to objects older than `olderThanMs`.
 *
 * Deliberately not a loop. The previous `listOrphanKeys()` paged the ENTIRE
 * prefix into one array before returning, which grew with the bucket and not
 * with the workload: on prod it died with WORKER_RESOURCE_LIMIT (2026-08-13),
 * killing the cron stages queued behind it. Callers now spend a fixed page
 * budget per run and persist `nextToken` (see cron_scan_state) to resume.
 *
 * An empty `keys` with a non-null `nextToken` is normal and NOT a stop
 * condition — it just means every object on that page was younger than the
 * cutoff. Only `nextToken === null` ends the sweep.
 */
export async function listOrphanKeyPage(
  prefix: string,
  olderThanMs: number,
  token?: string | null,
): Promise<OrphanKeyPage> {
  const cutoff = Date.now() - olderThanMs;
  // Belt for the same edge-runtime hang class as deleteObject above: bound the
  // page fetch so a stalled listing fails the run instead of freezing it.
  const res = await getR2().send(
    new ListObjectsV2Command({
      Bucket: getBucket(),
      Prefix: prefix,
      ContinuationToken: token ?? undefined,
    }),
    { abortSignal: AbortSignal.timeout(30_000) },
  );
  const keys: string[] = [];
  for (const obj of res.Contents ?? []) {
    if (obj.Key && obj.LastModified && obj.LastModified.getTime() < cutoff) keys.push(obj.Key);
  }
  return {
    keys,
    nextToken: res.IsTruncated ? (res.NextContinuationToken ?? null) : null,
  };
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

/** Streaming GET via presign + fetch (the SDK transport is the documented
 * edge-runtime hang path). Bounds time-to-first-byte only; body stalls are
 * the caller's job (file-zip wraps with a per-chunk stall guard) because a
 * total AbortSignal would kill legitimately large slow bodies. */
export async function getObjectStreamSigned(key: string): Promise<ReadableStream<Uint8Array> | null> {
  const ac = new AbortController();
  // Cleared in `finally` (not after the await): a fetch that REJECTS before
  // headers would otherwise leave the timer live for its full 15s, and a zip
  // over many unavailable objects would pile one orphan timer per failure.
  const headerTimer = setTimeout(() => ac.abort(), 15_000);
  try {
    const url = await signGetUrl(key, 300);
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    return res.body;
  } catch {
    return null;
  } finally {
    clearTimeout(headerTimer);
  }
}

export async function putObject(
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const url = await signPutUrl(key, contentType, bytes.byteLength, 300);
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
