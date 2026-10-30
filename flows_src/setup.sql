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
  list_id text NOT NULL DEFAULT '276',
  list_after text,
  list_last_join_at timestamptz,
  list_initialized boolean NOT NULL DEFAULT false,
  last_poll_at timestamptz,
  last_poll_error text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cypress_rr_assignments (
  id bigserial PRIMARY KEY,
  contact_id text NOT NULL,
  contact_name text NOT NULL DEFAULT '',
  contact_email text NOT NULL DEFAULT '',
  joined_list_at timestamptz,
  previous_owner_id text,
  owner_id text,
  rep_id integer,
  rep_name text NOT NULL DEFAULT '',
  status text NOT NULL,
  reason text NOT NULL DEFAULT '',
  skipped jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contact_id, joined_list_at)
);
CREATE INDEX IF NOT EXISTS cypress_rr_assignments_created ON cypress_rr_assignments (created_at);
CREATE TABLE IF NOT EXISTS cypress_rr_overwrites (
  id bigserial PRIMARY KEY,
  assignment_id bigint NOT NULL REFERENCES cypress_rr_assignments (id) ON DELETE CASCADE,
  contact_id text NOT NULL,
  from_owner_id text,
  to_owner_id text,
  source_type text NOT NULL DEFAULT '',
  source_id text NOT NULL DEFAULT '',
  source_label text NOT NULL DEFAULT '',
  changed_by_user_id text,
  changed_at timestamptz NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, changed_at)
);
CREATE INDEX IF NOT EXISTS cypress_rr_overwrites_changed ON cypress_rr_overwrites (changed_at);
INSERT INTO cypress_rr_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
INSERT INTO cypress_rr_reps (hs_owner_id, name, email, enabled, position) VALUES
  ('78305435', 'Jeff Bauer', 'jeffb@cypressvending.ca', true, 1),
  ('97798186', 'Pat Nicastro', 'patn@cypressvending.ca', true, 2),
  ('481206057', 'Graham Patt', 'grahamp@cypressvending.ca', true, 3),
  ('742548153', 'Matt A', 'matta@cypressvending.ca', true, 4),
  ('78033913', 'Mac Mills', 'mackenziem@cypressvending.ca', false, 5)
ON CONFLICT (hs_owner_id) DO NOTHING;
-- the Zap's counter was 4391 (mod 4 = 3, Matt A), so Jeff Bauer is next
UPDATE cypress_rr_settings
SET last_rep_id = (SELECT id FROM cypress_rr_reps WHERE hs_owner_id = '742548153'), last_position = 4
WHERE id = 1 AND last_rep_id IS NULL;
SELECT
  (SELECT count(*) FROM cypress_rr_reps) AS reps,
  (SELECT count(*) FROM cypress_rr_settings) AS settings,
  (SELECT count(*) FROM cypress_rr_assignments) AS assignments,
  (SELECT count(*) FROM cypress_rr_overwrites) AS overwrites;
