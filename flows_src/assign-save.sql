WITH p AS (SELECT convert_from(decode($1, 'base64'), 'UTF8')::jsonb AS j),
ins AS (
  -- the cypress_rr_lead_counted trigger moves the rotation and uses boosts for assigned rows, in this order
  INSERT INTO cypress_rr_leads (source, contact_id, contact_name, contact_email, joined_list_at, previous_owner_id,
    owner_id, rep_id, rep_name, status, reason, skipped, boosted)
  SELECT 'list', x->>'contact_id', COALESCE(x->>'contact_name', ''), COALESCE(x->>'contact_email', ''),
    NULLIF(x->>'joined_list_at', '')::timestamptz, x->>'previous_owner_id', x->>'owner_id',
    NULLIF(x->>'rep_id', '')::int, COALESCE(x->>'rep_name', ''), x->>'status', COALESCE(x->>'reason', ''),
    COALESCE(x->'skipped', '[]'::jsonb), COALESCE((x->>'boosted')::boolean, false)
  FROM p, jsonb_array_elements(p.j->'rows') WITH ORDINALITY AS e(x, n)
  ORDER BY e.n
  ON CONFLICT (contact_id, joined_list_at) DO NOTHING
  RETURNING id
),
st AS (
  UPDATE cypress_rr_settings s SET
    list_last_join_at = COALESCE(NULLIF(p.j->'cursor'->>'list_last_join_at', '')::timestamptz, s.list_last_join_at),
    list_initialized = true,
    last_poll_at = now(),
    last_poll_error = COALESCE(p.j->>'error', '')
  FROM p WHERE s.id = 1
  RETURNING s.id
)
SELECT (SELECT count(*) FROM ins) AS inserted, (SELECT count(*) FROM st) AS settings_updated;
