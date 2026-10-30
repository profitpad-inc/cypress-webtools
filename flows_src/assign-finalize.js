// rr-assign: puts together what gets saved. If HubSpot refused the owner change, those rows become errors, so the
// trigger doesn't count them and the same reps are first in line next time.
const encode = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');

function finalize(pick, planned, hubspot) {
  if (!planned) {
    return { rows: [], cursor: pick.cursor, error: '' };
  }
  let error = '';
  if (hubspot) {
    const res = hubspot.json || {};
    const failed = res.error || (Array.isArray(res.errors) && res.errors.length) || res.status === 'error';
    if (failed) error = String(res.error?.message || res.error || res.message || 'HubSpot refused the owner change').slice(0, 300);
  }
  if (!error) return { rows: planned.rows, cursor: pick.cursor, error };
  const rows = planned.rows.map((r) => (r.status === 'assigned'
    ? { ...r, status: 'error', owner_id: r.previous_owner_id, reason: `Would have gone to ${r.rep_name}, but HubSpot refused the owner change: ${error}` }
    : r));
  return { rows, cursor: pick.cursor, error };
}

const pick = $('Pick new members').first().json;
const planned = $('Plan').isExecuted ? $('Plan').first().json : null;
const hubspot = $('HubSpot: set owners').isExecuted ? $('HubSpot: set owners').first() : null;
const out = finalize(pick, planned, hubspot);
return {
  "count": out.rows.length,
  "error": out.error,
  "p": encode(out),
};
