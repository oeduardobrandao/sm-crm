-- =====================================================================
-- 20260925000015_post_status_events_send_snapshot_backfill.sql
-- 20260925000011 added snapshot_conteudo_plain / snapshot_ig_caption to
-- post_status_events but only fills them for sends made AFTER it shipped, so
-- the Hub history cannot show "what the client saw" for older sends.
--
-- Backfill from post_content_versions (20260923000001), which holds the full
-- content after every save. For each "sent to client" event with no snapshot:
--   1. use the latest version row whose last_touched_at is at or before the
--      send: that is the content as it stood when the client was sent it. A
--      status change breaks version coalescing (see record_post_content_version),
--      so no row can straddle a send;
--   2. otherwise, if the post has a baseline row (changed_fields = '{}', the
--      pre-first-edit state, dated at or after the send by the ordering fix in
--      20260923000005) and the send happened before the first real edit, use
--      that baseline: nothing changed the content between the send and it.
-- Anything else stays NULL: an honest "unknown" beats a guess. Rows that
-- already carry a snapshot are never touched, and the statement is idempotent.
-- Best effort by nature: versions are written by a best-effort trigger, so a
-- missed version row can make a backfilled snapshot slightly stale.
-- =====================================================================

with picked as (
  select
    e.id as event_id,
    coalesce(a.id, b.id) as version_id
  from post_status_events e
  left join lateral (
    select v.id
    from post_content_versions v
    where v.post_id = e.post_id
      and v.last_touched_at <= e.created_at
    order by v.last_touched_at desc, v.id desc
    limit 1
  ) a on true
  left join lateral (
    select v.id
    from post_content_versions v
    where v.post_id = e.post_id
      and cardinality(v.changed_fields) = 0
      and e.created_at < coalesce(
        (select min(n.created_at)
           from post_content_versions n
          where n.post_id = v.post_id and n.id <> v.id),
        'infinity'::timestamptz
      )
    order by v.created_at, v.id
    limit 1
  ) b on a.id is null
  where e.to_status = 'enviado_cliente'
    and e.snapshot_conteudo_plain is null
    and e.snapshot_ig_caption is null
)
update post_status_events e
   set snapshot_conteudo_plain = v.conteudo_plain,
       snapshot_ig_caption     = v.ig_caption
  from picked p
  join post_content_versions v on v.id = p.version_id
 where e.id = p.event_id
   and (v.conteudo_plain is not null or v.ig_caption is not null);
