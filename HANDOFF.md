# Cypress Lead Assignment webtool: handoff

**Last updated:** 2026-10-30. Keep this file current (see `AGENTS.md`).

## 1. What this is

A demo webtool, pitched to Cypress Vending (HubSpot portal 22691627), that replaces their Zapier round robin. It assigns
each new lead in HubSpot list 276 to the next rep, and gives them:
- a **report** of who got each lead and why, and who changed the owner afterwards (Calendly, a user, a workflow) and when;
- **time off** per rep (out from / back on, with a reason), skipped automatically;
- a global **pause** (until a time, or until resumed);
- a **settings** page to add reps from HubSpot users, paste a meeting link, turn reps on or off, and reorder them.

The old Zap is in `archive/round_robin_zap.json`: list 276 trigger, Zapier table counter `MOD(counter, 4)`, set
`hubspot_owner_id`, log to the "cypress - audits" Google Sheet. All its steps except the trigger are paused.

Decisions (user, 2026-10-30): poll list 276 (no HubSpot webhook); owner changes after assignment are **kept and logged**,
never reverted; **no sign-in** for the demo.

## 2. Status

| Piece | Status |
|---|---|
| Tables in `demo_db` | **Created and seeded** 2026-10-30 (5 reps, settings row). Next lead goes to Jeff Bauer, continuing the Zap's order |
| `state`, `owners`, `rep`, `settings`, `report` webhooks | **Live and tested** with curl (add, duplicate add 409, update with commas, remove, reorder, pause, resume, bad input 400, report). Test values were reverted |
| `rr-watch-overwrites` | **Live** (every 5 min). Has nothing to read until `rr-assign` runs. Not yet seen against real owner history |
| `rr-assign` | **Deployed, not published** (it writes owners in Cypress's live HubSpot). Needs the user's go-ahead. Never run yet |
| `setup-db` | Run once 2026-10-30, then unpublished. Held by `deploy_flows.py` |
| Site (`docs/`) | **Written, not hosted.** Scripts syntax-checked, helpers tested in node. Not opened in a browser (AGENTS rule). GitHub Pages needs a repo and a push, which wait for the user |
| HubSpot scopes | `crm.objects.owners.read` and `crm.lists.read` added by the user 2026-10-30 (owners now load: 10 active owners). Contacts read works. **Unverified:** contacts write (`crm.objects.contacts.write`), needed by `rr-assign` |

## 3. Layout

```
cypress-webtools/
  CLAUDE.md, AGENTS.md, HANDOFF.md
  archive/round_robin_zap.json   the Zapier round robin being replaced
  flows_src/                     Code node JavaScript (*.js) and SQL (*.sql) used by the flows
  build_flows.py                 wires flows_src/ into n8n-flows/*.json (deterministic node ids)
  n8n-flows/                     generated flow JSON (with n8n ids written back by the deploy)
  deploy_flows.py                deploys n8n-flows/ to n8n.profitpad.com via the REST API (.env: N8N_API_KEY)
  docs/                          static site for GitHub Pages: index.html (report), settings.html, app.js, styles.css
```

Workflow: edit `flows_src/` or `build_flows.py`, then `/usr/bin/python3 build_flows.py`, `/usr/bin/python3 deploy_flows.py --dry-run`,
`/usr/bin/python3 deploy_flows.py`. `HOLD` in `deploy_flows.py` (`rr-assign`, `setup-db`) are saved but not published;
`--publish rr-assign` publishes it.

## 4. n8n

n8n.profitpad.com, project ProfitPad Support (`8dy1nbQgTe702GkM`), folder Cypress (`sa918Q2oACwvEQO4`). Webhook base
`https://n8n.profitpad.com/webhook/cypress-webtools/`, CORS `*`.

Credentials: HubSpot `zeoRTe2WDma5tuVC` ("cypress hubspot", custom node `CUSTOM.hubspotApi`; also works in the HTTP
Request node as predefined type `hubspotApi`), Postgres `0STT9QiFVsbUyNQG` (`demo_db`).

| Flow | id | Trigger | What it does |
|---|---|---|---|
| `state` | `zZ3bBMrc92hANtCy` | GET `state` | `{reps, settings, now}` |
| `owners` | `1E3bp2djD6QQhonZ` | GET `owners` | `{owners: [{id, userId, name, email}]}`, active HubSpot owners |
| `rep` | `wbBQvvOlRLw4IULs` | POST `rep` | `{action: add, hs_owner_id, hs_user_id, name, email, meeting_link}`, `{action: update, id, meeting_link?, enabled?, away_from?, away_until?, away_reason?}` (empty string clears), `{action: remove, id}`, `{action: order, order: [ids]}`. Answers the new state; 400 bad input, 409 owner already listed |
| `settings` | `A8nmAN7FmXLTjXXu` | POST `settings` | `{paused?, paused_until?, pause_reason?, skip_if_owned?}`. Answers the new state |
| `report` | `pr9qZ5ozedhSTkxn` | GET `report?from&to&tz` | Assignments created in the range (each with its `overwrites`), overwrites that happened in the range, reps, settings. Range max 92 days |
| `rr-assign` | `75DXhqjVfROOi6k6` | every 2 min | See §5 |
| `rr-watch-overwrites` | `B1iPRK3B9hhbCnqv` | every 5 min | Latest assignment per contact in the last 30 days (assigned or kept), batch-reads `hubspot_owner_id` with history, records each change after the assignment time (from, to, `sourceType`, `sourceId`, `sourceLabel`, `updatedByUserId`). Changes nothing in HubSpot |
| `setup-db` | `WdkXyPiTf7DBHOEo` | POST `setup-db` | `flows_src/setup.sql`, idempotent. Unpublished |

Postgres parameters are passed as one base64 JSON string (`convert_from(decode($1, 'base64'), 'UTF8')::jsonb`), so
commas in text can't split the n8n query parameter list. Checked live 2026-10-30.

## 5. Round robin logic (`rr-assign`)

1. Load settings, reps, and contact ids already assigned around the last join time.
2. Read list 276 with `GET /crm/v3/lists/276/memberships/join-order?limit=250`. **HubSpot returns members newest first**
   (checked 2026-10-30: 250 of 250 descending; the list has 7,379 members; newest join then was 2026-10-19). The HTTP node
   follows `paging.next.link` and stops once a page reaches `list_last_join_at`. The `after` token comes back already
   URL-encoded, so the node uses HubSpot's own `link`.
3. **First run is a baseline:** reads one page, stores the newest join time, assigns nothing. So turning it on doesn't
   reassign the list's history.
4. New members (joined after `list_last_join_at`, oldest first, max 100 per run; the rest wait for the next run).
5. Batch-read the contacts (name, email, `hubspot_owner_id`), then decide each (`flows_src/assign-plan.js`):
   - paused (and `paused_until` not passed): `paused`, owner untouched;
   - `skip_if_owned` and it has an owner: `kept_existing`;
   - else the next enabled rep after the pointer (`last_rep_id`, or `last_position` if that rep was removed), skipping
     reps whose time off covers now (listed in `skipped`): `assigned`; nobody available: `no_reps`.
6. Batch-update owners. If HubSpot refuses, those rows become `error` with HubSpot's message and the pointer doesn't move.
7. Save rows (`UNIQUE (contact_id, joined_list_at)`), the new cursor, the pointer, `last_poll_at`, `last_poll_error`.

Away semantics: out from the start of "Out from" (viewer's local midnight) until the start of "Back on".

## 6. Database (`demo_db`)

- `cypress_rr_reps`: rep per HubSpot owner (`hs_owner_id` unique), `meeting_link`, `enabled`, `position`, `away_from`,
  `away_until`, `away_reason`.
- `cypress_rr_settings` (one row, id 1): `paused`, `paused_until`, `pause_reason`, `skip_if_owned` (default true),
  `last_rep_id`, `last_position`, `list_id` (276), `list_last_join_at`, `list_initialized`, `last_poll_at`,
  `last_poll_error`. `list_after` is unused (left from the first design).
- `cypress_rr_assignments`: one row per list join: contact, previous owner, owner, rep, `status`
  (`assigned`, `kept_existing`, `paused`, `no_reps`, `error`), `reason` (plain English), `skipped` jsonb.
- `cypress_rr_overwrites`: owner changes after an assignment, `UNIQUE (assignment_id, changed_at)`.

Seed (from the Zapier "Round Robin" table): Jeff Bauer 78305435, Pat Nicastro 97798186, Graham Patt 481206057, Matt A
742548153 (on, in that order), Mac Mills 78033913 (off: index 9 never came up in `MOD(counter, 4)`; his owner id is not
among HubSpot's active owners). HubSpot spells Graham's owner name "Gramham Patt"; the seed keeps the Zapier spelling.

## 7. Site

Static, no build. `docs/app.js` has `API_BASE` and the portal id. HubSpot look: Lexend Deca, HubSpot's slate, orange
(`#ff7a59`) and teal palette. Report: date / quick ranges, KPIs, leads table with reason and later owner changes,
per-rep counts, owner changes table, banners (paused, reps out, waiting for first sync, sync errors or stale). Settings:
pause / resume, skip-if-owned switch, rotation (order, on/off, meeting link saved on change, time off, remove, "next"
badge mirroring the Plan logic), add rep from HubSpot owners.

## 8. Next steps

1. User: OK to publish `rr-assign` (`/usr/bin/python3 deploy_flows.py --publish rr-assign`), and turn off the Zap's
   trigger at the same time so both don't assign. Then check the first run set the baseline.
2. Repo: local git (branch `main`) is linked to `https://github.com/profitpad-inc/cypress-webtools` (empty as of
   2026-10-30). Nothing committed yet; commit and push only when the user says. Then enable
   GitHub Pages from the `/docs` folder of the default branch. Pages on a private repo needs a paid GitHub plan.
3. Open the site in a browser once hosted (not done yet).

## 9. Open items

- What the meeting link is for beyond storing and showing it (for example a single booking link that routes to the
  lead's assigned rep) is not built.
- Leads that arrive while paused are logged, not assigned later.
- No sign-in: anyone with the URL or webhook paths can change the rotation.
- The Zap's unused calendar branch (match an existing meeting organizer to the owner) is not ported.
- The "cypress - audits" Google Sheet logging is not ported (the report replaces it).
- `rr-watch-overwrites` only watches the last 30 days and the latest assignment per contact.
