# Inline Image Paste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to paste or drag-and-drop images into the TipTap post editor, upload them to R2, and display them in the Hub's read-only editor for client approval.

**Architecture:** Custom TipTap `inlineImage` node stores R2 keys (not URLs) in the `conteudo` JSON. Upload reuses the existing `file-upload-url` → PUT → `file-upload-finalize` pipeline. A new `sign-r2-urls` edge function batch-resolves R2 keys to signed GET URLs for both CRM and Hub rendering.

**Tech Stack:** TipTap 3.x custom Node extension, React, Cloudflare R2 (presigned URLs), Supabase Edge Functions (Deno)

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `apps/crm/src/pages/entregas/components/InlineImageExtension.tsx` | Custom TipTap node: attributes, paste/drop handlers, placeholder UI, upload orchestration |
| `apps/hub/src/components/InlineImageReadonly.tsx` | Read-only TipTap node for Hub rendering (no upload logic) |
| `apps/crm/src/services/inlineImage.ts` | `uploadInlineImage()` function + `resolveInlineImageUrls()` for batch R2 key→URL resolution |
| `supabase/functions/sign-r2-urls/index.ts` | Edge function entrypoint for batch-signing R2 keys |
| `supabase/functions/sign-r2-urls/handler.ts` | Handler: validates auth + workspace ownership of keys, returns signed URLs |
| `supabase/functions/__tests__/sign-r2-urls_test.ts` | Tests for the sign-r2-urls handler |

### Modified Files
| File | Change |
|------|--------|
| `apps/crm/src/pages/entregas/components/PostEditor.tsx` | Add `InlineImageExtension` to extensions array, add `postId` prop, pass upload function |
| `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` | Pass `postId` to `PostEditor` |
| `apps/hub/src/components/RichTextContent.tsx` | Add `InlineImageReadonly` to extensions array |
| `supabase/functions/hub-posts/handler.ts` | Scan `conteudo` JSON for `inlineImage` nodes, resolve R2 keys to signed URLs before returning |

---

### Task 1: Create the `sign-r2-urls` Edge Function

This edge function accepts a list of R2 keys, verifies the caller owns them (keys are prefixed with `contas/{conta_id}/`), and returns signed GET URLs. Used by both the CRM editor (loading posts) and could be used by other clients.

**Files:**
- Create: `supabase/functions/sign-r2-urls/index.ts`
- Create: `supabase/functions/sign-r2-urls/handler.ts`
- Create: `supabase/functions/__tests__/sign-r2-urls_test.ts`

- [ ] **Step 1: Write the failing test for sign-r2-urls**

Create `supabase/functions/__tests__/sign-r2-urls_test.ts`:

```typescript
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createSignR2UrlsHandler } from "../sign-r2-urls/handler.ts";

function makeDeps(overrides: Partial<Parameters<typeof createSignR2UrlsHandler>[0]> = {}) {
  return {
    buildCorsHeaders: () => ({ "Access-Control-Allow-Origin": "http://localhost" }),
    createDb: () => ({
      auth: {
        getUser: async (_token: string) => ({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from: (table: string) => ({
        select: (_cols: string) => ({
          eq: (_col: string, _val: string) => ({
            single: async () => ({ data: { conta_id: "conta-abc" }, error: null }),
          }),
        }),
      }),
    }),
    signGetUrl: async (key: string) => `https://r2.example.com/${key}?signed=1`,
    ...overrides,
  };
}

