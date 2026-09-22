export const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024; // unchanged
export const MAX_ZIP_TOTAL_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB refusal threshold
export const MAX_ZIP_ENTRIES = 2000;
export const MAX_FOLDER_DEPTH = 10; // matches file-manage
export const STALL_IDLE_MS = 15_000;

export function sanitizeZipPath(name: string): string {
  return name
    .replace(/\0/g, "")
    .replace(/\.\./g, "_")
    .replace(/^\/+/, "")
    .replace(/\\/g, "/");
}
