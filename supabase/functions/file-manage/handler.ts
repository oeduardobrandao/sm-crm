import { createJsonResponder } from "../_shared/http.ts";
import { insertAuditLog } from "../_shared/audit.ts";
import { copyObject } from "../_shared/r2.ts";

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
    const resource = parts[idx + 1]; // 'tree' or 'folders' or 'files' or 'links'
    const idStr = parts[idx + 2];
    const subResource = parts[idx + 3]; // e.g. 'copy', 'url'
    const contaId = profile.conta_id;

    // ─── TREE ─────────────────────────────────────────────────────
    if (resource === "tree") {
      if (req.method === "GET") {
        const parentParam = url.searchParams.get("parent_id");

        const foldersQ = svc.from("folders")
          .select("id, name, source, source_type, position")
          .eq("conta_id", contaId);
        if (parentParam) foldersQ.eq("parent_id", Number(parentParam));
        else foldersQ.is("parent_id", null);
        foldersQ.order("source", { ascending: true }).order("name", { ascending: true });

        const { data: folders } = await foldersQ;
        const folderIds = (folders ?? []).map((f: any) => f.id);

        let parentSet = new Set<number>();
        if (folderIds.length > 0) {
          const { data: children } = await svc.from("folders").select("parent_id").eq("conta_id", contaId).in("parent_id", folderIds);
          for (const c of (children ?? [])) parentSet.add(c.parent_id);
        }

        return json((folders ?? []).map((f: any) => ({ ...f, has_children: parentSet.has(f.id) })));
      }
    }

    // ─── FOLDERS ──────────────────────────────────────────────────
    if (resource === "folders") {
      // GET /folders/:id → single folder info
      if (req.method === "GET" && idStr) {
        const folderId = Number(idStr);
        const { data: folder } = await svc.from("folders").select("*").eq("id", folderId).single();
        if (!folder || folder.conta_id !== contaId) return json({ error: "Folder not found" }, 404);

        const { data: sizeData } = await svc.rpc("folder_total_size", { p_folder_id: folderId }).single();

        const { count: subfolderCount } = await svc.from("folders")
          .select("id", { count: "exact", head: true })
          .eq("parent_id", folderId);
        const { count: directFileCount } = await svc.from("files")
          .select("id", { count: "exact", head: true })
          .eq("folder_id", folderId);

        return json({
          ...folder,
          total_size_bytes: sizeData?.total_size_bytes ?? 0,
          total_file_count: sizeData?.file_count ?? 0,
          direct_subfolder_count: subfolderCount ?? 0,
          direct_file_count: directFileCount ?? 0,
        });
      }

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

        // Compute folder sizes using batch RPC (replaces N+1 individual calls)
        const folderIds = (subfolders ?? []).map((f: any) => f.id);
        let folderSizes: Record<number, { total_size_bytes: number; file_count: number }> = {};
        let hasChildrenFlags: Record<number, boolean> = {};
        if (folderIds.length > 0) {
          const { data: sizeRows } = await svc.rpc("folder_sizes_batch", { p_folder_ids: folderIds });
          for (const r of (sizeRows ?? [])) {
            folderSizes[r.folder_id] = { total_size_bytes: r.total_size_bytes, file_count: r.file_count };
          }

          const { data: children } = await svc.from("folders").select("parent_id").eq("conta_id", contaId).in("parent_id", folderIds);
          const parentSet = new Set((children ?? []).map((c: any) => c.parent_id));
          for (const id of folderIds) hasChildrenFlags[id] = parentSet.has(id);
        }

        const subfoldersWithSize = (subfolders ?? []).map((f: any) => ({
          ...f,
          total_size_bytes: folderSizes[f.id]?.total_size_bytes ?? 0,
          file_count: folderSizes[f.id]?.file_count ?? 0,
          has_children: hasChildrenFlags[f.id] ?? false,
        }));

        const signedFiles = await Promise.all((files ?? []).map(async (f: any) => ({
          ...f,
          url: f.kind !== "document" ? await deps.signUrl(f.r2_key) : null,
          thumbnail_url: f.thumbnail_r2_key ? await deps.signUrl(f.thumbnail_r2_key) : null,
        })));

        // Build breadcrumbs via RPC (replaces while-loop of individual selects)
        let breadcrumbs: { id: number; name: string }[] = [];
        if (parentFilter) {
          const { data: crumbs } = await svc.rpc("folder_breadcrumbs", { p_folder_id: parentFilter });
          breadcrumbs = (crumbs ?? []).map((c: any) => ({ id: c.id, name: c.name }));
        }

        let folder: any = null;
        if (parentFilter) {
          const { data: f } = await svc.from("folders").select("*").eq("id", parentFilter).single();
          folder = f;
        }

        // Fetch workspace storage usage
        const { data: workspace } = await svc.from("workspaces")
          .select("storage_used_bytes, storage_quota_bytes")
          .eq("id", contaId)
          .single();

        return json({
          folder,
          subfolders: subfoldersWithSize,
          files: signedFiles,
          breadcrumbs,
          storage: {
            used_bytes: workspace?.storage_used_bytes ?? 0,
            quota_bytes: workspace?.storage_quota_bytes ?? 0,
          },
        });
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

      // POST /folders/:id/copy → recursively copy a folder to a destination
      if (req.method === "POST" && idStr && subResource === "copy") {
        const folderId = Number(idStr);
        const body = await req.json().catch(() => ({}));
        const { destination_folder_id } = body as { destination_folder_id?: number | null };

        const { data: source } = await svc.from("folders").select("*").eq("id", folderId).single();
        if (!source || source.conta_id !== contaId) return json({ error: "Folder not found" }, 404);

        const { data: sizeInfo } = await svc.rpc("folder_sizes_batch", { p_folder_ids: [folderId] });
        const totalFiles = sizeInfo?.[0]?.file_count ?? 0;
        const totalBytes = sizeInfo?.[0]?.total_size_bytes ?? 0;

        if (totalFiles > 200) {
          return json({ error: "copy_limit_exceeded", file_count: totalFiles, limit: 200 }, 413);
        }

        const { data: ws } = await svc.from("workspaces").select("storage_used_bytes, storage_quota_bytes").eq("id", contaId).single();
        if (ws && ws.storage_quota_bytes > 0 && (ws.storage_used_bytes + totalBytes) > ws.storage_quota_bytes) {
          return json({ error: "quota_exceeded", used: ws.storage_used_bytes, quota: ws.storage_quota_bytes, copy_bytes: totalBytes }, 413);
        }

        let copiedCount = 0;
        let failedCount = 0;

        async function copyFolderRecursive(srcId: number, destParentId: number | null, depth: number): Promise<void> {
          if (depth > 10) {
            console.error(`[copy] Depth limit exceeded for folder ${srcId}`);
            return;
          }

          const { data: srcFolder } = await svc.from("folders").select("name").eq("id", srcId).single();
          if (!srcFolder) return;

          const { data: newFolder } = await svc.from("folders").insert({
            conta_id: contaId,
            parent_id: destParentId,
            name: srcFolder.name,
            source: "user",
          }).select().single();
          if (!newFolder) return;

          const { data: files } = await svc.from("files").select("*").eq("folder_id", srcId).eq("conta_id", contaId);
          for (const f of (files ?? [])) {
            const newR2Key = `${contaId}/${crypto.randomUUID()}-${f.name}`;
            let newThumbKey: string | null = null;

            try {
              await copyObject(f.r2_key, newR2Key);
              if (f.thumbnail_r2_key) {
                newThumbKey = `${contaId}/thumb-${crypto.randomUUID()}-${f.name}`;
                await copyObject(f.thumbnail_r2_key, newThumbKey);
              }

              await svc.from("files").insert({
                conta_id: contaId,
                folder_id: newFolder.id,
                r2_key: newR2Key,
                thumbnail_r2_key: newThumbKey,
                name: f.name,
                kind: f.kind,
                mime_type: f.mime_type,
                size_bytes: f.size_bytes,
                width: f.width,
                height: f.height,
                duration_seconds: f.duration_seconds,
                blur_data_url: f.blur_data_url,
                uploaded_by: user.id,
                reference_count: 0,
              });
              copiedCount++;
            } catch (err) {
              console.error(`[copy] Failed to copy file ${f.id}:`, err);
              failedCount++;
            }
          }

          const { data: subfolders } = await svc.from("folders").select("id").eq("parent_id", srcId).eq("conta_id", contaId);
          for (const sub of (subfolders ?? [])) {
            await copyFolderRecursive(sub.id, newFolder.id, depth + 1);
          }
        }

        await copyFolderRecursive(folderId, destination_folder_id ?? null, 0);

        if (copiedCount > 0) {
          await svc.from("workspaces").update({ storage_used_bytes: (ws?.storage_used_bytes ?? 0) + totalBytes }).eq("id", contaId);
        }

        await insertAuditLog(svc, {
          conta_id: contaId,
          actor_user_id: user.id,
          action: "copy_folder",
          resource_type: "folder",
          resource_id: String(folderId),
          metadata: { destination_folder_id, copied: copiedCount, failed: failedCount },
        });

        return json({ ok: true, copied: copiedCount, failed: failedCount }, 201);
      }
    }

    // ─── FILES ────────────────────────────────────────────────────
    if (resource === "files") {
      // GET /files/:id/url → return a signed URL for the file
      if (req.method === "GET" && idStr) {
        if (subResource === "url") {
          const fileId = Number(idStr);
          const { data: file } = await svc.from("files").select("conta_id, r2_key").eq("id", fileId).single();
          if (!file || file.conta_id !== contaId) return json({ error: "File not found" }, 404);
          const signedUrl = await deps.signUrl(file.r2_key);
          return json({ url: signedUrl });
        }
      }

      // POST /files/:id/copy → copy a file to a destination folder
      if (req.method === "POST" && idStr && subResource === "copy") {
        const fileId = Number(idStr);
        const body = await req.json().catch(() => ({}));
        const { destination_folder_id } = body as { destination_folder_id?: number | null };

        const { data: source } = await svc.from("files").select("*").eq("id", fileId).single();
        if (!source || source.conta_id !== contaId) return json({ error: "File not found" }, 404);

        if (destination_folder_id !== null && destination_folder_id !== undefined) {
          const { data: destFolder } = await svc.from("folders").select("conta_id").eq("id", destination_folder_id).single();
          if (!destFolder || destFolder.conta_id !== contaId) return json({ error: "Destination not found" }, 404);
        }

        const { data: ws } = await svc.from("workspaces").select("storage_used_bytes, storage_quota_bytes").eq("id", contaId).single();
        if (ws && ws.storage_quota_bytes > 0 && (ws.storage_used_bytes + source.size_bytes) > ws.storage_quota_bytes) {
          return json({ error: "quota_exceeded", used: ws.storage_used_bytes, quota: ws.storage_quota_bytes, copy_bytes: source.size_bytes }, 413);
        }

        const newR2Key = `${contaId}/${crypto.randomUUID()}-${source.name}`;
        let newThumbKey: string | null = null;

        try {
          await copyObject(source.r2_key, newR2Key);
          if (source.thumbnail_r2_key) {
            newThumbKey = `${contaId}/thumb-${crypto.randomUUID()}-${source.name}`;
            await copyObject(source.thumbnail_r2_key, newThumbKey);
          }
        } catch {
          return json({ error: "R2 copy failed" }, 500);
        }

        const { data: newFile, error: insertErr } = await svc.from("files").insert({
          conta_id: contaId,
          folder_id: destination_folder_id ?? null,
          r2_key: newR2Key,
          thumbnail_r2_key: newThumbKey,
          name: source.name,
          kind: source.kind,
          mime_type: source.mime_type,
          size_bytes: source.size_bytes,
          width: source.width,
          height: source.height,
          duration_seconds: source.duration_seconds,
          blur_data_url: source.blur_data_url,
          uploaded_by: user.id,
          reference_count: 0,
        }).select().single();

        if (insertErr) return json({ error: insertErr.message }, 500);

        await svc.from("workspaces").update({ storage_used_bytes: (ws?.storage_used_bytes ?? 0) + source.size_bytes }).eq("id", contaId);

        await insertAuditLog(svc, {
          conta_id: contaId,
          actor_user_id: user.id,
          action: "copy_file",
          resource_type: "file",
          resource_id: String(newFile.id),
          metadata: { source_file_id: fileId, destination_folder_id },
        });

        return json(newFile, 201);
      }

      // PATCH /files/:id → rename, move, or update blur_data_url
      if (req.method === "PATCH" && idStr) {
        const fileId = Number(idStr);
        const { data: file } = await svc.from("files").select("conta_id").eq("id", fileId).single();
        if (!file || file.conta_id !== contaId) return json({ error: "File not found" }, 404);

        const body = await req.json().catch(() => ({}));
        const patch: Record<string, unknown> = {};
        if (typeof body.name === "string") patch.name = body.name;
        if (body.folder_id !== undefined) patch.folder_id = body.folder_id;
        if (typeof body.blur_data_url === "string") patch.blur_data_url = body.blur_data_url;

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

    // ─── BULK-MOVE ────────────────────────────────────────────────
    if (resource === "bulk-move" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const { file_ids, folder_ids, destination_id } = body as {
        file_ids?: number[];
        folder_ids?: number[];
        destination_id?: number | null;
      };

      if ((!file_ids || file_ids.length === 0) && (!folder_ids || folder_ids.length === 0)) {
        return json({ error: "No items to move" }, 400);
      }

      const { data: result, error: rpcError } = await svc.rpc("bulk_move_items", {
        p_conta_id: contaId,
        p_file_ids: file_ids ?? [],
        p_folder_ids: folder_ids ?? [],
        p_destination_id: destination_id ?? null,
      });

      if (rpcError) return json({ error: rpcError.message }, 500);
      if (result?.error) return json(result, 400);

      await insertAuditLog(svc, {
        conta_id: contaId,
        actor_user_id: user.id,
        action: "bulk_move",
        resource_type: "files_and_folders",
        metadata: { file_ids, folder_ids, destination_id, result },
      });

      return json(result);
    }

    // ─── BULK-DELETE ──────────────────────────────────────────────
    if (resource === "bulk-delete" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const { file_ids, folder_ids } = body as { file_ids?: number[]; folder_ids?: number[] };

      if ((!file_ids || file_ids.length === 0) && (!folder_ids || folder_ids.length === 0)) {
        return json({ error: "No items to delete" }, 400);
      }

      const blocked: { id: number; type: string; reason: string }[] = [];
      const deletableFileIds: number[] = [];
      const deletableFolderIds: number[] = [];

      if (file_ids && file_ids.length > 0) {
        const { data: files } = await svc
          .from("files")
          .select("id, reference_count, size_bytes")
          .eq("conta_id", contaId)
          .in("id", file_ids);

        for (const f of files ?? []) {
          if (f.reference_count > 0) {
            blocked.push({ id: f.id, type: "file", reason: "file_in_use" });
          } else {
            deletableFileIds.push(f.id);
          }
        }

        const foundIds = new Set((files ?? []).map((f: { id: number }) => f.id));
        for (const id of file_ids) {
          if (!foundIds.has(id)) blocked.push({ id, type: "file", reason: "not_found" });
        }
      }

      if (folder_ids && folder_ids.length > 0) {
        const { data: folders } = await svc
          .from("folders")
          .select("id, source")
          .eq("conta_id", contaId)
          .in("id", folder_ids);

        for (const f of folders ?? []) {
          if (f.source === "system") {
            blocked.push({ id: f.id, type: "folder", reason: "system_folder" });
          } else {
            deletableFolderIds.push(f.id);
          }
        }

        const foundIds = new Set((folders ?? []).map((f: { id: number }) => f.id));
        for (const id of folder_ids) {
          if (!foundIds.has(id)) blocked.push({ id, type: "folder", reason: "not_found" });
        }
      }

      if (blocked.length > 0) {
        return json({ blocked, deletable: { file_ids: deletableFileIds, folder_ids: deletableFolderIds } }, 409);
      }

      let totalBytesFreed = 0;
      if (deletableFileIds.length > 0) {
        const { data: filesToDelete } = await svc
          .from("files")
          .select("size_bytes")
          .in("id", deletableFileIds);

        totalBytesFreed = (filesToDelete ?? []).reduce((sum: number, f: { size_bytes: number }) => sum + f.size_bytes, 0);

        const { error: delErr } = await svc.from("files").delete().in("id", deletableFileIds);
        if (delErr) return json({ error: delErr.message }, 500);
      }

      if (deletableFolderIds.length > 0) {
        const { error: delErr } = await svc.from("folders").delete().in("id", deletableFolderIds);
        if (delErr) return json({ error: delErr.message }, 500);
      }

      if (totalBytesFreed > 0) {
        await svc.rpc("decrement_storage", { p_conta_id: contaId, p_bytes: totalBytesFreed }).catch(() => {});
      }

      await insertAuditLog(svc, {
        conta_id: contaId,
        actor_user_id: user.id,
        action: "bulk_delete",
        resource_type: "files_and_folders",
        metadata: { file_ids: deletableFileIds, folder_ids: deletableFolderIds, bytes_freed: totalBytesFreed },
      });

      return json({ ok: true, files_deleted: deletableFileIds.length, folders_deleted: deletableFolderIds.length });
    }

    return json({ error: "Not found" }, 404);
  };
}
