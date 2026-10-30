- Read `HANDOFF.md` before starting any task.
- Do not run the preview or verify changes in the browser unless the user explicitly asks.

# Working rules

1. **Keep `HANDOFF.md` current.** Every change to a page, flow, endpoint, payload, table or open question goes into it in the same session.
2. **Flows are built, then deployed.** Edit `flows_src/` (Code node JS, SQL) or `build_flows.py` (wiring), run `/usr/bin/python3 build_flows.py` to regenerate `n8n-flows/*.json`, then `/usr/bin/python3 deploy_flows.py` (not the n8n connector). Never hand-edit `n8n-flows/*.json` or a flow in n8n; the next build or deploy overwrites it.
3. **Only n8n.profitpad.com**, project ProfitPad Support, folder Cypress (`sa918Q2oACwvEQO4`). Webhook paths start with `cypress-webtools/`.
4. **HubSpot nodes:** use the ProfitPad custom node (`CUSTOM.hubspotApi`, reference `~/Desktop/n8n/n8n-nodes/packages/n8n-nodes-hubspot/hs_n8n_node.md`), credential `zeoRTe2WDma5tuVC` ("cypress hubspot", Cypress portal 22691627). Never the chat's HubSpot connector.
5. **Live data:** `rr-assign` writes contact owners in Cypress's live HubSpot. Ask before publishing or running it.
6. **No secrets in git.** `.env` holds the n8n API key and is git-ignored. Credentials are referenced by id.
7. **Code style:** 2 space indent. n8n Code nodes return plain objects (`return { "reps": reps };`).
8. **Writing style:** no em dashes; use commas. State only what was checked; mark the rest unverified.
9. Never commit or push unless the user says so.
