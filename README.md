# Cypress lead assignment webtool

A round robin for Cypress Vending's HubSpot portal (22691627), replacing their Zapier round robin. It gives each new
lead in the HubSpot round robin list (378) to the next rep, sends booking link visitors to the right rep's calendar,
and reports who got each lead, why, and whether anyone changed the owner afterwards.

The logic runs as n8n flows on `n8n.profitpad.com`, the data lives in Postgres (`demo_db`), and the pages are a static
site on GitHub Pages. This is a demo; there is no sign-in yet.

## Pages

Served from `docs/` (`https://profitpad-inc.github.io/cypress-webtools/`).

| Page | What it's for |
|---|---|
| `report/` | Leads for a day or range: who got each one and why, leads per day (by result or by rep), each rep's share, later owner changes, booking link visits. "Check HubSpot now" runs the HubSpot check on demand and reloads the page |
| `settings/` | Pause or resume assignment, the rotation (order, on or off, meeting links, time off, boost, working hours), adding reps from HubSpot users, and the booking link to share |
| `book/` | The universal booking link, shared as `https://nibly.ca/meet` (it redirects here). Asks for an email when the link has none, then opens the right rep's calendar and passes the link's other parameters (UTMs, click ids) on |

## How leads are assigned

- **From the HubSpot list** (`rr-assign`, every 2 minutes): each new member goes to the next rep in the rotation who is
  on and not out of office, or to a boosted rep first. Contacts that already have an owner keep them. The owner is
  written in HubSpot.
- **Through the booking link** (`book`): a contact with an owner goes to their owner's calendar; anyone else goes to the
  next rep (or a boosted rep) with a meeting link. A visit only logs where it sent the visitor.
- **Booked visits** (`rr-watch-overwrites`, every 5 minutes): when a visitor books and becomes a contact owned by the
  rep they were sent to, that counts as the rep's lead, the same as a list lead.
- The rotation moves, and boosts are used up, only when a lead is counted. One database trigger does this for both
  sources.
- Owner changes made later (by a user, Calendly, a workflow) are kept and recorded, never reverted.

## Repository

```
docs/            the site (one folder per page, shared app.js and styles.css)
flows_src/       the flows' Code node JavaScript and SQL
build_flows.py   builds n8n-flows/*.json from flows_src/
n8n-flows/       generated flow JSON (n8n ids are written back by the deploy)
deploy_flows.py  deploys n8n-flows/ through the n8n REST API
archive/         the Zapier round robin being replaced
HANDOFF.md       detailed notes: status, decisions, flows, tables, open items
```

## Working on it

Flows are built from source, then deployed. Don't edit `n8n-flows/*.json` or the flows in n8n by hand; the next build
or deploy overwrites them.

```bash
/usr/bin/python3 build_flows.py
```

```bash
/usr/bin/python3 deploy_flows.py --dry-run
```

```bash
/usr/bin/python3 deploy_flows.py
```

- The deploy reads `N8N_API_KEY` from `.env` (git-ignored). Credentials are referenced by id, never stored here.
- `rr-assign` and `setup-db` are held: saved but not published unless named in `--publish`. `rr-assign` writes contact
  owners in Cypress's live HubSpot and isn't published yet.
- Name flows before `--publish` to deploy only those, for example `deploy_flows.py book report`.
- `setup-db` runs `flows_src/setup.sql` (tables, trigger, seed; safe to rerun). Publish it, POST its webhook once,
  then unpublish it.
- When `docs/styles.css` or `docs/app.js` changes, bump the `?v=` on the booking page's links, so visitors don't get a
  cached copy.

To preview the site locally:

```bash
cd docs && /usr/bin/python3 -I -m http.server 8765
```

The pages call the live n8n webhooks, so a local preview shows real data.