function makeReq(method: string, body?: unknown) {
  return new Request("http://localhost/sign-r2-urls", {
    method,
    headers: {
      "Authorization": "Bearer test-token",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

Deno.test("returns signed URLs for valid keys owned by user's workspace", async () => {
  const handler = createSignR2UrlsHandler(makeDeps());
  const res = await handler(makeReq("POST", {
    keys: ["contas/conta-abc/files/img1.webp", "contas/conta-abc/files/img2.png"],
  }));
  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(data.urls["contas/conta-abc/files/img1.webp"], "https://r2.example.com/contas/conta-abc/files/img1.webp?signed=1");
  assertEquals(data.urls["contas/conta-abc/files/img2.png"], "https://r2.example.com/contas/conta-abc/files/img2.png?signed=1");
});

Deno.test("rejects keys not belonging to user's workspace", async () => {
  const handler = createSignR2UrlsHandler(makeDeps());
  const res = await handler(makeReq("POST", {
    keys: ["contas/other-workspace/files/img.webp"],
  }));
  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(data.urls, {});
});

Deno.test("returns 401 without auth header", async () => {
  const handler = createSignR2UrlsHandler(makeDeps());
  const res = await handler(new Request("http://localhost/sign-r2-urls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys: [] }),
  }));
  assertEquals(res.status, 401);
});

Deno.test("returns 400 when keys is not an array", async () => {
  const handler = createSignR2UrlsHandler(makeDeps());
  const res = await handler(makeReq("POST", { keys: "not-array" }));
  assertEquals(res.status, 400);
});

Deno.test("handles OPTIONS for CORS preflight", async () => {
  const handler = createSignR2UrlsHandler(makeDeps());
  const res = await handler(new Request("http://localhost/sign-r2-urls", { method: "OPTIONS" }));
  assertEquals(res.status, 200);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/eduardosouza/Projects/sm-crm && deno test supabase/functions/__tests__/sign-r2-urls_test.ts --allow-net --allow-env`

Expected: FAIL — `createSignR2UrlsHandler` does not exist yet.

- [ ] **Step 3: Write the handler implementation**

Create `supabase/functions/sign-r2-urls/handler.ts`:

```typescript
import { createJsonResponder } from "../_shared/http.ts";

type DbClient = {
  from: (table: string) => any;
  auth: { getUser: (token: string) => Promise<{ data: { user: any }; error: any }> };
};

interface SignR2UrlsDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  signGetUrl: (key: string, expiresSeconds?: number) => Promise<string>;
}

export function createSignR2UrlsHandler(deps: SignR2UrlsDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");

    const svc = deps.createDb();
    const { data: { user }, error: authErr } = await svc.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await svc.from("profiles").select("conta_id").eq("id", user.id).single();
    if (!profile?.conta_id) return json({ error: "Profile not found" }, 403);

    let body: { keys: string[] };
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

    if (!Array.isArray(body.keys)) return json({ error: "keys must be an array" }, 400);

    const prefix = `contas/${profile.conta_id}/`;
    const validKeys = body.keys.filter((k) => typeof k === "string" && k.startsWith(prefix));

    const urls: Record<string, string> = {};
    await Promise.all(validKeys.map(async (key) => {
      urls[key] = await deps.signGetUrl(key, 3600);
    }));

    return json({ urls });
  };
}
```

- [ ] **Step 4: Write the edge function entrypoint**

Create `supabase/functions/sign-r2-urls/index.ts`:

```typescript
import { createClient } from "npm:@supabase/supabase-js@2";
import { signGetUrl } from "../_shared/r2.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createSignR2UrlsHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createSignR2UrlsHandler({
  buildCorsHeaders,
  createDb: () => createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  }),
  signGetUrl,
}));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/eduardosouza/Projects/sm-crm && deno test supabase/functions/__tests__/sign-r2-urls_test.ts --allow-net --allow-env`

Expected: All 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/sign-r2-urls/ supabase/functions/__tests__/sign-r2-urls_test.ts
git commit -m "feat: add sign-r2-urls edge function for batch R2 key resolution"
```

---

### Task 2: Create the Inline Image Upload Service

A thin service module that handles uploading an inline image to R2 (reusing the existing pipeline) and resolving R2 keys to signed URLs via the new `sign-r2-urls` endpoint.

**Files:**
- Create: `apps/crm/src/services/inlineImage.ts`

