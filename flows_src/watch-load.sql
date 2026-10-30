-- Leads to watch for later owner changes: the latest per contact in the last 30 days (from the list or a booking),
-- assigned or kept, with the owner the tool gave it and the name stored for it (kept in step with HubSpot).
SELECT json_build_object('rows', COALESCE(json_agg(x), '[]'::json), 'ids', COALESCE(string_agg(x.contact_id, ','), '')) AS body
FROM (
  SELECT DISTINCT ON (l.contact_id) l.id, l.contact_id, l.contact_name, l.owner_id, l.created_at
  FROM cypress_rr_leads l
  WHERE l.created_at > now() - interval '30 days' AND l.status IN ('assigned', 'kept_existing') AND l.owner_id IS NOT NULL
  ORDER BY l.contact_id, l.created_at DESC
) x;
