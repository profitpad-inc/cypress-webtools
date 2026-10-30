SELECT json_build_object('rows', COALESCE(json_agg(x), '[]'::json), 'ids', COALESCE(string_agg(x.contact_id, ','), '')) AS body
FROM (
  SELECT DISTINCT ON (a.contact_id) a.id, a.contact_id, a.owner_id, a.created_at
  FROM cypress_rr_assignments a
  WHERE a.created_at > now() - interval '30 days' AND a.status IN ('assigned', 'kept_existing') AND a.owner_id IS NOT NULL
  ORDER BY a.contact_id, a.created_at DESC
) x;