- [ ] **Step 1: Create the inline image upload service**

Create `apps/crm/src/services/inlineImage.ts`:

```typescript
import { supabase } from '../lib/supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const MAX_INLINE_SIZE = 10 * 1024 * 1024; // 10 MB
const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

async function callFn<T>(
  name: string,
  method: 'GET' | 'POST',
  body?: unknown,
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const url = `${SUPABASE_URL}/functions/v1/${name}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function probeImage(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function generateBlurDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const ratio = img.naturalWidth / img.naturalHeight;
        const size = 16;
        const w = ratio >= 1 ? size : Math.round(size * ratio);
        const h = ratio >= 1 ? Math.round(size / ratio) : size;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/webp', 0.2));
      } catch (e) { reject(e); }
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

export function validateInlineImage(file: File) {
  if (!IMAGE_MIME.includes(file.type)) throw new Error(`Tipo de imagem não suportado: ${file.type}`);
  if (file.size > MAX_INLINE_SIZE) throw new Error('Imagem maior que 10 MB');
}

export interface InlineImageResult {
  r2Key: string;
  src: string;
  width: number;
  height: number;
}

export async function uploadInlineImage(
  file: File,
  postId: number,
): Promise<InlineImageResult> {
  validateInlineImage(file);

  const [{ width, height }] = await Promise.all([
    probeImage(file),
    generateBlurDataUrl(file).catch(() => undefined),
  ]);

  const signed = await callFn<{
    file_id: string; upload_url: string; r2_key: string;
    thumbnail_upload_url?: string; thumbnail_r2_key?: string;
  }>('file-upload-url', 'POST', {
    filename: file.name || 'pasted-image.png',
    mime_type: file.type,
    size_bytes: file.size,
  });

  await fetch(signed.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  }).then((res) => {
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  });

  const result = await callFn<{ url: string }>('file-upload-finalize', 'POST', {
    file_id: signed.file_id,
    r2_key: signed.r2_key,
    kind: 'image',
    mime_type: file.type,
    size_bytes: file.size,
    name: file.name || 'pasted-image.png',
    post_id: postId,
    width,
    height,
  });

  return { r2Key: signed.r2_key, src: result.url, width, height };
}

export async function resolveInlineImageUrls(
  r2Keys: string[],
): Promise<Record<string, string>> {
  if (r2Keys.length === 0) return {};
  const { urls } = await callFn<{ urls: Record<string, string> }>('sign-r2-urls', 'POST', { keys: r2Keys });
  return urls;
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /Users/eduardosouza/Projects/sm-crm && npx tsc --noEmit apps/crm/src/services/inlineImage.ts 2>&1 | head -20`

If tsc can't be run on a single file, run `npm run build` at the end of Task 3 instead.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/services/inlineImage.ts
git commit -m "feat: add inline image upload service with R2 key resolution"
```

---

### Task 3: Create the InlineImage TipTap Extension (CRM Editor)

The core extension: a custom TipTap node that handles paste/drop events, shows a blur placeholder during upload, and stores R2 keys in the document JSON.

**Files:**
- Create: `apps/crm/src/pages/entregas/components/InlineImageExtension.tsx`
- Modify: `apps/crm/src/pages/entregas/components/PostEditor.tsx`
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx`

- [ ] **Step 1: Create the InlineImage TipTap extension**

Create `apps/crm/src/pages/entregas/components/InlineImageExtension.tsx`:

```tsx
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Loader2, ImageIcon } from 'lucide-react';

const INLINE_IMAGE_MAX_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export type InlineImageUploadFn = (file: File) => Promise<{
  r2Key: string;
  src: string;
  width: number;
  height: number;
}>;

