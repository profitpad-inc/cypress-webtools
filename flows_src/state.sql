SELECT json_build_object(
  'reps', COALESCE((SELECT json_agg(r ORDER BY r.position, r.id) FROM cypress_rr_reps r), '[]'::json),
  'settings', (SELECT row_to_json(s) FROM cypress_rr_settings s WHERE s.id = 1),
  'now', now()
) AS body;
