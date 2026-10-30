-- Creates the Cypress round robin tables in demo_db and seeds them from the Zapier "Round Robin" table. Safe to rerun.
CREATE TABLE IF NOT EXISTS cypress_rr_reps (
  id serial PRIMARY KEY,
  hs_owner_id text NOT NULL UNIQUE,
  hs_user_id text,
  name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  meeting_link text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  away_from timestamptz,
  away_until timestamptz,
  away_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cypress_rr_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  paused boolean NOT NULL DEFAULT false,
  paused_until timestamptz,
  pause_reason text NOT NULL DEFAULT '',
  skip_if_owned boolean NOT NULL DEFAULT true,
  last_rep_id integer,
  last_position integer,
  list_id text NOT NULL DEFAULT '378',
  list_after text,
  list_last_join_at timestamptz,
  list_initialized boolean NOT NULL DEFAULT false,
  last_poll_at timestamptz,
  last_poll_error text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Tables reworked 2026-10-30 (on request, demo phase): one table of leads whatever their source, the booking link's
-- visit log, and owner changes per lead. The rotation and boosts move in one place, the cypress_rr_lead_counted
-- trigger, for leads from the list (rr-assign) and booked visits (rr-watch-overwrites) alike.
ALTER TABLE cypress_rr_reps ADD COLUMN IF NOT EXISTS boost_remaining integer NOT NULL DEFAULT 0;
-- visits to the universal booking link and where each was sent (log only; a booked visit has a lead pointing at it)
CREATE TABLE IF NOT EXISTS cypress_rr_visits (
  id bigserial PRIMARY KEY,
  email text NOT NULL DEFAULT '',
  contact_id text,
  contact_name text NOT NULL DEFAULT '',
  owner_id text,
  rep_id integer,
  rep_name text NOT NULL DEFAULT '',
  url text NOT NULL DEFAULT '',
  route text NOT NULL,
  reason text NOT NULL DEFAULT '',
  skipped jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cypress_rr_visits_created ON cypress_rr_visits (created_at);
CREATE INDEX IF NOT EXISTS cypress_rr_visits_email ON cypress_rr_visits (email, created_at);
-- every lead the tool handled: source 'list' (joined the HubSpot list; rr-assign) or 'booking' (a booking link visitor
-- who became a contact owned by the rep they were sent to; rr-watch-overwrites). created_at is when the lead happened
-- (for a booking, the visit), detected_at when the tool recorded it.
CREATE TABLE IF NOT EXISTS cypress_rr_leads (
  id bigserial PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('list', 'booking')),
  contact_id text NOT NULL,
  contact_name text NOT NULL DEFAULT '',
  contact_email text NOT NULL DEFAULT '',
  joined_list_at timestamptz,
  visit_id bigint UNIQUE REFERENCES cypress_rr_visits (id) ON DELETE CASCADE,
  previous_owner_id text,
  owner_id text,
  rep_id integer,
  rep_name text NOT NULL DEFAULT '',
  status text NOT NULL,
  boosted boolean NOT NULL DEFAULT false,
  reason text NOT NULL DEFAULT '',
  skipped jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  detected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contact_id, joined_list_at)
);
CREATE INDEX IF NOT EXISTS cypress_rr_leads_created ON cypress_rr_leads (created_at);
CREATE INDEX IF NOT EXISTS cypress_rr_leads_email ON cypress_rr_leads (lower(contact_email));
-- owner changes made after the tool gave a lead to a rep (kept, only recorded)
CREATE TABLE IF NOT EXISTS cypress_rr_owner_changes (
  id bigserial PRIMARY KEY,
  lead_id bigint NOT NULL REFERENCES cypress_rr_leads (id) ON DELETE CASCADE,
  contact_id text NOT NULL,
  from_owner_id text,
  to_owner_id text,
  source_type text NOT NULL DEFAULT '',
  source_id text NOT NULL DEFAULT '',
  source_label text NOT NULL DEFAULT '',
  changed_by_user_id text,
  changed_at timestamptz NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, changed_at)
);
CREATE INDEX IF NOT EXISTS cypress_rr_owner_changes_changed ON cypress_rr_owner_changes (changed_at);
-- One-time move from the first tables (cypress_rr_assignments, cypress_rr_bookings, cypress_rr_overwrites), kept
-- afterwards as *_old. Visit and list lead ids are kept. Runs before the trigger exists, so it moves no rotation.
DO $$
BEGIN
  IF to_regclass('cypress_rr_bookings') IS NOT NULL THEN
    INSERT INTO cypress_rr_visits (id, email, contact_id, contact_name, owner_id, rep_id, rep_name, url, route, reason, skipped, created_at)
    SELECT id, email, contact_id, contact_name, owner_id, rep_id, rep_name, url, route, reason, skipped, created_at
    FROM cypress_rr_bookings
    ON CONFLICT (id) DO NOTHING;
    PERFORM setval(pg_get_serial_sequence('cypress_rr_visits', 'id'), GREATEST((SELECT max(id) FROM cypress_rr_visits), 1));
  END IF;
  IF to_regclass('cypress_rr_assignments') IS NOT NULL THEN
    INSERT INTO cypress_rr_leads (id, source, contact_id, contact_name, contact_email, joined_list_at, previous_owner_id,
      owner_id, rep_id, rep_name, status, boosted, reason, skipped, created_at, detected_at)
    SELECT id, 'list', contact_id, contact_name, contact_email, joined_list_at, previous_owner_id, owner_id, rep_id,
      rep_name, status, boosted, reason, skipped, created_at, created_at
    FROM cypress_rr_assignments
    ON CONFLICT DO NOTHING;
    PERFORM setval(pg_get_serial_sequence('cypress_rr_leads', 'id'), GREATEST((SELECT max(id) FROM cypress_rr_leads), 1));
  END IF;
  IF to_regclass('cypress_rr_bookings') IS NOT NULL THEN
    INSERT INTO cypress_rr_leads (source, contact_id, contact_name, contact_email, visit_id, previous_owner_id, owner_id,
      rep_id, rep_name, status, boosted, reason, created_at, detected_at)
    SELECT 'booking', b.booked_contact_id, b.contact_name, b.email, b.id, b.owner_id, r.hs_owner_id, b.rep_id, b.rep_name,
      'assigned', b.route = 'boost', 'Booked a meeting with ' || b.rep_name || ' through the booking link.', b.created_at, b.booked_at
    FROM cypress_rr_bookings b JOIN cypress_rr_reps r ON r.id = b.rep_id
    WHERE b.booked_at IS NOT NULL AND b.booked_contact_id IS NOT NULL
    ON CONFLICT DO NOTHING;
  END IF;
  IF to_regclass('cypress_rr_overwrites') IS NOT NULL THEN
    INSERT INTO cypress_rr_owner_changes (lead_id, contact_id, from_owner_id, to_owner_id, source_type, source_id,
      source_label, changed_by_user_id, changed_at, detected_at)
    SELECT x.lead_id, o.contact_id, o.from_owner_id, o.to_owner_id, o.source_type, o.source_id, o.source_label,
      o.changed_by_user_id, o.changed_at, o.detected_at
    FROM cypress_rr_overwrites o
      CROSS JOIN LATERAL (SELECT COALESCE(o.assignment_id, (SELECT l.id FROM cypress_rr_leads l WHERE l.visit_id = o.booking_id)) AS lead_id) x
    WHERE x.lead_id IS NOT NULL
    ON CONFLICT DO NOTHING;
    ALTER TABLE cypress_rr_overwrites RENAME TO cypress_rr_overwrites_old;
  END IF;
  IF to_regclass('cypress_rr_bookings') IS NOT NULL THEN
    ALTER TABLE cypress_rr_bookings RENAME TO cypress_rr_bookings_old;
  END IF;
  IF to_regclass('cypress_rr_assignments') IS NOT NULL THEN
    ALTER TABLE cypress_rr_assignments RENAME TO cypress_rr_assignments_old;
  END IF;
