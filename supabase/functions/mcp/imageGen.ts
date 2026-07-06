// MCP `generate_image` glue (design §8/§9, plan T5.4): maps the MCP Deps + args onto the
// shared image-gen core and its §8 failure envelope onto McpStructuredError so agents get
// {error, message, retryable, retry_after} as machine-usable retry instructions.
import { generateImageCore, ImageGenError, type ImageGenInput } from "../_shared/image-gen/core.ts";
import type { ImageGenCoreDeps } from "../_shared/image-gen/core.ts";
import { McpStructuredError } from "./design.ts";
import type { Deps } from "./queries.ts";

export interface GenerateImageArgs {
  prompt: string;
  aspect_ratio: "1:1" | "4:5" | "9:16" | "16:9";
  placement?: "background" | "element";
  quality?: "1K" | "2K";
  client_id?: number;
  post_id?: number;
  reference_file_ids?: number[];
  use_brand_logo?: boolean;
  idempotency_key?: string;
}

export async function generateImage(d: Deps, args: GenerateImageArgs) {
  const coreDeps = d.imageGen;
  if (!coreDeps) {
    throw new McpStructuredError({
      error: "provider_error",
      message: "Geração de imagens não está configurada neste ambiente.",
      retryable: false,
    });
  }
  const input: ImageGenInput = {
    contaId: d.ctx.conta_id,
    source: "mcp",
    createdBy: d.ctx.created_by,
    createdVia: "agent",
    mcpKeyId: d.ctx.key_id,
    prompt: args.prompt,
    aspectRatio: args.aspect_ratio,
    placement: args.placement,
    quality: args.quality,
    clientId: args.client_id,
    postId: args.post_id,
    referenceFileIds: args.reference_file_ids,
    useBrandLogo: args.use_brand_logo,
    idempotencyKey: args.idempotency_key,
  };
  try {
    return await generateImageCore(coreDeps, input);
  } catch (e) {
    if (e instanceof ImageGenError) {
      throw new McpStructuredError({
        error: e.code,
        message: e.message,
        retryable: e.retryable,
        ...(e.retryAfter ? { retry_after: e.retryAfter } : {}),
      });
    }
    throw e;
  }
}

export type { ImageGenCoreDeps };
