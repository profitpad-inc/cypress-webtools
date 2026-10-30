"""Deploys the Cypress webtool n8n flows (n8n-flows/*.json) to n8n.profitpad.com through n8n's REST API, into the
Cypress folder. Adapted from the Foundry webtools deploy script.

  /usr/bin/python3 deploy_flows.py --check            # check the JSON here; touches nothing
  /usr/bin/python3 deploy_flows.py --dry-run          # list each flow as NEW, CHANGED or same against live n8n
  /usr/bin/python3 deploy_flows.py                    # create NEW flows, update CHANGED ones, publish
  /usr/bin/python3 deploy_flows.py state report       # only these flows (file names without .json)
  /usr/bin/python3 deploy_flows.py --publish rr-assign  # also publish a held flow (HOLD below)

The API key comes from .env (git-ignored) or the environment: N8N_API_KEY, optional N8N_URL.

A file finds its live workflow by its `id`, else by exact name in the ProfitPad Support project. n8n assigns new ids;
the script writes them back into the JSON files. Flows in HOLD are saved but never published unless named in --publish.
"""
import argparse
import glob
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

PROJECT = "8dy1nbQgTe702GkM"  # ProfitPad Support
FOLDER = "sa918Q2oACwvEQO4"  # "Cypress"
FOLDER_NAME = "Cypress"
DEFAULT_URL = "https://n8n.profitpad.com"
PATH_PREFIX = "cypress-webtools/"
CREDENTIALS = {"zeoRTe2WDma5tuVC", "0STT9QiFVsbUyNQG"}  # cypress hubspot, demo_db
HOLD = {"rr-assign", "setup-db"}  # rr-assign writes owners in live HubSpot; setup-db runs once. Publish only when asked
SETTINGS = {"saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution", "saveDataSuccessExecution",
            "executionTimeout", "errorWorkflow", "timezone", "executionOrder", "binaryMode", "callerPolicy", "callerIds",
            "timeSavedMode", "timeSavedPerExecution", "redactionPolicy", "availableInMCP", "customTelemetryTags",
            "credentialResolverId"}
HERE = os.path.dirname(os.path.abspath(__file__))
FLOW_DIR = os.path.join(HERE, "n8n-flows")


def load_flows(only):
  flows = {}
  for path in sorted(glob.glob(os.path.join(FLOW_DIR, "*.json"))):
    key = os.path.basename(path)[:-5]
    if only and key not in only:
      continue
    flows[key] = json.load(open(path))
  missing = sorted(set(only) - set(flows))
  if missing:
    sys.exit(f"no such flow file: {', '.join(missing)}")
  return flows


def check(flows):
  problems, names, paths = [], {}, {}
  for key, wf in flows.items():
    if wf.get("name") in names:
      problems.append(f"{key}: name {wf.get('name')!r} is also used by {names[wf['name']]}")
    names[wf.get("name")] = key
    node_names = [n["name"] for n in wf.get("nodes", [])]
    if len(node_names) != len(set(node_names)):
      problems.append(f"{key}: duplicate node names")
    for source, outs in wf.get("connections", {}).items():
      for name in [source, *[c["node"] for out in outs.get("main", []) for c in out]]:
        if name not in node_names:
          problems.append(f"{key}: connection to unknown node {name!r}")
    for n in wf.get("nodes", []):
      if n["type"] == "n8n-nodes-base.webhook":
        path = n["parameters"].get("path", "")
        if not path.startswith(PATH_PREFIX):
          problems.append(f"{key}: webhook path {path!r} isn't under {PATH_PREFIX}")
        if path in paths:
          problems.append(f"{key}: webhook path {path} is also used by {paths[path]}")
        paths[path] = key
      for cred in (n.get("credentials") or {}).values():
        if cred.get("id") not in CREDENTIALS:
          problems.append(f"{key}: node {n['name']!r} uses an unexpected credential {cred.get('id')}")
    bad = set(wf.get("settings") or {}) - SETTINGS
    if bad:
      problems.append(f"{key}: settings the API won't take: {sorted(bad)}")
  return problems


def save_id(key, wid):
  path = os.path.join(FLOW_DIR, f"{key}.json")
  wf = json.load(open(path))
  if wf.get("id") == wid:
    return
  wf = {"id": wid, **{k: v for k, v in wf.items() if k != "id"}}
  with open(path, "w") as fh:
    json.dump(wf, fh, indent=2, ensure_ascii=False)
    fh.write("\n")


# Parameters n8n leaves out when they hold their default: ignored on both sides, so a stored flow doesn't look CHANGED.
DEFAULTS = {("mode", "runOnceForAllItems"), ("httpMethod", "GET"), ("returnAll", False), ("objectType", "users"),
            ("version", 1), ("version", 2)}


def strip_defaults(value):
  if isinstance(value, dict):
    return {k: strip_defaults(v) for k, v in value.items() if isinstance(v, (dict, list)) or (k, v) not in DEFAULTS}
  if isinstance(value, list):
    return [strip_defaults(v) for v in value]
  return value


def norm(nodes, connections):
  clean = [{**{k: v for k, v in n.items() if k not in ("position", "id", "webhookId")}, "parameters": strip_defaults(n.get("parameters") or {})}
           for n in nodes or []]
  return json.dumps(sorted(clean, key=lambda n: n["name"]), sort_keys=True), json.dumps(connections or {}, sort_keys=True)


