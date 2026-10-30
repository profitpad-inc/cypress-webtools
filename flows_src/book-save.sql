-- Only logs the visit in cypress_rr_visits. The rotation and boosts move only when a lead is counted (a list lead
-- rr-assign assigns, or this visit turning into a booking; the cypress_rr_lead_counted trigger), 2026-10-30 on request:
-- only progress to the next person in the rotation if the lead actually got assigned.
-- No comma after the last CTE: a stray one left when the pointer update was removed made every save fail (2026-10-30).
WITH p AS (SELECT convert_from(decode($1, 'base64'), 'UTF8')::jsonb AS j),
ins AS (
  INSERT INTO cypress_rr_visits (email, contact_id, contact_name, owner_id, rep_id, rep_name, url, route, reason, skipped)
  SELECT COALESCE(j->>'email', ''), j->>'contact_id', COALESCE(j->>'contact_name', ''), j->>'owner_id',
    NULLIF(j->>'rep_id', '')::int, COALESCE(j->>'rep_name', ''), COALESCE(j->>'url', ''), j->>'route',
    COALESCE(j->>'reason', ''), COALESCE(j->'skipped', '[]'::jsonb)
  FROM p
  RETURNING id
)
SELECT (SELECT count(*) FROM ins) AS saved;
