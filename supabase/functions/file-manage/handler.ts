import { createJsonResponder } from "../_shared/http.ts";

type DbClient = {
  from: (table: string) => any;
  auth: { getUser: (token: string) => Promise<{ data: { user: any }; error: any }> };
  rpc: (name: string, params: Record<string, unknown>) => any;
};

interface FileManageDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  signUrl: (key: string) => Promise<string>;
  now?: () => string;
}

export function createFileManageHandler(deps: FileManageDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = { ...deps.buildCorsHeaders(req), "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS" };
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");

    const svc = deps.createDb();
    const { data: { user }, error: authErr } = await svc.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await svc.from("profiles").select("conta_id").eq("id", user.id).single();
    if (!profile?.conta_id) return json({ error: "Profile not found" }, 403);

    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("file-manage");
    const resource = parts[idx + 1]; // 'folders' or 'files' or 'links'
    const idStr = parts[idx + 2];
    const contaId = profile.conta_id;

    // ─── FOLDERS ──────────────────────────────────────────────────
    if (resource === "folders") {
      // GET /folders?parent_id=... → list folder contents
      if (req.method === "GET") {
        const parentId = url.searchParams.get("parent_id");
        const parentFilter = parentId ? Number(parentId) : null;

        const foldersQ = svc.from("folders").select("*").eq("conta_id", contaId);
        if (parentFilter) foldersQ.eq("parent_id", parentFilter);
        else foldersQ.is("parent_id", null);
        foldersQ.order("source", { ascending: true }).order("name", { ascending: true });

        const filesQ = svc.from("files").select("*").eq("conta_id", contaId);
        if (parentFilter) filesQ.eq("folder_id", parentFilter);
        else filesQ.is("folder_id", null);
        filesQ.order("created_at", { ascending: false });

        const [{ data: subfolders }, { data: files }] = await Promise.all([foldersQ, filesQ]);

        const signedFiles = await Promise.all((files ?? []).map(async (f: any) => ({
          ...f,
          url: f.kind !== "document" ? await deps.signUrl(f.r2_key) : null,
          thumbnail_url: f.thumbnail_r2_key ? await deps.signUrl(f.thumbnail_r2_key) : null,
        })));

        let breadcrumbs: { id: number; name: string }[] = [];
        if (parentFilter) {
          let currentId: number | null = parentFilter;
          while (currentId) {
            const { data: f } = await svc.from("folders").select("id, name, parent_id").eq("id", currentId).single();
            if (!f) break;
            breadcrumbs.unshift({ id: f.id, name: f.name });
            currentId = f.parent_id;
          }
        }

        let folder: any = null;
        if (parentFilter) {
          const { data: f } = await svc.from("folders").select("*").eq("id", parentFilter).single();
          folder = f;
        }

        return json({ folder, subfolders: subfolders ?? [], files: signedFiles, breadcrumbs });
      }

      // POST /folders → create folder
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const { name, parent_id } = body as { name?: string; parent_id?: number | null };
        if (!name) return json({ error: "name required" }, 400);

        if (parent_id) {
          const { data: parent } = await svc.from("folders").select("conta_id").eq("id", parent_id).single();
          if (!parent || parent.conta_id !== contaId) return json({ error: "Parent folder not found" }, 404);
        }

        const { data: created, error: createErr } = await svc.from("folders").insert({
          conta_id: contaId,
          parent_id: parent_id ?? null,
          name,
          source: "user",
        }).select().single();

        if (createErr) return json({ error: createErr.message }, 500);
        return json(created, 201);
      }

      // PATCH /folders/:id → rename or move
      if (req.method === "PATCH" && idStr) {
        const folderId = Number(idStr);
        const { data: folder } = await svc.from("folders").select("*").eq("id", folderId).single();
        if (!folder || folder.conta_id !== contaId) return json({ error: "Folder not found" }, 404);

        const body = await req.json().catch(() => ({}));
        const patch: Record<string, unknown> = { updated_at: (deps.now ?? (() => new Date().toISOString()))() };

        if (typeof body.name === "string") {
          patch.name = body.name;
          if (folder.source === "system") patch.name_overridden = true;
        }
        if (body.parent_id !== undefined) {
          patch.parent_id = body.parent_id;
        }

        const { data: updated, error: updErr } = await svc.from("folders").update(patch).eq("id", folderId).select().single();
        if (updErr) return json({ error: updErr.message }, 500);
        return json(updated);
      }

      // DELETE /folders/:id
      if (req.method === "DELETE" && idStr) {
        const folderId = Number(idStr);
        const { data: folder } = await svc.from("folders").select("source, conta_id").eq("id", folderId).single();
        if (!folder || folder.conta_id !== contaId) return json({ error: "Folder not found" }, 404);

        if (folder.source === "system") {
          return json({ error: "System folders cannot be deleted" }, 403);
        }

        const { error: delErr } = await svc.from("folders").delete().eq("id", folderId);
        if (delErr) return json({ error: delErr.message }, 500);
        return json({ ok: true });
      }
    }

    // ─── FILES ────────────────────────────────────────────────────
    if (resource === "files") {
      // PATCH /files/:id → rename or move
      if (req.method === "PATCH" && idStr) {
        const fileId = Number(idStr);
        const { data: file } = await svc.from("files").select("conta_id").eq("id", fileId).single();
        if (!file || file.conta_id !== contaId) return json({ error: "File not found" }, 404);

        const body = await req.json().catch(() => ({}));
        const patch: Record<string, unknown> = {};
        if (typeof body.name === "string") patch.name = body.name;
        if (body.folder_id !== undefined) patch.folder_id = body.folder_id;

        if (Object.keys(patch).length === 0) return json({ error: "Nothing to update" }, 400);

        const { data: updated, error: updErr } = await svc.from("files").update(patch).eq("id", fileId).select().single();
        if (updErr) return json({ error: updErr.message }, 500);
        return json(updated);
      }

      // DELETE /files/:id
      if (req.method === "DELETE" && idStr) {
        const fileId = Number(idStr);
        const { data: file } = await svc.from("files").select("conta_id, reference_count").eq("id", fileId).single();
        if (!file || file.conta_id !== contaId) return json({ error: "File not found" }, 404);

        if (file.reference_count > 0) {
          const { data: links } = await svc.from("post_file_links")
            .select("post_id, workflow_posts(titulo, workflow_id, workflows(titulo))")
            .eq("file_id", fileId);
          return json({
            error: "file_in_use",
            reference_count: file.reference_count,
            linked_posts: (links ?? []).map((l: any) => ({
              post_id: l.post_id,
              post_titulo: l.workflow_posts?.titulo,
              workflow_titulo: l.workflow_posts?.workflows?.titulo,
            })),
          }, 409);
        }

        const { error: delErr } = await svc.from("files").delete().eq("id", fileId);
        if (delErr) return json({ error: delErr.message }, 500);
        return json({ ok: true });
      }
    }

    // ─── LINKS ────────────────────────────────────────────────────
    if (resource === "links") {
      // POST /links → link file to post
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const { post_id, file_id } = body as { post_id?: number; file_id?: number };
        if (!post_id || !file_id) return json({ error: "post_id and file_id required" }, 400);

        const { data: file } = await svc.from("files").select("conta_id, kind").eq("id", file_id).single();
        if (!file || file.conta_id !== contaId) return json({ error: "File not found" }, 404);
        if (file.kind === "document") return json({ error: "Documents cannot be linked to posts" }, 400);

        const { data: post } = await svc.from("workflow_posts").select("conta_id").eq("id", post_id).single();
        if (!post || post.conta_id !== contaId) return json({ error: "Post not found" }, 404);

        const { data: link, error: linkErr } = await svc.from("post_file_links").insert({
          post_id, file_id, conta_id: contaId,
        }).select().single();

        if (linkErr) {
          if (linkErr.message.includes("duplicate")) return json({ error: "Already linked" }, 409);
          return json({ error: linkErr.message }, 500);
        }
        return json(link, 201);
      }

      // DELETE /links/:id → unlink file from post
      if (req.method === "DELETE" && idStr) {
        const linkId = Number(idStr);
        const { data: link } = await svc.from("post_file_links").select("conta_id").eq("id", linkId).single();
        if (!link || link.conta_id !== contaId) return json({ error: "Link not found" }, 404);

        const { error: delErr } = await svc.from("post_file_links").delete().eq("id", linkId);
        if (delErr) return json({ error: delErr.message }, 500);
        return json({ ok: true });
      }

      // GET /links?post_id=... → list links for a post (with file data)
      if (req.method === "GET") {
        const postId = Number(url.searchParams.get("post_id"));
        if (!postId) return json({ error: "post_id required" }, 400);

        const { data: links } = await svc.from("post_file_links")
          .select("*, files(*)")
          .eq("post_id", postId)
          .eq("conta_id", contaId)
          .order("sort_order", { ascending: true })
          .order("id", { ascending: true });

        const withUrls = await Promise.all((links ?? []).map(async (l: any) => {
          const f = l.files;
          return {
            ...l,
            files: {
              ...f,
              url: f.kind !== "document" ? await deps.signUrl(f.r2_key) : null,
              thumbnail_url: f.thumbnail_r2_key ? await deps.signUrl(f.thumbnail_r2_key) : null,
            },
          };
        }));

        return json({ links: withUrls });
      }

      // PATCH /links/:id → update sort_order or is_cover
      if (req.method === "PATCH" && idStr) {
        const linkId = Number(idStr);
        const { data: link } = await svc.from("post_file_links").select("conta_id").eq("id", linkId).single();
        if (!link || link.conta_id !== contaId) return json({ error: "Link not found" }, 404);

        const body = await req.json().catch(() => ({}));

        if (body.is_cover === true) {
          const { error: swapErr } = await svc.rpc("post_file_link_set_cover", { p_link_id: linkId });
          if (swapErr) return json({ error: swapErr.message }, 500);
          const { data: updated } = await svc.from("post_file_links").select("*").eq("id", linkId).single();
          return json(updated);
        }

        const patch: Record<string, unknown> = {};
        if (typeof body.sort_order === "number") patch.sort_order = body.sort_order;

        if (Object.keys(patch).length === 0) return json({ error: "Nothing to update" }, 400);

        const { data: updated, error: updErr } = await svc.from("post_file_links").update(patch).eq("id", linkId).select().single();
        if (updErr) return json({ error: updErr.message }, 500);
        return json(updated);
      }
    }

    return json({ error: "Not found" }, 404);
  };
}
