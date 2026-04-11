// supabase/functions/_shared/r2.ts
import { S3Client, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "npm:@aws-sdk/client-s3@3.637.0";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3.637.0";
import { PutObjectCommand, GetObjectCommand } from "npm:@aws-sdk/client-s3@3.637.0";

const ACCOUNT_ID = Deno.env.get("R2_ACCOUNT_ID") ?? (() => { throw new Error("R2_ACCOUNT_ID required"); })();
const ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID") ?? (() => { throw new Error("R2_ACCESS_KEY_ID required"); })();
const SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY") ?? (() => { throw new Error("R2_SECRET_ACCESS_KEY required"); })();
export const R2_BUCKET = Deno.env.get("R2_BUCKET") ?? (() => { throw new Error("R2_BUCKET required"); })();

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
});

export async function signPutUrl(key: string, mimeType: string, expiresSeconds = 900) {
  const cmd = new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: mimeType });
  return getSignedUrl(r2, cmd, { expiresIn: expiresSeconds });
}

export async function signGetUrl(key: string, expiresSeconds = 3600) {
  const cmd = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
  return getSignedUrl(r2, cmd, { expiresIn: expiresSeconds });
}

export async function headObject(key: string): Promise<{ contentLength: number } | null> {
  try {
    const res = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return { contentLength: Number(res.ContentLength ?? 0) };
  } catch (_e) {
    return null;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}

export async function listOrphanKeys(prefix: string, olderThanMs: number): Promise<string[]> {
  const cutoff = Date.now() - olderThanMs;
  const out: string[] = [];
  let token: string | undefined;
  do {
    const res = await r2.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: prefix, ContinuationToken: token }));
    for (const obj of res.Contents ?? []) {
      if (obj.Key && obj.LastModified && obj.LastModified.getTime() < cutoff) out.push(obj.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}