END $$;
-- visits logged before the 2026-10-30 rewording of the "nobody available" reason (safe to rerun)
UPDATE cypress_rr_visits
SET reason = replace(reason, ', so nobody in the rotation is available with a meeting link.', ', and nobody in the rotation was available.')
WHERE route = 'none' AND reason LIKE '%, so nobody in the rotation is available with a meeting link.';
-- A new assigned lead counts once, for both sources: a boosted one uses one of its rep's boosted leads; any other moves
-- the rotation pointer to its rep, unless an assigned lead from later is already in (a booking counted after leads
-- that came in since the visit doesn't send the rotation back). Leads saved together count in the order inserted.
CREATE OR REPLACE FUNCTION cypress_rr_lead_counted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'assigned' OR NEW.rep_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF NEW.boosted THEN
    UPDATE cypress_rr_reps SET boost_remaining = GREATEST(boost_remaining - 1, 0), updated_at = now() WHERE id = NEW.rep_id;
  ELSIF NOT EXISTS (
    SELECT 1 FROM cypress_rr_leads l
    WHERE l.status = 'assigned' AND NOT l.boosted AND l.id <> NEW.id AND l.created_at > NEW.created_at
  ) THEN
    UPDATE cypress_rr_settings s SET last_rep_id = NEW.rep_id, last_position = r.position, updated_at = now()
    FROM cypress_rr_reps r WHERE s.id = 1 AND r.id = NEW.rep_id;
  END IF;
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS cypress_rr_lead_counted ON cypress_rr_leads;
CREATE TRIGGER cypress_rr_lead_counted AFTER INSERT ON cypress_rr_leads
  FOR EACH ROW EXECUTE PROCEDURE cypress_rr_lead_counted();
INSERT INTO cypress_rr_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
INSERT INTO cypress_rr_reps (hs_owner_id, name, email, enabled, position) VALUES
  ('78305435', 'Jeff Bauer', 'jeffb@cypressvending.ca', true, 1),
  ('97798186', 'Pat Nicastro', 'patn@cypressvending.ca', true, 2),
  ('481206057', 'Graham Patt', 'grahamp@cypressvending.ca', true, 3),
  ('742548153', 'Matt A', 'matta@cypressvending.ca', true, 4),
  ('78033913', 'Mac Mills', 'mackenziem@cypressvending.ca', false, 5)
ON CONFLICT (hs_owner_id) DO NOTHING;
-- HubSpot's v3 API knows the Zap's legacy list 276 as list 378 (idmapping checked 2026-10-30)
UPDATE cypress_rr_settings SET list_id = '378' WHERE id = 1 AND list_id = '276';
-- the Zap's counter was 4391 (mod 4 = 3, Matt A), so Jeff Bauer is next
UPDATE cypress_rr_settings
SET last_rep_id = (SELECT id FROM cypress_rr_reps WHERE hs_owner_id = '742548153'), last_position = 4
WHERE id = 1 AND last_rep_id IS NULL;
SELECT
  (SELECT count(*) FROM cypress_rr_reps) AS reps,
  (SELECT count(*) FROM cypress_rr_settings) AS settings,
  (SELECT count(*) FROM cypress_rr_leads) AS leads,
  (SELECT count(*) FROM cypress_rr_visits) AS visits,
  (SELECT count(*) FROM cypress_rr_owner_changes) AS owner_changes,
  (SELECT last_rep_id FROM cypress_rr_settings WHERE id = 1) AS last_rep_id,
  (SELECT list_id FROM cypress_rr_settings WHERE id = 1) AS list_id;
