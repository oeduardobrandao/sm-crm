export const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;

export function sanitizeZipPath(name: string): string {
  return name
    .replace(/\0/g, "")
    .replace(/\.\./g, "_")
    .replace(/^\/+/, "")
    .replace(/\\/g, "/");
}
