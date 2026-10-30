WITH p AS (SELECT convert_from(decode($1, 'base64'), 'UTF8')::jsonb AS j),
added AS (
  INSERT INTO cypress_rr_reps (hs_owner_id, hs_user_id, name, email, meeting_link, enabled, position)
  SELECT j->>'hs_owner_id', j->>'hs_user_id', COALESCE(j->>'name', ''), COALESCE(j->>'email', ''),
    COALESCE(j->>'meeting_link', ''), COALESCE((j->>'enabled')::boolean, true),
    COALESCE((SELECT max(position) FROM cypress_rr_reps), 0) + 1
  FROM p WHERE j->>'action' = 'add'
  ON CONFLICT (hs_owner_id) DO NOTHING
  RETURNING id
),
changed AS (
  UPDATE cypress_rr_reps r SET
    meeting_link = CASE WHEN p.j ? 'meeting_link' THEN COALESCE(p.j->>'meeting_link', '') ELSE r.meeting_link END,
    enabled = CASE WHEN p.j ? 'enabled' THEN (p.j->>'enabled')::boolean ELSE r.enabled END,
    away_from = CASE WHEN p.j ? 'away_from' THEN NULLIF(p.j->>'away_from', '')::timestamptz ELSE r.away_from END,
    away_until = CASE WHEN p.j ? 'away_until' THEN NULLIF(p.j->>'away_until', '')::timestamptz ELSE r.away_until END,
    away_reason = CASE WHEN p.j ? 'away_reason' THEN COALESCE(p.j->>'away_reason', '') ELSE r.away_reason END,
    boost_remaining = CASE WHEN p.j ? 'boost_remaining' THEN (p.j->>'boost_remaining')::int ELSE r.boost_remaining END,
    updated_at = now()
  FROM p WHERE p.j->>'action' = 'update' AND r.id = (p.j->>'id')::int
  RETURNING r.id
),
removed AS (
  DELETE FROM cypress_rr_reps r USING p
  WHERE p.j->>'action' = 'remove' AND r.id = (p.j->>'id')::int
  RETURNING r.id
),
ordered AS (
  UPDATE cypress_rr_reps r SET position = o.ord, updated_at = now()
  FROM p, jsonb_array_elements_text(CASE WHEN p.j->>'action' = 'order' THEN p.j->'order' ELSE '[]'::jsonb END) WITH ORDINALITY AS o(id, ord)
  WHERE r.id = o.id::int
  RETURNING r.id
)
SELECT
  (SELECT count(*) FROM added) AS added,
  (SELECT count(*) FROM changed) + (SELECT count(*) FROM removed) + (SELECT count(*) FROM ordered) AS changed;
