WITH p AS (SELECT convert_from(decode($1, 'base64'), 'UTF8')::jsonb AS j),
ins AS (
  INSERT INTO cypress_rr_owner_changes (lead_id, contact_id, from_owner_id, to_owner_id, source_type, source_id,
    source_label, changed_by_user_id, changed_at)
  SELECT (x->>'lead_id')::bigint, x->>'contact_id', x->>'from_owner_id', x->>'to_owner_id',
    COALESCE(x->>'source_type', ''), COALESCE(x->>'source_id', ''), COALESCE(x->>'source_label', ''),
    x->>'changed_by_user_id', (x->>'changed_at')::timestamptz
  FROM p, jsonb_array_elements(p.j->'rows') x
  ON CONFLICT (lead_id, changed_at) DO NOTHING
  RETURNING id
),
-- names as HubSpot has them now, on every lead of that contact
ren AS (
  UPDATE cypress_rr_leads l SET contact_name = x->>'name'
  FROM p, jsonb_array_elements(p.j->'renames') x
  WHERE l.contact_id = x->>'contact_id' AND l.contact_name IS DISTINCT FROM x->>'name'
  RETURNING l.id
)
SELECT (SELECT count(*) FROM ins) AS inserted, (SELECT count(*) FROM ren) AS renamed;
