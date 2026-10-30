WITH p AS (SELECT convert_from(decode($1, 'base64'), 'UTF8')::jsonb AS j)
UPDATE cypress_rr_settings s SET
  paused = CASE WHEN p.j ? 'paused' THEN (p.j->>'paused')::boolean ELSE s.paused END,
  paused_until = CASE WHEN p.j ? 'paused_until' THEN NULLIF(p.j->>'paused_until', '')::timestamptz ELSE s.paused_until END,
  pause_reason = CASE WHEN p.j ? 'pause_reason' THEN COALESCE(p.j->>'pause_reason', '') ELSE s.pause_reason END,
  skip_if_owned = CASE WHEN p.j ? 'skip_if_owned' THEN (p.j->>'skip_if_owned')::boolean ELSE s.skip_if_owned END,
  updated_at = now()
FROM p WHERE s.id = 1
RETURNING s.id AS changed;
