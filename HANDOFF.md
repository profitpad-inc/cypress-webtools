# Cypress Lead Assignment webtool: handoff

**Last updated:** 2026-10-30. Keep this file current (see `AGENTS.md`).

## 1. What this is

A demo webtool, pitched to Cypress Vending (HubSpot portal 22691627), that replaces their Zapier round robin. It assigns
each new lead in the HubSpot round robin list to the next rep, and gives them:
- a **report** of who got each lead and why, and who changed the owner afterwards (Calendly, a user, a workflow) and when;
- **time off** per rep (out from / back on, with a reason), skipped automatically;
- a global **pause** (until a time, or until resumed);
- a **settings** page to add reps from HubSpot users, paste a meeting link, turn reps on or off, and reorder them;
- a **universal booking link** (`book/`) that opens the right rep's meeting link (§7).

**List ids:** the round robin list is "[Zap Trigger] Contact Owner Round Robin", a MANUAL list. The Zap and the old
v1 API call it 276; HubSpot's v3 API and the UI call it **378** (`GET /crm/v3/lists/idmapping?legacyListId=276`
answered `listId 378`, 2026-10-30; UI link `https://app.hubspot.com/contacts/22691627/objectLists/378/filters`). Use 378
everywhere. `/crm/v3/lists/276/...` reads a different list (7,379 members); 378 had 4,487 members on 2026-10-30.

The old Zap is in `archive/round_robin_zap.json`: list 276 trigger, Zapier table counter `MOD(counter, 4)`, set
`hubspot_owner_id`, log to the "cypress - audits" Google Sheet. All its steps except the trigger are paused.

Decisions (user, 2026-10-30): poll the list (no HubSpot webhook); owner changes after assignment are **kept and logged**,
never reverted; **no sign-in** for the demo.

## 2. Status

