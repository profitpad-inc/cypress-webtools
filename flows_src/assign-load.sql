SELECT json_build_object(
  'settings', (SELECT row_to_json(s) FROM cypress_rr_settings s WHERE s.id = 1),
  'reps', COALESCE((SELECT json_agg(r ORDER BY r.position, r.id) FROM cypress_rr_reps r), '[]'::json),
  'recent', COALESCE((
    SELECT json_agg(DISTINCT a.contact_id) FROM cypress_rr_leads a, cypress_rr_settings s
    WHERE s.id = 1 AND a.source = 'list' AND a.joined_list_at >= COALESCE(s.list_last_join_at, now()) - interval '1 day'
  ), '[]'::json),
  -- contacts that are already a lead through a booking (last 30 days): joining the list later isn't a second lead
  'booked', COALESCE((
    SELECT json_agg(DISTINCT l.contact_id) FROM cypress_rr_leads l
    WHERE l.source = 'booking' AND l.created_at > now() - interval '30 days'
  ), '[]'::json)
) AS body;