function InlineImageNodeView({ node }: NodeViewProps) {
  const { src, blurSrc, loading, width, height } = node.attrs;

  if (loading) {
    return (
      <NodeViewWrapper as="figure" className="inline-image-wrapper" data-loading="true">
        <div
          style={{
            position: 'relative',
            maxWidth: '100%',
            aspectRatio: width && height ? `${width}/${height}` : undefined,
            borderRadius: '8px',
            overflow: 'hidden',
            background: 'var(--surface-darker)',
          }}
        >
          {blurSrc ? (
            <img
              src={blurSrc}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(8px)', transform: 'scale(1.1)' }}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '120px' }}>
              <ImageIcon size={32} style={{ opacity: 0.3 }} />
            </div>
          )}
          <div
            style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(0,0,0,0.25)',
            }}
          >
            <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: '#fff' }} />
          </div>
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="figure" className="inline-image-wrapper">
      <img
        src={src}
        alt={node.attrs.alt ?? ''}
        style={{
          maxWidth: '100%',
          borderRadius: '8px',
          display: 'block',
          margin: '0.5rem 0',
        }}
      />
    </NodeViewWrapper>
  );
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    inlineImage: {
      insertInlineImage: (attrs: {
        r2Key: string;
        src: string;
        width?: number;
        height?: number;
        alt?: string;
      }) => ReturnType;
    };
  }
}

function isValidImageFile(file: File): boolean {
  return ALLOWED_MIME.includes(file.type) && file.size <= INLINE_IMAGE_MAX_SIZE;
}

function getImageFiles(dataTransfer: DataTransfer): File[] {
  const files: File[] = [];
  for (let i = 0; i < dataTransfer.files.length; i++) {
    const file = dataTransfer.files[i];
    if (isValidImageFile(file)) files.push(file);
  }
  return files;
}

const inlineImagePluginKey = new PluginKey('inlineImageUpload');

export function createInlineImageExtension(uploadFn: InlineImageUploadFn) {
  return Node.create({
    name: 'inlineImage',
    group: 'block',
    atom: true,
    draggable: true,

    addAttributes() {
      return {
        r2Key: { default: null },
        src: { default: null },
        blurSrc: { default: null },
        alt: { default: '' },
        width: { default: null },
        height: { default: null },
        loading: { default: false },
      };
    },

    parseHTML() {
      return [{ tag: 'figure[data-inline-image]' }];
    },

    renderHTML({ HTMLAttributes }) {
      return ['figure', mergeAttributes(HTMLAttributes, { 'data-inline-image': '' }), ['img', { src: HTMLAttributes.src }]];
    },

    addNodeView() {
      return ReactNodeViewRenderer(InlineImageNodeView);
    },

    addCommands() {
      return {
        insertInlineImage: (attrs) => ({ commands }) => {
          return commands.insertContent({ type: this.name, attrs });
        },
      };
    },

    addProseMirrorPlugins() {
      const extension = this;

      return [
        new Plugin({
          key: inlineImagePluginKey,

          props: {
            handlePaste(view, event) {
              const clipboardData = event.clipboardData;
              if (!clipboardData) return false;

              const files = getImageFiles(clipboardData);
              if (files.length === 0) return false;

              event.preventDefault();
              for (const file of files) {
                handleImageUpload(view, file, extension.name, uploadFn);
              }
              return true;
            },

            handleDrop(view, event) {
              const dataTransfer = event.dataTransfer;
              if (!dataTransfer) return false;

              const files = getImageFiles(dataTransfer);
              if (files.length === 0) return false;

              event.preventDefault();
              for (const file of files) {
                handleImageUpload(view, file, extension.name, uploadFn);
              }
              return true;
            },
          },
        }),
      ];
    },
  });
}