| Piece | Status |
|---|---|
| Tables in `demo_db` | **Created and seeded** 2026-10-30 (5 reps, settings row; `cypress_rr_bookings` and `list_id` 378 added by a second `setup-db` run the same day). Next lead goes to Jeff Bauer, continuing the Zap's order. The user has since pasted Calendly links for Jeff, Pat, Graham and Matt |
| `state`, `owners`, `rep`, `settings`, `report` webhooks | **Live and tested** with curl (add, duplicate add 409, update with commas, remove, reorder, pause, resume, bad input 400, report). Test values were reverted |
| `book` | **Live and tested** 2026-10-30: no email went to the rotation, `jeffb@cypressvending.ca` (a HubSpot contact owned by Graham) went to Graham's link. The two test rows were deleted and the pointer put back on Matt A |
| `rr-watch-overwrites` | **Live** (every 5 min). Has nothing to read until `rr-assign` runs. Not yet seen against real owner history |
| `rr-assign` | **Deployed, not published** (it writes owners in Cypress's live HubSpot). Needs the user's go-ahead. Never run yet |
| `setup-db` | Run once 2026-10-30, then unpublished. Held by `deploy_flows.py` |
| Site (`docs/`) | **Restyled 2026-10-30** to Fairbank order placement's light look (§7). Scripts syntax-checked, helpers tested in node. Report and Settings **opened in the browser pane 2026-10-30** (on request, desktop and phone widths) after the layout pass in §7.2; the report's chart, KPIs and share bars were checked with fake data patched into the page, not real leads. The first version is pushed to `profitpad-inc/cypress-webtools`; the user is enabling GitHub Pages (`/docs` on `main`). The restyle is not committed yet |
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
  docs/                          static site for GitHub Pages (one folder per page, so URLs have no .html)
    index.html                   redirect to ./report/
    report/, settings/, book/    each an index.html; links point at the folder (../settings/)
    app.js, styles.css, favicon.png   shared; pages set <body data-base="../">
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
| `rep` | `wbBQvvOlRLw4IULs` | POST `rep` | `{action: add, hs_owner_id, hs_user_id, name, email, meeting_link}`, `{action: update, id, meeting_link?, enabled?, away_from?, away_until?, away_reason?, boost_remaining? (0 to 100)}` (empty string clears), `{action: remove, id}`, `{action: order, order: [ids]}`. Answers the new state; 400 bad input, 409 owner already listed |
| `settings` | `A8nmAN7FmXLTjXXu` | POST `settings` | `{paused?, paused_until?, pause_reason?, skip_if_owned?}`. Answers the new state |
| `report` | `pr9qZ5ozedhSTkxn` | GET `report?from&to&tz` | Assignments created in the range (each with its `overwrites`), overwrites that happened in the range, booking link visits, reps, settings. Range max 92 days |
| `book` | `LA5IQQSRKyw5fafT` | GET `book?email=` or `?cid=` | Universal booking link (§7.1). Answers `{url, rep_name, route}`, or 503 `{error}` when nobody is available. Logs the visit only: never moves the rotation or uses a boost. Reads HubSpot only |
| `rr-assign` | `75DXhqjVfROOi6k6` | every 2 min | See §5 |
| `book` | **Live and tested** 2026-10-30: no email went to the rotation, `jeffb@cypressvending.ca` (a HubSpot contact owned by Graham) went to Graham's link. The two test rows were deleted and the pointer put back on Matt A |
| `rr-watch-overwrites` | `B1iPRK3B9hhbCnqv` | every 5 min | Latest assignment per contact in the last 30 days (assigned or kept), batch-reads `hubspot_owner_id` with history, records each change after the assignment time (from, to, `sourceType`, `sourceId`, `sourceLabel`, `updatedByUserId`). Second branch: **booked visits** (§7.1). Changes nothing in HubSpot |
| `setup-db` | `WdkXyPiTf7DBHOEo` | POST `setup-db` | `flows_src/setup.sql`, idempotent. Unpublished |

Postgres parameters are passed as one base64 JSON string (`convert_from(decode($1, 'base64'), 'UTF8')::jsonb`), so
commas in text can't split the n8n query parameter list. Checked live 2026-10-30.

## 5. Round robin logic (`rr-assign`)

1. Load settings, reps, and contact ids already assigned around the last join time.
2. Read the list with `GET /crm/v3/lists/378/memberships/join-order?limit=250` (`list_id` setting). **HubSpot returns
   members newest first** (checked 2026-10-30: 250 of 250 descending on v3 list 276, a different list, and the first 3 on 378). The HTTP node
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

**Boost** (2026-10-30, on request: "make that user get the next x number of leads"): `cypress_rr_reps.boost_remaining`
(0 to 100, set on Settings). After the pause and skip-if-owned checks, a rep who is on, not out of office and has
`boost_remaining > 0` takes the lead instead of the rotation; with several, the one with the most left goes first, so
they share. Boosted leads don't move the rotation pointer, so the normal order carries on where it was. The row is saved
with `boosted = true` and the Save query takes one off per boosted row that really got assigned (a HubSpot refusal
becomes an `error` row and costs nothing). The booking link follows boosts too (2026-10-30, on request): where it would use the rotation, the boosted rep (who
also needs a meeting link) gets the visit, route `boost`. Visits don't count a boost down; only assigned leads do.

**Only assigned leads move things** (2026-10-30, on request: "only progress to the next person in the rotation if the
lead actually got assigned"): the rotation pointer and boost counts change only for `assigned` rows in `rr-assign`.
Paused, kept-owner, no-rep and error rows don't move them, and booking link visits never do (until 2026-10-30 a
rotation visit moved the pointer and a boost visit used a boost). So every anonymous visitor goes to whoever is next
until a lead is really assigned. A visitor who books becomes a lead already owned by that rep (Calendly sets the
owner); with skip-if-owned on, that's `kept_existing` and doesn't count as their turn. Decided 2026-10-30 (user): leave
it that way.

## 6. Database (`demo_db`)

- `cypress_rr_reps`: rep per HubSpot owner (`hs_owner_id` unique), `hs_user_id` (null for the seeded reps),
  `meeting_link`, `enabled`, `position`, `away_from`, `away_until`, `away_reason`, `boost_remaining`.
- `cypress_rr_settings` (one row, id 1): `paused`, `paused_until`, `pause_reason`, `skip_if_owned` (default true),
  `last_rep_id`, `last_position`, `list_id` (378), `list_last_join_at`, `list_initialized`, `last_poll_at`,
  `last_poll_error`. `list_after` is unused (left from the first design).
**Reworked 2026-10-30** (on request, demo phase; replaces `cypress_rr_assignments`, `cypress_rr_bookings`,
`cypress_rr_overwrites`, which `setup.sql` copies over once and renames to `*_old`, kept, not used):
- `cypress_rr_leads`: **every lead**, `source` `list` (rr-assign, one per list join, `UNIQUE (contact_id,
  joined_list_at)`) or `booking` (a booking link visitor who became a contact owned by the rep they were sent to;
  rr-watch-overwrites; `visit_id` unique). Contact, `previous_owner_id`, `owner_id`, rep, `status` (`assigned`,
  `kept_existing`, `paused`, `no_reps`, `error`), `boosted`, `reason`, `skipped`. `created_at` is when the lead happened
  (a booking: the visit's time), `detected_at` when it was recorded.
- `cypress_rr_visits`: one row per booking link visit (log only): email, contact, owner, rep, url, `route` (`owner`,
  `rotation`, `repeat`, `boost`, `none`), `reason`, `skipped`. A booked visit has a lead pointing at it.
- `cypress_rr_owner_changes`: later owner changes per lead, `UNIQUE (lead_id, changed_at)`.
- **Trigger `cypress_rr_lead_counted`** (AFTER INSERT on leads, per row): an `assigned` lead with a rep counts once: a
  `boosted` one uses one of its rep's boosted leads; any other moves `last_rep_id` / `last_position` to its rep, unless
  an assigned non-boosted lead with a later `created_at` exists. The only place the rotation and boosts move; rr-assign
  and the booked-visit check just insert leads (oldest first). rr-assign skips list members who already have a
  `booking` lead in the last 30 days, so a contact isn't a lead twice.

Seed (from the Zapier "Round Robin" table): Jeff Bauer 78305435, Pat Nicastro 97798186, Graham Patt 481206057, Matt A
742548153 (on, in that order), Mac Mills 78033913 (off: index 9 never came up in `MOD(counter, 4)`; his owner id is not
among HubSpot's active owners). HubSpot spells Graham's owner name "Gramham Patt"; the seed keeps the Zapier spelling.

## 7. Site

Static, no build, light only. Clean URLs like Fairbank's site: each page is a folder with an `index.html` and links
point at folders (`../settings/`), so GitHub Pages serves `/cypress-webtools/report/` with no `.html`. `docs/app.js` holds
`API_BASE`, the portal id, `LIST_URL` (list 378 in HubSpot) and `CW.header()`.

**Look** (2026-10-30, on request: "style it similar to fairbank-sales/docs/order-placement"): copied from that page's
light theme (`html[data-theme="light"]` in its `styles.css`): page #f5f8fa, white cards with a #dfe3eb border, 12px
corners and a faint shadow, Lexend Deca in sentence case, text #33475b, headings #213343, teal links #0091ae and focus
ring #00bda5, dark teal pill primary buttons #1c484a (hover #275f61), white outlined pill secondary buttons, 6px inputs.
**Header bar** is a copy of Fairbank's `initHeader()` bar (#333, 40px, sticky; hides on scroll down on phones): the
favicon (`favicon.png`, from `https://22691627.fs1.hubspotusercontent-na1.net/hubfs/22691627/nb-favicon.png`, the
"Wanna bite?" bubble) and "Lead Assignment" left, a Tools menu (Report, Settings), and a "Round robin list" link to
HubSpot on the right. No user menu yet: sign-in comes later and will sit right of that link.

**Dates** (2026-10-30, on request: "use the calendar picker used in fairbank"): Flatpickr 4.6.13, copied from
Fairbank's `docs/order-placement/vendor/` into `docs/vendor/`, with Fairbank's calendar CSS (light values) at the end of
`styles.css`. `CW.datePicker(el, {time, value, minDate, label, placeholder, onChange})` in `app.js` uses Fairbank's
options: the real input keeps `YYYY-MM-DD` (`YYYY-MM-DD HH:MM` with time), the visible box shows "Oct 26, 2026" with a
calendar icon (`.date-alt`), `disableMobile` keeps the themed calendar on phones. Unlike Fairbank, the boxes can't be
typed in (tap to open). Used for the report's day, Pause until (with time, from today) and time off (Back on can't be
before the day after Out from). Not checked in a browser.

- **Report** (`report/`): date / quick ranges, KPIs (incl. booking link visits), leads per day chart, leads with reason and later owner
  changes, by-rep counts (share of leads, leads, changed later, bookings), owner changes, booking link visits, banners (paused, reps
  out, sync errors or stale). See §7.2 for the layout pass.
- **Settings** (`settings/`): pause / resume (2026-10-30, on request: a "Pause assignment" button in the card head;
  Pause until and Reason open below only after it's clicked; while paused, the card says until when and why, with
  Resume now). The skip-if-owned switch was removed from the page the same day, on request ("remove this setting for
  now"); `skip_if_owned` stays true in the database (checked 2026-10-30), so leads that already have an owner keep them,
  and the `settings` endpoint still accepts it. Rotation (layout changed 2026-10-30, see §7.2; order, on/off, meeting link saved on
  change, **Working hours** link to `https://app.hubspot.com/settings/22691627/users/user/{hs_user_id}?tab=preferencesTab&subtab=workingHours`
  (user id from the rep row, else from the owners list; hidden when unknown, e.g. Mac Mills, who isn't an active owner),
  **Boost** (number of next leads, End boost; "Boosted: N left" tag), time off, remove, "Next" badge mirroring the Plan logic; reps without a link are flagged as skipped by the
  booking link), the booking link card (`#booking`, copy buttons), add rep from HubSpot owners (since 2026-10-30, on request, an **Add rep** button in the Rotation card's footer, bottom left, that opens the search and meeting link fields in place, with Cancel; the separate "Add a rep" card is gone). Next to it, **Edit order** shows the up / down arrows column and each rep's Remove (both hidden otherwise) and turns into **Done** (2026-10-30, on request). Links to the HubSpot list.

### 7.3 Table rework (2026-10-30, on request)

See §6. Files: `setup.sql` (tables, one-time copy in a `DO` block, trigger), `book-load.sql` / `book-save.sql`
(visits), `assign-load.sql` (adds `booked` contact ids), `assign-plan.js` (skips them; no pointer output),
`assign-finalize.js` / `assign-save.sql` (insert leads in order, no pointer or boost code), `watch-load.sql` (leads),
`watch-find.js` / `watch-save.sql` (`lead_id`), `watch-visits-load.sql` / `watch-booked.js` / `watch-booked-save.sql`
(booked visit becomes a `booking` lead), `report.sql` (`leads`, `owner_changes`, `visits`), and the report page (every
count from `leads`; Leads table shows booked leads with a Booked tag and a "Booked through the link" filter). The
notes about `booked_at`, `booking_id` and `cypress_rr_overwrites` in §7.1 describe the first design. Node tests passed
(booked visit match, owner change by `lead_id`, rr-assign skipping a booked contact). **Deployed 2026-10-30.** Note: `--publish
setup-db setup-db` doesn't limit the deploy (`--publish` takes both names), so every changed flow went out with it,
seconds before the copy; put flow names before `--publish` to deploy only those. `setup-db` answered leads 2, visits 3,
owner changes 2, `last_rep_id` 3 (Graham, unchanged), then was unpublished; rr-assign stays unpublished. Watch run
292054 on the new tables: found the same 2 owner changes, inserted 0. Report checked in the browser: same numbers as
before the rework (2 leads, both booked; Pat 1 and Graham 1; 3 visits; 2 rows in Owner changes; net change 0).

**Lead names from HubSpot** (2026-10-30, on request): a booking link visitor without a name gets one when they book,
but the lead kept the visit's empty name (the report showed czbecher+6's email). `rr-watch-overwrites` now also reads
`firstname` / `lastname` with the owner history and, where HubSpot's name differs from a lead's, updates
`contact_name` on that contact's leads (`findRenames` in `watch-find.js`, `ren` in `watch-save.sql`; `Found?` also
passes when there are renames). The visits table shows a booked visit's lead name. Rename logic tested in node.
Deployed 2026-10-30; watch run 292095 renamed 1 lead (czbecher+6 is now "Chris Test03" on the report).
Booking link card on Settings: the "Nobody available" step was dropped on request (3 steps).

**Check HubSpot now** (2026-10-30, on request): a button at the bottom of the report POSTs `watch-now`, a second
trigger on `rr-watch-overwrites` (webhook, `responseMode: lastNode`, so it answers when both branches are done), then
reloads the whole page (2026-10-30, on request; an error shows a toast instead). Overlap with a scheduled run is safe (unique keys). Deployed 2026-10-30. The webhook
uses `responseData: noData`: with the default, n8n answered HTTP 500 "No item to return was found" because the last
node to run can be an IF with nothing to pass on (the run itself had succeeded). Checked: `watch-now` answers 200, and
the button in the browser showed "Checked HubSpot"; the runs show in n8n as `webhook` mode.

**Leads per day by rep** (2026-10-30, on request): a "By result / By rep" switch on the chart (remembered per browser
in `localStorage`, `cw_trend_mode`). By rep stacks each day's assigned leads by rep, colored by the rep's place in the
rotation from the dataviz reference palette (blue, orange, aqua, yellow, magenta, green, violet, red; the first five
validated for stacked bars; aqua, yellow and magenta are under 3:1 on white, so the legend and hover text name each
rep), with kept or unassigned leads in light gray and reps past the 8th as "Other reps". Checked in the browser with
real data and with 70 fake leads in the tab.

Booking page assets are at `?v=20261030d` (bumped for `styles.css` changes).

### 7.2 Layout pass (2026-10-30, on request: "do everything except C")

Font, colors and header bar unchanged (user's rule). Option C (short meeting link labels with a pencil) was **not** done.
- **Settings, status:** one status in the Automatic assignment card: "Waiting for first sync" (gray) until
  `list_initialized`, then "Running", with "Last checked HubSpot …" under the card text. The page-head "Round robin not
  switched on yet" text is gone (it contradicted the Running tag).
- **Settings, rotation:** the Status column is gone; tags sit under the rep's email and show only when unusual (Out until,
  Out later, Boosted, No meeting link). Off is shown by the switch and the dimmed name. Columns (2026-10-30, on request):
  Rep (sized to its content), Meeting link (400px) right beside it, then Working hours, Boost, Time off (and Remove in
  Edit order) right aligned, then the switch, labelled **In rotation**, at the far right. A "⋯" menu for Boost and
  Working hours was tried the same day and taken out again on request. Under 768px the table becomes one stacked card
  per rep (`.rot` CSS): name and switch, link, buttons (they wrap); arrows on the left in Edit order.
- **Settings, booking link:** "How it picks a rep" as 4 numbered steps in `book-decide.js` order (repeat, owner,
  rotation or boost, nobody), with one note line under them; replaced the bullets and the "Existing contacts …" hint.
- **Report, dates:** one Flatpickr range box (`CW.datePicker(el, {range: true})`, `onClose` added): two clicks pick a
  range, one click then closing picks a day; it shows "Oct 1, 2026 to Oct 30, 2026". The arrows step by the range's
  length ("Previous 7 days").
- **Report, KPIs:** New leads and Assigned are larger (`.kpis--lead`, `.kpi--main`); the other four are smaller.
- **Report, leads per day:** for ranges over a day with leads, stacked HTML bars per day (Assigned #0091ae, Kept
  existing owner #1c484a, Not assigned #b36b00), legend, hover title with the counts, max label, first / middle / last
  day labels. These three colors passed the dataviz validator's color blindness, normal vision and contrast checks; #1c484a
  fails its lightness / chroma band (it's the existing dark teal, kept by the no-new-colors rule).
- **Report, By rep:** Status column replaced by "Share of leads" (bar and % of assigned leads); Removed / Off / Out until
  shows under the name only when it applies. With no assigned leads in the period the Share column is left out (empty gray bars looked like a loading
  skeleton, 2026-10-30).
- **Report, quiet state:** when the period has no leads, owner changes or visits, one card replaces the KPIs and all
  tables: "Waiting for the first sync" (before `list_initialized`, with the next rep and a link to Settings) or "Nothing
  in this period" (with "Show the last 30 days" for shorter ranges). The waiting banner is skipped then.
- Preview: `.claude/launch.json` points the browser pane at `http://localhost:8765`; the pane can't start a server in
  `~/Desktop` (permission error), so start it from a shell: `cd docs && /usr/bin/python3 -I -m http.server 8765`.

### 7.1 Universal booking link (`book/`)

`https://profitpad-inc.github.io/cypress-webtools/book/` (assuming the default Pages domain). **Public link: `https://nibly.ca/meet`** (2026-10-30: the user
set up a page there that `location.replace()`s to `.../cypress-webtools/book/` plus the query string and hash, checked with
curl; its meta refresh fallback drops the query). Settings always shows the nibly link (`BOOK_URL` in `app.js`), with
`?email={{ contact.email }}&firstname=...&lastname=...` for HubSpot.
**Email prompt and pass-through** (2026-10-30, on request, done in `docs/book/index.html` only; the `book` flow is
unchanged): without a valid `email` (or `e`) or a numeric `cid` on the link (an unfilled `{{ }}` token counts as none),
the page shows "Book a meeting" with a required email box first, then puts the email on the address
(`history.replaceState`) and calls the flow. After the flow answers, every other query parameter on the link (UTMs,
gclid, fbclid, anything not `email`, `e`, `cid` or a first / last name key) is appended to the meeting link, unless the
link already has that parameter. Checked in the browser with `CW.api` stubbed (no visit logged): bad email shows an
error, `jane+1@example.com` reached the API as `%2B`, `utm_campaign` and `gclid` were appended and the link's own
`utm_source` was kept. Not checked: a link that already has an email (it skips the prompt and calls the live flow).
**Booking page look** (2026-10-30, on request): the booking card copies Nibly's own HubSpot form on nibly.ca, not the
tool's look: Poppins (Google Fonts, `book/` only), a rgb(245,246,242) panel with square corners and 40px padding, 20px
#212d3a labels with a red asterisk, white inputs (#959494 border, 3px corners, 12px padding), a black bold 20px button,
centered, errors in #e51520. CSS is the `.book` block in `styles.css`; the loading and error screens use the same panel, with a black / gray
spinner. Checked in the browser (empty, error and loading states). `book/index.html` loads `styles.css?v=…` and
`app.js?v=…`: bump `v` when either changes, since a cached old `styles.css` showed the old look (seen 2026-10-30).
The `+` in a link's email (`?email=jane+1@x.com`, read as a space) is put back on the page too, or it asked for an
email it already had (fixed 2026-10-30; checked with sample query strings in node, not on the live page). In HubSpot emails:
`.../book/?email={{ contact.email }}` (an unfilled `{{` token is ignored). Customer-facing page, no header: it calls the
`book` flow and `location.replace()`s to the answer. Decision (`flows_src/book-decide.js`):
1. same email within a day and that rep still has a link and isn't out: same rep (`repeat`), so a double click doesn't
   skip anyone;
2. a HubSpot contact whose owner is a listed rep with a link who isn't out: their owner (`owner`); this ignores the rep's
   on/off switch, which only controls new leads;
3. anyone else: a boosted rep if there is one (`boost`, see §5 Boost), else the next enabled rep in the shared rotation who isn't out and has a link (`rotation`), read from the
   pointer `rr-assign` uses without moving it; the reason says why (new visitor, no owner, owner out, owner without a link);
4. nobody: 503 and a "try again later" page (`none`). Its reason reads "<opening>, and nobody in the rotation was available." (reworded 2026-10-30, on
   request; `setup.sql` rewrites visits logged with the old wording; deployed and run 2026-10-30, the 11:03 AM visit now reads "New visitor
   (email not in HubSpot), and nobody in the rotation was available.").
The scheduler is prefilled: Calendly gets `email` and `name`, HubSpot meetings get `email`, `firstName`, `lastName`.
The values come from the link first (`?email=`, `?firstname=` / `firstName` / `first_name`, `?lastname=` / `lastName` /
`last_name`; added 2026-10-30, on request), then from the HubSpot contact, so a visitor not in HubSpot is prefilled
too. Unfilled `{{ }}` tokens are dropped. The visit's name on the report uses the same values.
Gotchas found 2026-10-30: (1) n8n's Code node sandbox has **no `URL` class**; `withPrefill()` used `new URL()` in a
try/catch, so every link went out bare until it was rewritten with a regex. Don't use `URL` in Code nodes. (2) A `+` in
an email (`czbecher+1@gmail.com`) arrives as a space, because `+` means space in a query string; `book-validate.js` turns
spaces back into `+`. Checked live after the fix: that email (a HubSpot contact owned by Matt A) got Matt's link with
`email`, `firstName` and `lastName`.

**Save bug (found 2026-10-30, execution 291779):** `book-save.sql` had a trailing `),` after its last CTE, left when
the rotation pointer update was removed in commit 5e57f0f, so every Save failed with "Syntax error at line 1 near
SELECT". Save is `onError: continueRegularOutput`, so visitors still got their link and executions showed green, but
**no booking link visit was logged between 5e57f0f and the fix**. Fixed in `flows_src/book-save.sql`, rebuilt
and deployed 2026-10-30. After the first deploy the active version had the fix but the draft still had the old query
(possibly an open editor tab saved over it, unverified); redeployed with the editor closed, and the read-back showed draft
and active both fixed and the same version (94f5f174). Close n8n editor tabs on a flow before deploying it. Not yet
confirmed by a real visit: czbecher+6@gmail.com at 10:16 AM, 2026-10-30, saved and shows on the report (seen by the
user and in the browser pane).

**Booked visits** (2026-10-30, on request; `rr-watch-overwrites` second branch: `watch-visits-load.sql`,
`watch-booked.js`, `watch-booked-save.sql`): visits only log, so a visitor who books on the rep's calendar (HubSpot
Meetings or Calendly then create the contact and set the owner) used to leave that rep "next" (seen 2026-10-30:
czbecher+6@gmail.com went to Pat, HubSpot Meetings made Pat the owner 16 s later, Pat stayed next). Every 5 min it reads
`rotation` / `boost` visits from the last 2 days that aren't booked (and whose email has no booked visit and no
`assigned` lead), batch-reads those emails in HubSpot (`idProperty: email`), and counts a visit as booked when the
contact's owner is the rep it went to and `hubspot_owner_assigneddate` is after the visit (60 s slack). Save sets
`booked_at` / `booked_contact_id` on that visit, uses one boosted lead for a `boost` visit, and for the latest `rotation`
visit moves the pointer to its rep unless a lead was assigned or another booking counted after that visit. One per
email. The report shows a **Booked** tag on the visit and "N booked" under the visits stat. In **By rep** (2026-10-30, on
request), a booked visit counts in that rep's **Leads** (and the share bar) and **Bookings**; visits sent to an existing
owner or never booked count in neither. Booked visits also count in the top **New leads** and **Assigned** KPIs
("N booked" under Assigned; percentages use list leads plus booked visits) and as Assigned in the leads per day chart,
on the visit's day (2026-10-30, on request).
**Owner changes on booked visits** (2026-10-30, on request): `rr-watch-overwrites`'s `Recent assignments`
(`watch-load.sql`) also reads booked visits from the last 30 days (`kind: 'booking'`, the booked contact, the rep's
owner id as the expected owner, from the visit time), latest per contact. `watch-find.js` writes `booking_id` instead
of `assignment_id` for those; `cypress_rr_overwrites.assignment_id` is now nullable, with `booking_id` (unique with
`changed_at`). `report.sql` joins either and sends each visit's changes; the report counts them in "Owner changed
later" and By rep "Changed", shows them under the visit's Why, and Owner changes says "booked with <rep>" for them.
Detection tested in node (a booked visit reassigned Graham to Matt recorded; the booking's own owner set ignored).
Deployed 2026-10-30 with a
`setup-db` run (then unpublished). First run (execution 291952) watched both booked visits and recorded the user's own
test: Chris Test07 (czbecher+7) booked with Graham, moved to Matt A at 14:40:43 UTC in HubSpot (CRM_UI, user 62490421);
the report showed it in Owner changes, on the visit, in "Owner changed later" and in Graham's "Changed". "Gramham Patt"
on the report is the owner's name as spelled in HubSpot. **Net changes** (2026-10-30, on
request): when the latest owner change puts the contact back with the owner the tool gave it (the assigned rep, or the
rep a visit was booked with), the report treats it as unchanged: no "Changed" notes on the lead or visit, not counted
in "Owner changed later", By rep "Changed" or the "Owner changed later" filter (`netChanges()` in `report/index.html`).
The database rows stay, and the Owner changes card still lists every change. Checked: Chris Test07 (Graham → Matt →
Graham) shows no notes, "Owner changed later" 0, Graham "Changed" 0, Owner changes 2 rows. New columns
`cypress_rr_bookings.booked_at`, `booked_contact_id` are in `setup.sql`. Match logic tested in node (booked rotation and
boost visits counted; no contact, other owner, owner set before the visit skipped). Deployed 2026-10-30;
`setup-db` was published, run once (answered reps 5, bookings 1, list 378) and unpublished again. First run, execution
291875: the branch ran cleanly and found the czbecher+6 contact (owner Pat), but did **not** count it, correctly: the
only logged visit is id 51 at 14:16:07, after the owner was set (14:09:31); the 14:09:15 visit that led to the booking
was lost to the Save bug. That visit also said "email not in HubSpot" though the contact existed, which fits the user's
note that the HubSpot connector pointed at the wrong portal until they fixed it (2026-10-30). On request, visit 51's
`created_at` was set to 14:09:15.298 (the failed save's time) by a guarded one-off `UPDATE` in `setup.sql` (only that
row, only once) and a `setup-db` run. The next watch run (execution 291883) counted it: `booked_at` set, contact
259201633718, pointer moved from Jeff (rep 1) to Pat (rep 2), so Graham is next. First real booking counted. End to end on a fresh visit: czbecher+7@gmail.com, 14:39:21 to
Graham (next), counted as booked 14:40:20 (contact 208693525642), pointer moved to Graham, Matt A next.

**Prerender:** Chrome prerenders pages while the URL is typed (or a link is hovered) and runs their scripts, which
logged every visit twice and moved the rotation twice (seen 2026-10-30 in the `book` executions: each pair had one call
with `Sec-Purpose: prefetch;prerender`). The page now waits for `prerenderingchange` when `document.prerendering` is
true. Not yet rechecked in a browser.

## 8. Next steps

1. User: OK to publish `rr-assign` (`/usr/bin/python3 deploy_flows.py --publish rr-assign`), and turn off the Zap's
   trigger at the same time so both don't assign. Then check the first run set the baseline.
2. Repo: `https://github.com/profitpad-inc/cypress-webtools` (private), branch `main`, first commit pushed
   2026-10-30. Commit and push only when the user says. The user is enabling GitHub Pages from `/docs` on `main`
   (Pages on a private repo needs a paid GitHub plan; unverified whether the org has one).
3. Open the site in a browser once hosted (not done yet).

## 9. Open items

- Booking link visitors without an email always go to the rotation, so anonymous repeat clicks each move it.
- Leads that arrive while paused are logged, not assigned later.
- No sign-in: anyone with the URL or webhook paths can change the rotation.
- The Zap's unused calendar branch (match an existing meeting organizer to the owner) is not ported.
- The "cypress - audits" Google Sheet logging is not ported (the report replaces it).
- `rr-watch-overwrites` only watches the last 30 days and the latest assignment per contact.
