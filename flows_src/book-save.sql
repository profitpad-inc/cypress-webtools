WITH p AS (SELECT convert_from(decode($1, 'base64'), 'UTF8')::jsonb AS j),
ins AS (
  INSERT INTO cypress_rr_bookings (email, contact_id, contact_name, owner_id, rep_id, rep_name, url, route, reason, skipped)
  SELECT COALESCE(j->>'email', ''), j->>'contact_id', COALESCE(j->>'contact_name', ''), j->>'owner_id',
    NULLIF(j->>'rep_id', '')::int, COALESCE(j->>'rep_name', ''), COALESCE(j->>'url', ''), j->>'route',
    COALESCE(j->>'reason', ''), COALESCE(j->'skipped', '[]'::jsonb)
  FROM p
  RETURNING id
),
ptr AS (
  UPDATE cypress_rr_settings s SET last_rep_id = (p.j->>'rep_id')::int, last_position = (p.j->>'rep_position')::int
  FROM p WHERE s.id = 1 AND p.j->>'route' = 'rotation'
  RETURNING s.id
)
SELECT (SELECT count(*) FROM ins) AS saved;