def read_env():
  env = {}
  path = os.path.join(HERE, ".env")
  if os.path.exists(path):
    for line in open(path):
      line = line.strip()
      if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
  env.update({k: v for k, v in os.environ.items() if k in ("N8N_API_KEY", "N8N_URL")})
  return env


class Api:
  def __init__(self, url, key):
    self.base = url.rstrip("/") + "/api/v1"
    self.key = key

  def call(self, method, path, body=None, query=None):
    url = self.base + path + ("?" + urllib.parse.urlencode(query) if query else "")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"X-N8N-API-KEY": self.key, "Content-Type": "application/json", "Accept": "application/json"})
    try:
      with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read()
        return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
      raw = e.read()
      try:
        return e.code, json.loads(raw)
      except ValueError:
        return e.code, {"message": raw.decode(errors="replace")[:300]}

  def must(self, method, path, body=None, query=None, what=""):
    status, data = self.call(method, path, body, query)
    if status >= 300:
      sys.exit(f"{what or method + ' ' + path} failed: HTTP {status}: {data.get('message', data)}")
    return data


def find_live(api, wf):
  if wf.get("id"):
    status, data = api.call("GET", f"/workflows/{wf['id']}")
    if status == 200:
      return data
  found, cursor = [], None
  while True:
    query = {"name": wf["name"], "projectId": PROJECT, "limit": 100}
    if cursor:
      query["cursor"] = cursor
    page = api.must("GET", "/workflows", query=query, what=f"looking up {wf['name']!r}")
    found += [w for w in page.get("data", []) if w.get("name") == wf["name"] and not w.get("isArchived")]
    cursor = page.get("nextCursor")
    if not cursor:
      break
  if len(found) > 1:
    sys.exit(f"{len(found)} workflows are named {wf['name']!r} in ProfitPad Support; archive the extra ones first")
  return api.must("GET", f"/workflows/{found[0]['id']}") if found else None


def main():
  parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
  parser.add_argument("flows", nargs="*", help="flow file names without .json (default: all)")
  parser.add_argument("--check", action="store_true", help="only check the JSON files here")
  parser.add_argument("--dry-run", action="store_true", help="compare with live n8n, change nothing")
  parser.add_argument("--no-publish", action="store_true", help="save, but don't publish")
  parser.add_argument("--publish", nargs="*", default=[], help="held flows to publish anyway")
  args = parser.parse_args()

  flows = load_flows(args.flows)
  problems = check(flows)
  if problems:
    sys.exit("\n".join(["the flow files have problems:", *problems]))
  print(f"{len(flows)} flow file(s) checked")
  if args.check:
    return

  env = read_env()
  if not env.get("N8N_API_KEY"):
    sys.exit("no N8N_API_KEY: put it in .env (git-ignored) or the environment")
  api = Api(env.get("N8N_URL") or DEFAULT_URL, env["N8N_API_KEY"])
  folder = api.must("GET", f"/projects/{PROJECT}/folders/{FOLDER}", what="finding the Cypress folder")
  if folder.get("name") != FOLDER_NAME:
    sys.exit(f"folder {FOLDER} is named {folder.get('name')!r}, not {FOLDER_NAME!r}: wrong n8n?")

  plan = []
  for key, wf in flows.items():
    live = find_live(api, wf)
    settings = {k: v for k, v in {**(wf.get("settings") or {}), **((live or {}).get("settings") or {})}.items() if k in SETTINGS}
    if not live:
      state = "NEW"
    elif norm(wf["nodes"], wf["connections"]) != norm(live.get("nodes"), live.get("connections")):
      state = "CHANGED"
    else:
      state = "same"
    plan.append({"key": key, "wf": wf, "live": live, "settings": settings, "state": state})

  for p in plan:
    live = p["live"] or {}
    held = "  (held: not published)" if p["key"] in HOLD and p["key"] not in args.publish else ""
    print(f"{live.get('id', '(new)'):<18}  {p['state']:<8} active={str(bool(live.get('active'))).lower():<5}  {p['wf']['name']}{held}")
  if args.dry_run:
    return

  for p in plan:
    if p["state"] == "same":
      save_id(p["key"], p["live"]["id"])
      p["id"] = p["live"]["id"]
      continue
    body = {"name": p["wf"]["name"], "nodes": p["wf"]["nodes"], "connections": p["wf"]["connections"],
            "settings": p["settings"], "parentFolderId": FOLDER}
    if p["state"] == "NEW":
      created = api.must("POST", "/workflows", {**body, "projectId": PROJECT}, what=f"creating {p['key']}")
      p["id"] = created["id"]
      print(f"created {p['key']}: {p['id']}")
    else:
      p["id"] = p["live"]["id"]
      api.must("PUT", f"/workflows/{p['id']}", body, what=f"updating {p['key']}")
      print(f"updated {p['key']}: {p['id']}")
    save_id(p["key"], p["id"])

  if args.no_publish:
    return
  for p in plan:
    if p["key"] in HOLD and p["key"] not in args.publish:
      continue
    if p["live"] and p["live"].get("active"):
      continue  # live already; an update to it is re-published by the PUT itself
    status, data = api.call("POST", f"/workflows/{p['id']}/publish")
    print(f"publish {p['key']}: " + ("ok" if status < 300 else f"FAILED HTTP {status}: {data.get('message', data)}"))


if __name__ == "__main__":
  main()