async function handleImageUpload(
  view: any,
  file: File,
  nodeType: string,
  uploadFn: InlineImageUploadFn,
) {
  const { state, dispatch } = view;
  const { tr, schema } = state;

  const blurSrc = await createBlurPreview(file).catch(() => null);
  const type = schema.nodes[nodeType];
  const placeholderNode = type.create({ loading: true, blurSrc });
  dispatch(tr.replaceSelectionWith(placeholderNode));

  try {
    const result = await uploadFn(file);

    const { state: newState } = view;
    const newTr = newState.tr;
    let replaced = false;

    newState.doc.descendants((node: any, pos: number) => {
      if (replaced) return false;
      if (node.type.name === nodeType && node.attrs.loading === true && node.attrs.blurSrc === blurSrc) {
        newTr.setNodeMarkup(pos, undefined, {
          r2Key: result.r2Key,
          src: result.src,
          alt: '',
          width: result.width,
          height: result.height,
          loading: false,
          blurSrc: null,
        });
        replaced = true;
        return false;
      }
    });

    if (replaced) view.dispatch(newTr);
  } catch (err) {
    const { state: newState } = view;
    const newTr = newState.tr;
    let removed = false;

    newState.doc.descendants((node: any, pos: number) => {
      if (removed) return false;
      if (node.type.name === nodeType && node.attrs.loading === true && node.attrs.blurSrc === blurSrc) {
        newTr.delete(pos, pos + node.nodeSize);
        removed = true;
        return false;
      }
    });

    if (removed) view.dispatch(newTr);
    throw err;
  }
}

function createBlurPreview(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const ratio = img.naturalWidth / img.naturalHeight;
        const size = 16;
        const w = ratio >= 1 ? size : Math.round(size * ratio);
        const h = ratio >= 1 ? Math.round(size / ratio) : size;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/webp', 0.2));
      } catch (e) { reject(e); }
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}
```

- [ ] **Step 2: Register extension in PostEditor and add `postId` prop**

Modify `apps/crm/src/pages/entregas/components/PostEditor.tsx`:

Add import at the top (after the existing imports):
```typescript
import { createInlineImageExtension } from './InlineImageExtension';
import type { InlineImageUploadFn } from './InlineImageExtension';
```

Add `postId` and `onUploadInlineImage` to the props interface:
```typescript
interface PostEditorProps {
  initialContent: Record<string, unknown> | null;
  onUpdate: (json: Record<string, unknown>, plain: string) => void;
  disabled?: boolean;
  postId?: number;
  onUploadInlineImage?: InlineImageUploadFn;
  // ... rest of existing props unchanged
}
```

Add `postId` and `onUploadInlineImage` to the destructured props:
```typescript
export function PostEditor({
  initialContent,
  onUpdate,
  disabled,
  postId,
  onUploadInlineImage,
  // ... rest unchanged
}: PostEditorProps) {
```

Add `InlineImageExtension` to the `extensions` array (add after `CommentHighlight`):
```typescript
const editor = useEditor({
  extensions: [
    StarterKit,
    UnderlineExt,
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true, HTMLAttributes: {} }),
    Link.configure({ openOnClick: false, autolink: true }),
    Placeholder.configure({ placeholder: 'Escreva o conteúdo do post...' }),
    CalloutExtension,
    CommentHighlight,
    ...(onUploadInlineImage ? [createInlineImageExtension(onUploadInlineImage)] : []),
  ],
  // ... rest unchanged
});
```

- [ ] **Step 3: Pass `postId` and upload function from WorkflowDrawer**

Modify `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx`:

Add import at the top:
```typescript
import { uploadInlineImage } from '@/services/inlineImage';
import { toast } from 'sonner';
```

In the `PostCard` component (the inner component that renders each post), find the `<PostEditor` JSX and add the new props:
```tsx
<PostEditor
  key={post.id}
  initialContent={post.conteudo}
  onUpdate={onContentUpdate}
  postId={post.id}
  onUploadInlineImage={post.id ? async (file) => {
    try {
      return await uploadInlineImage(file, post.id!);
    } catch (err) {
      toast.error(err instanceof Error && err.message === 'quota_exceeded'
        ? 'Limite de armazenamento atingido'
        : 'Falha ao enviar imagem');
      throw err;
    }
  } : undefined}
  // ... rest of existing props unchanged
