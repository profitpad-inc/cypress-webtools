WITH p AS (SELECT convert_from(decode($1, 'base64'), 'UTF8')::jsonb AS j),
ins AS (
  INSERT INTO cypress_rr_overwrites (assignment_id, contact_id, from_owner_id, to_owner_id, source_type, source_id,
    source_label, changed_by_user_id, changed_at)
  SELECT (x->>'assignment_id')::bigint, x->>'contact_id', x->>'from_owner_id', x->>'to_owner_id',
    COALESCE(x->>'source_type', ''), COALESCE(x->>'source_id', ''), COALESCE(x->>'source_label', ''),
    x->>'changed_by_user_id', (x->>'changed_at')::timestamptz
  FROM p, jsonb_array_elements(p.j->'rows') x
  ON CONFLICT (assignment_id, changed_at) DO NOTHING
  RETURNING id
)
SELECT count(*) AS inserted FROM ins;
