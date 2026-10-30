-- Each booked visit becomes a lead (source 'booking', at the visit's time). The cypress_rr_lead_counted trigger then
-- counts it like a list lead: a boosted one uses a boosted lead, any other moves the rotation to its rep unless an
-- assigned lead from later is already in. Oldest first, so the latest booking ends up as the pointer.
WITH p AS (SELECT convert_from(decode($1, 'base64'), 'UTF8')::jsonb AS j),
ins AS (
  INSERT INTO cypress_rr_leads (source, contact_id, contact_name, contact_email, visit_id, previous_owner_id, owner_id,
    rep_id, rep_name, status, boosted, reason, created_at)
  SELECT 'booking', x->>'contact_id', COALESCE(x->>'contact_name', ''), x->>'email', (x->>'visit_id')::bigint,
    x->>'previous_owner_id', x->>'owner_id', (x->>'rep_id')::int, COALESCE(x->>'rep_name', ''), 'assigned',
    COALESCE((x->>'boosted')::boolean, false),
    'Booked a meeting with ' || COALESCE(x->>'rep_name', 'their rep') || ' through the booking link.',
    (x->>'visited_at')::timestamptz
  FROM p, jsonb_array_elements(p.j->'rows') x
  ORDER BY (x->>'visited_at')::timestamptz
  ON CONFLICT (visit_id) DO NOTHING
  RETURNING id
)
SELECT count(*) AS booked FROM ins;
