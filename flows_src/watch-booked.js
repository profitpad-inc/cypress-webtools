// rr-watch-overwrites, booked visits (2026-10-30, on request): a booking link visitor sent to the rotation (or a boosted
// rep) who books becomes a HubSpot contact owned by that rep (HubSpot meetings / Calendly set the owner). That counts as
// the rep's lead: the Save adds it to cypress_rr_leads (source 'booking'), and the cypress_rr_lead_counted trigger
// moves the rotation past them or uses one boosted lead, as for a list lead. One per email.
const encode = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
const SLACK_MS = 60 * 1000; // owner set up to a minute before the logged visit still counts (clock skew)

function findBooked(visits, contacts) {
  const byEmail = new Map();
  for (const c of contacts) {
    const p = c.properties || {};
    if (p.email) {
      byEmail.set(String(p.email).toLowerCase(), {
        id: String(c.id),
        name: [p.firstname, p.lastname].filter(Boolean).join(' '),
        owner: p.hubspot_owner_id ? String(p.hubspot_owner_id) : '',
        assigned: Date.parse(p.hubspot_owner_assigneddate || ''),
      });
    }
  }
  const out = new Map();
  for (const v of visits) {
    const c = byEmail.get(String(v.email).toLowerCase());
    if (!c || !c.owner || c.owner !== String(v.hs_owner_id)) continue;
    // the owner has to be set after the visit, so an owner the contact already had doesn't count
    if (!Number.isFinite(c.assigned) || c.assigned < Date.parse(v.created_at) - SLACK_MS) continue;
    // latest matching visit per email wins (visits come oldest first)
    out.set(v.email, {
      visit_id: v.id, email: v.email, contact_id: c.id, contact_name: c.name, previous_owner_id: v.previous_owner_id || null,
      owner_id: c.owner, rep_id: v.rep_id, rep_name: v.rep_name, boosted: v.route === 'boost', visited_at: v.created_at,
    });
  }
  return [...out.values()];
}

const visits = $('Recent visits').first().json.body.rows || [];
const contacts = $input.first().json.results || [];
const rows = findBooked(visits, contacts);
return {
  "count": rows.length,
  "p": encode({ rows }),
};
