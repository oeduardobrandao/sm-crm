-- =============================================
-- Workspace Logo Upload: Storage + RLS
-- =============================================

-- Allow authenticated workspace owners/admins to upload logos
-- Path pattern: workspaces/{workspace_id}/logo.*
create policy "workspace_logo_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = 'workspaces'
    AND (storage.foldername(name))[2]::uuid IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

create policy "workspace_logo_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = 'workspaces'
    AND (storage.foldername(name))[2]::uuid IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- Allow admins (not just owners) to update workspace name/logo_url
DROP POLICY "ws_update_owner" ON workspaces;
CREATE POLICY "ws_update_owner_admin" ON workspaces
  FOR UPDATE USING (
    id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );
