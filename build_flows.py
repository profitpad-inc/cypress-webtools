"""Builds n8n-flows/*.json from flows_src/ (Code node JavaScript and SQL), so the code stays readable and testable.

  /usr/bin/python3 build_flows.py        # writes n8n-flows/*.json, keeping each file's n8n id
  /usr/bin/python3 deploy_flows.py       # then deploys them

Node ids and webhook ids are derived from the flow and node names, so rebuilding doesn't make diffs.
"""
import json
import os
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "flows_src")
OUT = os.path.join(HERE, "n8n-flows")
NS = uuid.UUID("6f1c2b0e-5d2a-4c1e-9a77-3c3b9f1e0c11")

HUBSPOT = {"hubspotApi": {"id": "zeoRTe2WDma5tuVC", "name": "cypress hubspot"}}
POSTGRES = {"postgres": {"id": "0STT9QiFVsbUyNQG", "name": "demo_db"}}
LIST_URL = "https://api.hubapi.com/crm/v3/lists/"


def src(name):
  return open(os.path.join(SRC, name)).read()


class Flow:
  def __init__(self, key, description):
    self.key = key
    self.description = description
    self.nodes = []
    self.connections = {}

  def node(self, name, type_, version, params, x, y=0, **extra):
    n = {"id": str(uuid.uuid5(NS, f"{self.key}/{name}")), "name": name, "type": type_, "typeVersion": version,
         "position": [x, y], "parameters": params, **extra}
    self.nodes.append(n)
    return name

  def link(self, source, target, output=0):
    outs = self.connections.setdefault(source, {"main": []})["main"]
    while len(outs) <= output:
      outs.append([])
    outs[output].append({"node": target, "type": "main", "index": 0})

  def chain(self, *names):
    for a, b in zip(names, names[1:]):
      self.link(a, b)

  # ── node helpers ─────────────────────────────────────────────────────────

  def webhook(self, method, path, x=0):
    params = {"path": f"cypress-webtools/{path}", "responseMode": "responseNode", "options": {"allowedOrigins": "*"}}
    if method != "GET":
      params = {"httpMethod": method, **params}
    return self.node("Webhook", "n8n-nodes-base.webhook", 2, params, x,
                     webhookId=str(uuid.uuid5(NS, f"{self.key}/webhook")))

  def schedule(self, minutes, x=0):
    return self.node("Schedule", "n8n-nodes-base.scheduleTrigger", 1.2,
                     {"rule": {"interval": [{"field": "minutes", "minutesInterval": minutes}]}}, x)

  def code(self, name, file, x, y=0):
    return self.node(name, "n8n-nodes-base.code", 2, {"jsCode": src(file)}, x, y)

  def sql(self, name, file, x, y=0, param=None, keep_going=True):
    options = {"queryReplacement": param} if param else {}
    extra = {"onError": "continueRegularOutput", "alwaysOutputData": True} if keep_going else {}
    return self.node(name, "n8n-nodes-base.postgres", 2.6,
                     {"operation": "executeQuery", "query": src(file), "options": options}, x, y,
                     credentials=POSTGRES, **extra)

  def hubspot(self, name, params, x, y=0, keep_going=True):
    extra = {"onError": "continueRegularOutput", "alwaysOutputData": True} if keep_going else {}
    return self.node(name, "CUSTOM.hubspotApi", 1, params, x, y, credentials=HUBSPOT, **extra)

  def if_(self, name, expr, x, y=0):
    return self.node(name, "n8n-nodes-base.if", 2, {
      "conditions": {
        "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
        "conditions": [{"id": str(uuid.uuid5(NS, f"{self.key}/{name}/c")), "leftValue": expr, "rightValue": "",
                        "operator": {"type": "boolean", "operation": "true", "singleValue": True}}],
        "combinator": "and",
      },
      "options": {},
    }, x, y)

  def respond(self, x, y=0, body="={{ JSON.stringify($json.body) }}", code="={{ $json.statusCode || 200 }}"):
    return self.node("Respond", "n8n-nodes-base.respondToWebhook", 1.1,
                     {"respondWith": "json", "responseBody": body, "options": {"responseCode": code}}, x, y)

  def save(self):
    path = os.path.join(OUT, f"{self.key}.json")
    existing = json.load(open(path)) if os.path.exists(path) else {}
    wf = {
      **({"id": existing["id"]} if existing.get("id") else {}),
      "name": f"cypress-webtools: {self.key}",
      "settings": {"executionOrder": "v1"},
      "meta": {"description": self.description},
      "nodes": self.nodes,
      "connections": self.connections,
    }
    with open(path, "w") as fh:
      json.dump(wf, fh, indent=2, ensure_ascii=False)
      fh.write("\n")
    print(f"wrote n8n-flows/{self.key}.json ({len(self.nodes)} nodes)")


