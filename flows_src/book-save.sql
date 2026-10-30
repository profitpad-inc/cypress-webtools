WITH p AS (SELECT convert_from(decode($1, 'base64'), 'UTF8')::jsonb AS j),
ins AS (
  INSERT INTO cypress_rr_bookings (email, contact_id, contact_name, owner_id, rep_id, rep_name, url, route, reason, skipped)
  SELECT COALESCE(j->>'email', ''), j->>'contact_id', COALESCE(j->>'contact_name', ''), j->>'owner_id',
    NULLIF(j->>'rep_id', '')::int, COALESCE(j->>'rep_name', ''), COALESCE(j->>'url', ''), j->>'route',
    COALESCE(j->>'reason', ''), COALESCE(j->'skipped', '[]'::jsonb)
  FROM p
  RETURNING id
),
-- Only logs the visit. The rotation and boosts move only when rr-assign really assigns a lead (2026-10-30, on request:
-- "only progress to the next person in the rotation if the lead actually got assigned").
SELECT (SELECT count(*) FROM ins) AS saved;
