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
    const res = await getR2().send(new HeadObjectCommand({ Bucket: getBucket(), Key: key }));
    return { contentLength: Number(res.ContentLength ?? 0), contentType: res.ContentType ?? null };
  } catch (_e) {
    return null;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await getR2().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
}

export async function listOrphanKeys(prefix: string, olderThanMs: number): Promise<string[]> {
  const cutoff = Date.now() - olderThanMs;
  const out: string[] = [];
  let token: string | undefined;
  do {
    const res = await getR2().send(new ListObjectsV2Command({ Bucket: getBucket(), Prefix: prefix, ContinuationToken: token }));
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
