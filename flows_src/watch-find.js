// rr-watch-overwrites: every owner change made after the tool's decision, from the contact's owner history.
// The new owner is kept; this only records who changed it, when, and through what (Calendly, a user, a workflow).
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
        assignment_id: a.id,
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

const assignments = $('Recent assignments').first().json.body.rows || [];
const contacts = $input.first().json.results || [];
const rows = findOverwrites(assignments, contacts);
return {
  "count": rows.length,
  "p": encode({ rows }),
};
