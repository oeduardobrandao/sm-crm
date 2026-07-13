-- Read-only post-deployment audit for memberships created before
-- 20260713000001_secure_workspace_invites.sql.
--
-- Run in the Supabase SQL editor with elevated read access. Review every row;
-- this script intentionally performs no repair or deletion.

WITH membership_evidence AS (
  SELECT
    wm.id AS membership_id,
    wm.user_id,
    u.email,
    wm.workspace_id,
    w.name AS workspace_name,
    wm.role AS membership_role,
    p.role AS profile_role,
    p.conta_id AS profile_conta_id,
    p.active_workspace_id,
    wm.joined_at,
    matching_invite.id AS invite_id,
    matching_invite.role AS invite_role,
    matching_invite.status AS invite_status,
    matching_invite.accepted_at,
    CASE
      WHEN matching_invite.id IS NULL AND wm.role <> 'owner'
        THEN 'non_owner_without_matching_invite'
      WHEN matching_invite.id IS NOT NULL AND matching_invite.role <> wm.role
        THEN 'membership_role_differs_from_invite'
      WHEN p.role IS DISTINCT FROM wm.role
        THEN 'profile_role_differs_from_membership'
      WHEN p.conta_id IS DISTINCT FROM wm.workspace_id
        THEN 'profile_workspace_differs_from_membership'
      ELSE NULL
    END AS review_reason
  FROM public.workspace_members wm
  JOIN auth.users u ON u.id = wm.user_id
  LEFT JOIN public.profiles p ON p.id = wm.user_id
  LEFT JOIN public.workspaces w ON w.id = wm.workspace_id
  LEFT JOIN LATERAL (
    SELECT i.*
    FROM public.invites i
    WHERE lower(i.email) = lower(u.email)
      AND i.conta_id = wm.workspace_id
      AND i.status = 'accepted'
    ORDER BY i.accepted_at DESC NULLS LAST, i.created_at DESC
    LIMIT 1
  ) matching_invite ON true
)
SELECT *
FROM membership_evidence
WHERE review_reason IS NOT NULL
ORDER BY joined_at DESC;

-- Profiles whose active workspace is not backed by membership no longer pass
-- get_my_conta_id(), but they still need an operator decision and repair.
SELECT
  p.id AS user_id,
  u.email,
  p.conta_id,
  p.active_workspace_id,
  p.role,
  p.created_at
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
LEFT JOIN public.workspace_members wm
  ON wm.user_id = p.id
 AND wm.workspace_id = p.active_workspace_id
WHERE p.active_workspace_id IS NOT NULL
  AND wm.id IS NULL
ORDER BY p.created_at DESC;
