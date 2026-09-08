// deno-lint-ignore-file no-explicit-any
import type { AdminMcpContext } from "../_shared/mcp-admin-auth.ts";

/** Tudo que as queries/tools do mcp-admin precisam do mundo, injetável nos testes. */
export interface Deps {
  db: any;
  ctx: AdminMcpContext;
  now: () => string;
  randomUUID: () => string;
  signPutUrl: (key: string, mime: string, expiresSeconds?: number) => Promise<string>;
  headObject: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;
  putObject: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>;
  deleteObject: (key: string) => Promise<void>;
  resolveDns: (hostname: string, recordType: "A" | "AAAA") => Promise<string[]>;
  fetchUrl: (url: string, init: RequestInit) => Promise<Response>;
  /** Limite de storage do plano efetivo (null = ilimitado); workspaces.storage_quota_bytes é coluna morta. */
  storageQuota: (contaId: string) => Promise<number | null>;
}