# answers straight from a Postgres node whose row has a `body` column
DB_BODY = "={{ JSON.stringify($json.body || { error: 'Database error: ' + String($json.error?.message || $json.error || 'no result') }) }}"
DB_CODE = "={{ $json.body ? 200 : 500 }}"
B64 = "={{ $json.p }}"


def setup_db():
  f = Flow("setup-db", "Creates the cypress_rr_* tables in demo_db and seeds the reps. Idempotent; run once, then unpublish.")
  f.chain(f.webhook("POST", "setup-db"), f.sql("Create tables", "setup.sql", 240),
          f.respond(480, body="={{ JSON.stringify($json) }}", code="={{ $json.error ? 500 : 200 }}"))
  f.save()


def state():
  f = Flow("state", "Webtool: the reps in the rotation and the settings.")
  f.chain(f.webhook("GET", "state"), f.sql("Load state", "state.sql", 240), f.respond(480, body=DB_BODY, code=DB_CODE))
  f.save()


def owners():
  f = Flow("owners", "Webtool: Cypress's HubSpot owners, for adding reps and naming owners in the report.")
  f.chain(f.webhook("GET", "owners"),
          f.hubspot("HubSpot: owners", {"resource": "owners", "objectType": "owners", "operation": "list",
                                        "returnAll": True, "returnAllMode": "allInOne", "maxPages": 20}, 240),
          f.code("Shape", "owners-shape.js", 480), f.respond(720))
  f.save()


def rep():
  f = Flow("rep", "Webtool: add, update (meeting link, on/off, out of office), remove or reorder reps.")
  f.chain(f.webhook("POST", "rep"), f.code("Validate", "rep-validate.js", 240), f.if_("Valid?", "={{ $json.ok }}", 480))
  f.link("Valid?", f.sql("Save", "rep-save.sql", 720, param=B64))
  f.chain("Save", f.sql("Load state", "state.sql", 960), f.code("Shape", "state-shape.js", 1200), f.respond(1440, 200))
  f.link("Valid?", "Respond", 1)
  f.save()


def settings():
  f = Flow("settings", "Webtool: pause or resume automatic assignment, and the skip-if-owned switch.")
  f.chain(f.webhook("POST", "settings"), f.code("Validate", "settings-validate.js", 240),
          f.if_("Valid?", "={{ $json.ok }}", 480))
  f.link("Valid?", f.sql("Save", "settings-save.sql", 720, param=B64))
  f.chain("Save", f.sql("Load state", "state.sql", 960), f.code("Shape", "state-shape.js", 1200), f.respond(1440, 200))
  f.link("Valid?", "Respond", 1)
  f.save()


def report():
  f = Flow("report", "Webtool: assignments and owner overwrites for a date range (?from=&to=&tz=).")
  f.chain(f.webhook("GET", "report"), f.code("Validate", "report-validate.js", 240), f.if_("Valid?", "={{ $json.ok }}", 480))
  f.link("Valid?", f.sql("Report", "report.sql", 720, param=B64))
  f.link("Report", f.respond(960, 200, body=DB_BODY, code=DB_CODE))
  # the invalid branch answers through its own node: Respond reads $json.body there too
  f.link("Valid?", f.node("Respond: invalid", "n8n-nodes-base.respondToWebhook", 1.1, {
    "respondWith": "json", "responseBody": "={{ JSON.stringify($json.body) }}",
    "options": {"responseCode": "={{ $json.statusCode || 400 }}"}}, 720, 200), 1)
  f.save()