/>
```

- [ ] **Step 4: Typecheck and verify**

Run: `cd /Users/eduardosouza/Projects/sm-crm && npm run build 2>&1 | tail -20`

Expected: Build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components/InlineImageExtension.tsx \
       apps/crm/src/pages/entregas/components/PostEditor.tsx \
       apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx
git commit -m "feat: add InlineImage TipTap extension with paste and drag-drop support"
```

---

### Task 4: Resolve R2 Keys on CRM Post Load

When the CRM loads a post's `conteudo` into the editor, inline image nodes have `r2Key` but no `src`. We need to resolve these before passing content to TipTap.

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx`

- [ ] **Step 1: Add content resolution utility**

Add a utility function in the same file (or import from `inlineImage.ts`). Add to `apps/crm/src/services/inlineImage.ts`:

```typescript
export function extractR2Keys(content: Record<string, unknown> | null): string[] {
  if (!content) return [];
  const keys: string[] = [];
  function walk(node: any) {
    if (node?.type === 'inlineImage' && node.attrs?.r2Key) {
      keys.push(node.attrs.r2Key);
    }
    if (Array.isArray(node?.content)) node.content.forEach(walk);
  }
  walk(content);
  return keys;
}

export function injectSignedUrls(
  content: Record<string, unknown>,
  urlMap: Record<string, string>,
): Record<string, unknown> {
  function walk(node: any): any {
    if (node?.type === 'inlineImage' && node.attrs?.r2Key && urlMap[node.attrs.r2Key]) {
      return { ...node, attrs: { ...node.attrs, src: urlMap[node.attrs.r2Key] } };
    }
    if (Array.isArray(node?.content)) {
      return { ...node, content: node.content.map(walk) };
    }
    return node;
  }
  return walk(content);
}
```

- [ ] **Step 2: Resolve URLs when posts load in the drawer**

Modify `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx`. In the parent component that manages posts, add a `useEffect` or modify the data fetching to resolve inline image URLs. The simplest approach: resolve in the `PostCard` component before passing to `PostEditor`.

Add imports:
```typescript
import { extractR2Keys, injectSignedUrls, resolveInlineImageUrls } from '@/services/inlineImage';
```

In the `PostCard` component, add state and effect to resolve content URLs:
```typescript
const [resolvedContent, setResolvedContent] = useState<Record<string, unknown> | null>(post.conteudo);

useEffect(() => {
  if (!post.conteudo) { setResolvedContent(null); return; }
  const keys = extractR2Keys(post.conteudo);
  if (keys.length === 0) { setResolvedContent(post.conteudo); return; }
  let cancelled = false;
  resolveInlineImageUrls(keys).then((urlMap) => {
    if (!cancelled) setResolvedContent(injectSignedUrls(post.conteudo!, urlMap));
  }).catch(() => {
    if (!cancelled) setResolvedContent(post.conteudo);
  });
  return () => { cancelled = true; };
}, [post.conteudo]);
```

Then change the `PostEditor` to use `resolvedContent` instead of `post.conteudo`:
```tsx
<PostEditor
  key={post.id}
  initialContent={resolvedContent}
  // ... rest unchanged
/>
```

- [ ] **Step 3: Typecheck**

Run: `cd /Users/eduardosouza/Projects/sm-crm && npm run build 2>&1 | tail -20`

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/services/inlineImage.ts \
       apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx
git commit -m "feat: resolve inline image R2 keys to signed URLs on post load"
```

---

### Task 5: Create Read-Only InlineImage Extension for Hub

The Hub needs a read-only version of the node so `RichTextContent` can render inline images.

**Files:**
- Create: `apps/hub/src/components/InlineImageReadonly.tsx`
- Modify: `apps/hub/src/components/RichTextContent.tsx`

- [ ] **Step 1: Create the read-only extension**

Create `apps/hub/src/components/InlineImageReadonly.tsx`:

