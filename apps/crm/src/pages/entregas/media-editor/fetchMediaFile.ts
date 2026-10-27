/**
 * Downloads a media URL into a File, reporting 0-100 progress. The stream is tee'd: one branch
 * is only read for its byte count, the other goes whole to the native Response.blob(), which
 * avoids doubling a large video in JS-managed memory.
 */
export async function fetchMediaFile(
  url: string,
  name: string,
  mime: string,
  signal: AbortSignal,
  onProgress: (pct: number) => void,
): Promise<File> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;
  let blob: Blob;
  if (response.body && total > 0) {
    const [progressStream, blobStream] = response.body.tee();
    const blobPromise = new Response(blobStream, { headers: response.headers }).blob();
    blobPromise.catch(() => {});
    const reader = progressStream.getReader();
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      onProgress(Math.min(100, Math.round((loaded / total) * 100)));
    }
    blob = await blobPromise;
  } else {
    blob = await response.blob();
  }
  signal.throwIfAborted();
  onProgress(100);
  return new File([blob], name, { type: blob.type || mime });
}
