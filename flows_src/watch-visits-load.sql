-- Booking link visits that may have turned into a booking: sent to the rotation or a boosted rep in the last 2 days,
-- not a lead yet, and their email isn't already an assigned lead (from the list or an earlier booking).
SELECT json_build_object('rows', COALESCE(json_agg(x ORDER BY x.created_at), '[]'::json),
  'emails', COALESCE(string_agg(DISTINCT x.email, ','), '')) AS body
FROM (
  SELECT v.id, v.email, v.owner_id AS previous_owner_id, v.rep_id, v.rep_name, v.route, v.created_at, r.hs_owner_id
  FROM cypress_rr_visits v JOIN cypress_rr_reps r ON r.id = v.rep_id
  WHERE v.created_at > now() - interval '2 days' AND v.route IN ('rotation', 'boost') AND v.email <> ''
    AND NOT EXISTS (SELECT 1 FROM cypress_rr_leads l WHERE l.visit_id = v.id)
    AND NOT EXISTS (SELECT 1 FROM cypress_rr_leads l WHERE lower(l.contact_email) = v.email AND l.status = 'assigned')
) x;