```tsx
import { Node, mergeAttributes } from '@tiptap/core';

export const InlineImageReadonly = Node.create({
  name: 'inlineImage',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      r2Key: { default: null },
      src: { default: null },
      alt: { default: '' },
      width: { default: null },
      height: { default: null },
      loading: { default: false },
      blurSrc: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'figure[data-inline-image]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'figure',
      mergeAttributes({ 'data-inline-image': '', style: 'margin: 0.5rem 0' }),
      [
        'img',
        {
          src: HTMLAttributes.src,
          alt: HTMLAttributes.alt ?? '',
          style: 'max-width: 100%; border-radius: 8px; display: block',
        },
      ],
    ];
  },
});
```

- [ ] **Step 2: Register in RichTextContent**

Modify `apps/hub/src/components/RichTextContent.tsx`:

Add import:
```typescript
import { InlineImageReadonly } from './InlineImageReadonly';
```

Add to extensions array (after `CalloutReadonly`):
```typescript
const editor = useEditor({
  extensions: [
    StarterKit,
    UnderlineExt,
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    Link.configure({ openOnClick: true, autolink: false }),
    CalloutReadonly,
    InlineImageReadonly,
  ],
  content,
  editable: false,
});
```

- [ ] **Step 3: Typecheck**

Run: `cd /Users/eduardosouza/Projects/sm-crm && npm run build:hub 2>&1 | tail -20`

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/hub/src/components/InlineImageReadonly.tsx \
       apps/hub/src/components/RichTextContent.tsx
git commit -m "feat(hub): add read-only InlineImage extension for Hub rendering"
```

---

### Task 6: Resolve Inline Image URLs in hub-posts Edge Function

The Hub gets `conteudo` JSON from the `hub-posts` edge function. We need to scan for `inlineImage` nodes and resolve their R2 keys to signed URLs before returning.

**Files:**
- Modify: `supabase/functions/hub-posts/handler.ts`

- [ ] **Step 1: Add the `resolveContentInlineImages` utility to the handler**

Add this helper function at the top of `supabase/functions/hub-posts/handler.ts` (after the imports):

```typescript
function extractR2Keys(content: any): string[] {
  const keys: string[] = [];
  function walk(node: any) {
    if (node?.type === "inlineImage" && node.attrs?.r2Key) {
      keys.push(node.attrs.r2Key);
    }
    if (Array.isArray(node?.content)) node.content.forEach(walk);
  }
  walk(content);
  return keys;
}

function injectSignedUrls(content: any, urlMap: Record<string, string>): any {
  function walk(node: any): any {
    if (node?.type === "inlineImage" && node.attrs?.r2Key && urlMap[node.attrs.r2Key]) {
      return { ...node, attrs: { ...node.attrs, src: urlMap[node.attrs.r2Key] } };
    }
    if (Array.isArray(node?.content)) {
      return { ...node, content: node.content.map(walk) };
    }
    return node;
  }
  return walk(content);
}
```

- [ ] **Step 2: Apply resolution before returning posts**

In the GET handler, after building `flatPostsWithMedia` (around line 198), add inline image URL resolution:

```typescript
// Resolve inline image R2 keys in conteudo
const allContentKeys: string[] = [];
for (const post of flatPostsWithMedia) {
  if (post.conteudo) allContentKeys.push(...extractR2Keys(post.conteudo));
}

const contentUrlMap: Record<string, string> = {};
if (allContentKeys.length > 0) {
  await Promise.all(
    allContentKeys.map(async (key) => {
      contentUrlMap[key] = await deps.signGetUrl(key, 3600);
    })
  );
}

