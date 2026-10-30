// rr-watch-overwrites: every owner change made after the tool's decision, from the contact's owner history.
// The new owner is kept; this only records who changed it, when, and through what (Calendly, a user, a workflow).
// Rows are leads (cypress_rr_leads), from the list or booked through the booking link.
const encode = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');

function findOverwrites(assignments, contacts) {
  const byId = new Map(contacts.map((c) => [String(c.id), c]));
  const rows = [];
  for (const a of assignments) {
    const c = byId.get(String(a.contact_id));
    const history = (c?.propertiesWithHistory?.hubspot_owner_id || [])
      .map((h) => ({ ...h, t: Date.parse(h.timestamp) }))
      .filter((h) => Number.isFinite(h.t) && h.t > Date.parse(a.created_at))
      .sort((x, y) => x.t - y.t);
    let prev = a.owner_id ? String(a.owner_id) : '';
    for (const h of history) {
      const value = h.value ? String(h.value) : '';
      if (value === prev) continue;
      rows.push({
        lead_id: a.id,
        contact_id: String(a.contact_id),
        from_owner_id: prev || null,
        to_owner_id: value || null,
        source_type: h.sourceType || '',
        source_id: h.sourceId || '',
        source_label: h.sourceLabel || '',
        changed_by_user_id: h.updatedByUserId ? String(h.updatedByUserId) : null,
        changed_at: new Date(h.t).toISOString(),
      });
      prev = value;
    }
  }
  return rows;
}

// The contact's name as HubSpot has it now, where it differs from the lead's (2026-10-30: a booking link visitor
// without a name gets one when they book, and the lead showed their email)
function findRenames(leads, contacts) {
  const byId = new Map(contacts.map((c) => [String(c.id), c]));
  const out = [];
  for (const l of leads) {
    const p = byId.get(String(l.contact_id))?.properties || {};
    const name = [p.firstname, p.lastname].filter(Boolean).join(' ').trim();
    if (name && name !== (l.contact_name || '')) out.push({ contact_id: String(l.contact_id), name });
  }
  return out;
}

const assignments = $('Recent leads').first().json.body.rows || [];
const contacts = $input.first().json.results || [];
const rows = findOverwrites(assignments, contacts);
const renames = findRenames(assignments, contacts);
return {
  "count": rows.length,
  "renamed": renames.length,
  "p": encode({ rows, renames }),
};
