WITH p AS (SELECT convert_from(decode($1, 'base64'), 'UTF8')::jsonb AS j),
b AS (
  SELECT ((j->>'from')::date)::timestamp AT TIME ZONE (j->>'tz') AS t0,
    (((j->>'to')::date + 1)::timestamp) AT TIME ZONE (j->>'tz') AS t1
  FROM p
)
SELECT json_build_object(
  'assignments', COALESCE((
    SELECT json_agg(x ORDER BY x.created_at DESC) FROM (
      SELECT a.*, COALESCE((
        SELECT json_agg(o ORDER BY o.changed_at) FROM cypress_rr_overwrites o WHERE o.assignment_id = a.id
      ), '[]'::json) AS overwrites
      FROM cypress_rr_assignments a, b
      WHERE a.created_at >= b.t0 AND a.created_at < b.t1
    ) x
  ), '[]'::json),
  'overwrites', COALESCE((
    SELECT json_agg(y ORDER BY y.changed_at DESC) FROM (
      SELECT o.*, a.contact_name, a.contact_email, a.owner_id AS assigned_owner_id, a.rep_name AS assigned_rep_name,
        a.created_at AS assigned_at
      FROM cypress_rr_overwrites o JOIN cypress_rr_assignments a ON a.id = o.assignment_id, b
      WHERE o.changed_at >= b.t0 AND o.changed_at < b.t1
    ) y
  ), '[]'::json),
  'bookings', COALESCE((
    SELECT json_agg(k ORDER BY k.created_at DESC) FROM cypress_rr_bookings k, b
    WHERE k.created_at >= b.t0 AND k.created_at < b.t1
  ), '[]'::json),
  'reps', COALESCE((SELECT json_agg(r ORDER BY r.position, r.id) FROM cypress_rr_reps r), '[]'::json),
  'settings', (SELECT row_to_json(s) FROM cypress_rr_settings s WHERE s.id = 1)
) AS body;
