WITH p AS (SELECT convert_from(decode($1, 'base64'), 'UTF8')::jsonb AS j),
b AS (
  SELECT ((j->>'from')::date)::timestamp AT TIME ZONE (j->>'tz') AS t0,
    (((j->>'to')::date + 1)::timestamp) AT TIME ZONE (j->>'tz') AS t1
  FROM p
)
SELECT json_build_object(
  -- every lead in the period (from the list or booked through the booking link), with its later owner changes
  'leads', COALESCE((
    SELECT json_agg(x ORDER BY x.created_at DESC) FROM (
      SELECT l.*, v.route AS visit_route, COALESCE((
        SELECT json_agg(o ORDER BY o.changed_at) FROM cypress_rr_owner_changes o WHERE o.lead_id = l.id
      ), '[]'::json) AS changes
      FROM cypress_rr_leads l LEFT JOIN cypress_rr_visits v ON v.id = l.visit_id, b
      WHERE l.created_at >= b.t0 AND l.created_at < b.t1
    ) x
  ), '[]'::json),
  -- every owner change in the period, with the lead it belongs to
  'owner_changes', COALESCE((
    SELECT json_agg(y ORDER BY y.changed_at DESC) FROM (
      SELECT o.*, l.source, l.contact_name, l.contact_email, l.owner_id AS lead_owner_id, l.rep_name AS lead_rep_name,
        l.created_at AS lead_at
      FROM cypress_rr_owner_changes o JOIN cypress_rr_leads l ON l.id = o.lead_id, b
      WHERE o.changed_at >= b.t0 AND o.changed_at < b.t1
    ) y
  ), '[]'::json),
  -- booking link visits in the period; a booked one carries its lead (id, contact, owner, when counted, changes)
  'visits', COALESCE((
    SELECT json_agg(z ORDER BY z.created_at DESC) FROM (
      SELECT v.*, l.id AS lead_id, l.contact_id AS lead_contact_id, l.contact_name AS lead_contact_name, l.owner_id AS lead_owner_id,
        l.detected_at AS booked_at, COALESCE((
          SELECT json_agg(o ORDER BY o.changed_at) FROM cypress_rr_owner_changes o WHERE o.lead_id = l.id
        ), '[]'::json) AS changes
      FROM cypress_rr_visits v LEFT JOIN cypress_rr_leads l ON l.visit_id = v.id, b
      WHERE v.created_at >= b.t0 AND v.created_at < b.t1
    ) z
  ), '[]'::json),
  'reps', COALESCE((SELECT json_agg(r ORDER BY r.position, r.id) FROM cypress_rr_reps r), '[]'::json),
  'settings', (SELECT row_to_json(s) FROM cypress_rr_settings s WHERE s.id = 1)
) AS body;