const postsWithResolvedContent = flatPostsWithMedia.map((post: any) => {
  if (!post.conteudo || !extractR2Keys(post.conteudo).length) return post;
  return { ...post, conteudo: injectSignedUrls(post.conteudo, contentUrlMap) };
});
```

Then change the final response to use `postsWithResolvedContent` instead of `flatPostsWithMedia`:

```typescript
return json({
  posts: postsWithResolvedContent,
  // ... rest unchanged
});
```

- [ ] **Step 3: Run existing hub-posts tests**

Run: `cd /Users/eduardosouza/Projects/sm-crm && deno test supabase/functions/__tests__/hub-functions_test.ts --allow-net --allow-env`

Expected: Existing tests still pass (inline images are additive, existing posts have no `inlineImage` nodes).

- [ ] **Step 4: Typecheck**

Run: `cd /Users/eduardosouza/Projects/sm-crm && npm run build:hub 2>&1 | tail -20`

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/hub-posts/handler.ts
git commit -m "feat(hub): resolve inline image R2 keys in hub-posts response"
```

---

### Task 7: Add CSS for Inline Image Placeholder Animation

The loading spinner uses CSS animation. Add the `@keyframes spin` rule so the `Loader2` spinner animates.

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/InlineImageExtension.tsx` (check if spin keyframe already exists globally)

- [ ] **Step 1: Check if spin keyframe exists globally**

Run: `grep -r "@keyframes spin" /Users/eduardosouza/Projects/sm-crm/apps/crm/ --include="*.css" 2>/dev/null`

If it already exists, skip to Step 3. If not, continue.

- [ ] **Step 2: Add inline style for spin animation (if not global)**

The `Loader2` icon from lucide-react already has no built-in animation. Modify the style in `InlineImageExtension.tsx` to use a CSS-in-JS approach instead. Replace the `Loader2` style:

```tsx
<Loader2 size={28} className="animate-spin" style={{ color: '#fff' }} />
```

If `animate-spin` is not available (it's a Tailwind utility), use the inline approach:

```tsx
<style>{`@keyframes inline-img-spin { to { transform: rotate(360deg) } }`}</style>
<Loader2 size={28} style={{ animation: 'inline-img-spin 1s linear infinite', color: '#fff' }} />
```

- [ ] **Step 3: Verify visually (manual test)**

1. Run `npm run dev` in the CRM app
2. Open a workflow post in the drawer
3. Copy an image to clipboard and paste into the editor
4. Verify: blur placeholder appears with spinning loader
5. Verify: placeholder is replaced by the final image after upload
6. Verify: image persists after page reload (R2 key resolves to signed URL)

- [ ] **Step 4: Commit (if changes were made)**

```bash
git add apps/crm/src/pages/entregas/components/InlineImageExtension.tsx
git commit -m "fix: ensure inline image loading spinner animates"
```

---

### Task 8: Run Full Test Suite and Final Typecheck

Verify nothing is broken.

**Files:** None (verification only)

- [ ] **Step 1: Run CRM build**

Run: `cd /Users/eduardosouza/Projects/sm-crm && npm run build 2>&1 | tail -30`

Expected: Build succeeds (tsc + vite build).

- [ ] **Step 2: Run Hub build**

Run: `cd /Users/eduardosouza/Projects/sm-crm && npm run build:hub 2>&1 | tail -30`

Expected: Build succeeds.

- [ ] **Step 3: Run frontend tests**

Run: `cd /Users/eduardosouza/Projects/sm-crm && npm run test 2>&1 | tail -30`

Expected: All tests pass.

- [ ] **Step 4: Run edge function tests**

Run: `cd /Users/eduardosouza/Projects/sm-crm && deno test supabase/functions/__tests__/ --allow-net --allow-env 2>&1 | tail -30`

Expected: All tests pass (including the new `sign-r2-urls_test.ts`).

- [ ] **Step 5: Manual Hub test**

1. Run `npm run dev:hub`
2. Open a client hub link with posts that have inline images
3. Verify inline images appear in the text content for TextPostCard
4. Verify images also appear for posts with media (in the text section)

- [ ] **Step 6: Final commit if any fixes were needed**

Only commit if fixes were applied. Otherwise, skip.