def rr_assign():
  f = Flow("rr-assign", "Round robin: every 2 minutes, assigns contacts that joined HubSpot list 276 since the last poll "
                        "and records why. Writes contact owners in Cypress's live HubSpot.")
  f.schedule(2)
  f.sql("Load state", "assign-load.sql", 240, keep_going=False)
  # newest first: read from the top, stop once a page reaches members already seen (or after one page, on the baseline poll)
  settings = "$('Load state').first().json.body.settings"
  f.node("HubSpot: list members", "n8n-nodes-base.httpRequest", 4.2, {
    "url": "={{ '" + LIST_URL + "' + $json.body.settings.list_id + '/memberships/join-order?limit=250' }}",
    "authentication": "predefinedCredentialType",
    "nodeCredentialType": "hubspotApi",
    "options": {
      "pagination": {"pagination": {
        "paginationMode": "responseContainsNextURL",
        "nextURL": "={{ $response.body.paging.next.link }}",
        "paginationCompleteWhen": "other",
        "completeExpression": ("={{ !$response.body.paging?.next?.link || !" + settings + ".list_initialized"
                               " || Math.min(...($response.body.results || []).map((r) => Date.parse(r.membershipTimestamp)))"
                               " <= new Date(" + settings + ".list_last_join_at || 8.64e15).getTime() }}"),
        "limitPagesFetched": True,
        "maxRequests": 400,
        "requestInterval": 100,
      }},
    },
  }, 480, credentials=HUBSPOT)
  f.code("Pick new members", "assign-pick.js", 720)
  f.if_("Any new?", "={{ $json.members.length > 0 }}", 960)
  f.hubspot("HubSpot: contacts", {
    "resource": "objects", "objectType": "0-1", "operation": "batchRead", "batchReadInputMode": "ui",
    "batchReadObjectIds": "={{ $json.contactIds }}", "batchReadReturnAllMode": "allInOne",
    "batchReadOptions": {"properties": ["firstname", "lastname", "email", "hubspot_owner_id"]},
  }, 1200, -100, keep_going=False)
  f.code("Plan", "assign-plan.js", 1440, -100)
  f.if_("Owners to set?", "={{ $json.hasUpdates }}", 1680, -100)
  f.hubspot("HubSpot: set owners", {
    "resource": "objects", "objectType": "0-1", "operation": "batchUpdate",
    "batchUpdateBody": "={{ JSON.stringify({ inputs: $json.updates }) }}",
  }, 1920, -200)
  f.code("Finalize", "assign-finalize.js", 2160, 0)
  f.sql("Save", "assign-save.sql", 2400, 0, param=B64, keep_going=False)
  f.chain("Schedule", "Load state", "HubSpot: list members", "Pick new members", "Any new?")
  f.link("Any new?", "HubSpot: contacts")
  f.link("Any new?", "Finalize", 1)
  f.chain("HubSpot: contacts", "Plan", "Owners to set?")
  f.link("Owners to set?", "HubSpot: set owners")
  f.link("Owners to set?", "Finalize", 1)
  f.chain("HubSpot: set owners", "Finalize", "Save")
  f.save()


def rr_watch_overwrites():
  f = Flow("rr-watch-overwrites", "Round robin: every 5 minutes, reads the owner history of contacts assigned in the last "
                                  "30 days and records each later owner change (who, when, through what). Changes nothing in HubSpot.")
  f.schedule(5)
  f.sql("Recent assignments", "watch-load.sql", 240, keep_going=False)
  f.if_("Any?", "={{ !!$json.body.ids }}", 480)
  f.hubspot("HubSpot: owner history", {
    "resource": "objects", "objectType": "0-1", "operation": "batchRead", "batchReadInputMode": "ui",
    "batchReadObjectIds": "={{ $json.body.ids }}", "batchReadReturnAllMode": "allInOne",
    "batchReadOptions": {"properties": ["hubspot_owner_id"], "propertiesWithHistory": ["hubspot_owner_id"]},
  }, 720, keep_going=False)
  f.code("Find overwrites", "watch-find.js", 960)
  f.if_("Found?", "={{ $json.count > 0 }}", 1200)
  f.sql("Save", "watch-save.sql", 1440, param=B64, keep_going=False)
  f.chain("Schedule", "Recent assignments", "Any?")
  f.link("Any?", "HubSpot: owner history")
  f.chain("HubSpot: owner history", "Find overwrites", "Found?")
  f.link("Found?", "Save")
  f.save()


if __name__ == "__main__":
  os.makedirs(OUT, exist_ok=True)
  for build in (setup_db, state, owners, rep, settings, report, rr_assign, rr_watch_overwrites):
    build()
