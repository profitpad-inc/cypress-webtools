WITH p AS (SELECT convert_from(decode($1, 'base64'), 'UTF8')::jsonb AS j)
SELECT json_build_object(
  'settings', (SELECT row_to_json(s) FROM cypress_rr_settings s WHERE s.id = 1),
  'reps', COALESCE((SELECT json_agg(r ORDER BY r.position, r.id) FROM cypress_rr_reps r), '[]'::json),
  'recent', (
    SELECT row_to_json(b) FROM cypress_rr_visits b
    WHERE p.j->>'email' <> '' AND b.email = p.j->>'email' AND b.rep_id IS NOT NULL AND b.created_at > now() - interval '1 day'
    ORDER BY b.created_at DESC LIMIT 1
  )
) AS body
FROM p;
