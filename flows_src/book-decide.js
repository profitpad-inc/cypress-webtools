// book: picks the meeting link. A known contact goes to their owner (if that rep has a link and isn't out); anyone
// else gets the rep who is next in the shared rotation and has a meeting link. Visits never move the rotation or use
// a boost: only a lead that rr-assign really assigns does (2026-10-30, on request), so every visitor goes to whoever
// is next until a lead is assigned. The same email within a day goes back to the same rep.
// Boost (2026-10-30, on request: "booking links also are impacted by boost"): a boosted rep (on, not out, has a link,
// boost_remaining > 0; the one with most left first) is "next", so visitors go to them while the boost lasts.
const encode = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');

function isAway(rep, now) {
  const until = rep.away_until ? Date.parse(rep.away_until) : 0;
  const from = rep.away_from ? Date.parse(rep.away_from) : 0;
  return until > now && (!from || from <= now);
}

function startIndex(rotation, settings) {
  const byId = rotation.findIndex((r) => r.id === settings.last_rep_id);
  if (byId >= 0) return byId;
  const pos = Number(settings.last_position);
  if (!Number.isFinite(pos)) return -1;
  const next = rotation.findIndex((r) => r.position > pos);
  return next >= 0 ? next - 1 : rotation.length - 1;
}

// prefill the scheduler: Calendly takes name and email, HubSpot meetings take email, firstName and lastName
// Built by hand: n8n's Code node sandbox has no URL class (2026-10-30: new URL() threw there, so links went out bare).
function withPrefill(link, contact) {
  if (!contact || !(contact.email || contact.firstname || contact.lastname)) return link;
  const m = /^(https?:\/\/([^\/?#]+)([^?#]*))(\?[^#]*)?(#.*)?$/i.exec(String(link || ''));
  if (!m) return link;
  const [, base, host, path, query = '', hash = ''] = m;
  const set = {};
  if (contact.email) set.email = contact.email;
  if (/(^|\.)calendly\.com$/i.test(host)) {
    const name = [contact.firstname, contact.lastname].filter(Boolean).join(' ');
    if (name) set.name = name;
  } else if (/hubspot/i.test(host) || /\/meetings\//.test(path)) {
    if (contact.firstname) set.firstName = contact.firstname;
    if (contact.lastname) set.lastName = contact.lastname;
  }
  if (!Object.keys(set).length) return link;
  // keep the link's own parameters, minus any we're about to set
  const kept = query.replace(/^\?/, '').split('&').filter((kv) => kv && !(decodeURIComponent(kv.split('=')[0]) in set));
  const added = Object.keys(set).map((k) => k + '=' + encodeURIComponent(set[k]));
  return base + '?' + kept.concat(added).join('&') + hash;
}

function decide({ now, settings, reps, contact, recent, email, given }) {
  // what the scheduler gets prefilled with: names and email from the link first, else from HubSpot
  given = given || {};
  const prefill = {
    email: email || contact?.email || '',
    firstname: given.firstname || contact?.firstname || '',
    lastname: given.lastname || contact?.lastname || '',
  };
  const repById = new Map(reps.map((r) => [r.id, r]));
  const repByOwner = new Map(reps.map((r) => [String(r.hs_owner_id), r]));
  const base = {
    email: email || contact?.email || '',
    contact_id: contact?.id || null,
    contact_name: [prefill.firstname, prefill.lastname].filter(Boolean).join(' '),
    owner_id: contact?.owner || null,
    skipped: [],
  };
  const pick = (rep, route, reason, extra) => ({
    ...base, ...extra, rep_id: rep.id, rep_name: rep.name, rep_position: rep.position,
    url: withPrefill(rep.meeting_link, prefill), route, reason,
  });

  if (recent) {
    const rep = repById.get(recent.rep_id);
    if (rep && rep.meeting_link && !isAway(rep, now)) {
      return pick(rep, 'repeat', `Same rep as their visit ${new Date(recent.created_at).toISOString()} (within a day).`);
    }
  }

  let lead = '';
  if (contact?.owner) {
    const rep = repByOwner.get(String(contact.owner));
    if (rep && rep.meeting_link && !isAway(rep, now)) {
      return pick(rep, 'owner', `Existing contact, sent to their owner ${rep.name}.`);
    }
    lead = !rep ? 'Their owner isn\'t in the rotation list, so '
      : !rep.meeting_link ? `Their owner ${rep.name} has no meeting link, so `
      : `Their owner ${rep.name} is out of office, so `;
  } else if (contact) {
    lead = 'Existing contact with no owner, so ';
  } else if (base.email) {
    lead = 'New visitor (email not in HubSpot), so ';
  } else {
    lead = 'Visitor without an email, so ';
  }

  const rotation = reps.filter((r) => r.enabled).sort((a, b) => a.position - b.position || a.id - b.id);
  const boosted = rotation
    .filter((r) => Number(r.boost_remaining) > 0 && r.meeting_link && !isAway(r, now))
    .sort((a, b) => b.boost_remaining - a.boost_remaining || a.position - b.position)[0];
  if (boosted) {
    const n = Number(boosted.boost_remaining);
    return pick(boosted, 'boost', `${lead}${boosted.name} is boosted (${n} boosted ${n === 1 ? 'lead' : 'leads'} left).`);
  }
  const start = startIndex(rotation, settings);
  const skipped = [];
  for (let step = 1; step <= rotation.length; step++) {
    const rep = rotation[(start + step + rotation.length) % rotation.length];
    if (isAway(rep, now)) { skipped.push({ rep_id: rep.id, name: rep.name, why: 'out of office' }); continue; }
    if (!rep.meeting_link) { skipped.push({ rep_id: rep.id, name: rep.name, why: 'no meeting link' }); continue; }
    const note = skipped.length ? `, skipped ${skipped.map((s) => `${s.name} (${s.why})`).join(', ')}` : '';
    return pick(rep, 'rotation', `${lead}next in the rotation${note}.`, { skipped });
  }
  // "..., and nobody in the rotation was available." (wording 2026-10-30, on request)
  const why = lead.replace(/, so $/, ', and ');
  return { ...base, skipped, rep_id: null, rep_name: '', url: '', route: 'none', reason: `${why}nobody in the rotation was available.` };
}

const v = $('Validate').first().json;
const state = $('Load').first().json.body;
let contact = null;
if ($('HubSpot: contact').isExecuted) {
  const c = $('HubSpot: contact').first().json;
  if (c && c.id && c.objectFound !== false && !c.error) {
    const p = c.properties || {};
    contact = { id: String(c.id), email: p.email || v.email, firstname: p.firstname || '', lastname: p.lastname || '', owner: p.hubspot_owner_id || null };
  }
}
const out = decide({ now: Date.now(), settings: state.settings, reps: state.reps || [], contact, recent: state.recent, email: v.email,
  given: { firstname: v.firstname, lastname: v.lastname } });
return {
  "p": encode(out),
  "statusCode": out.url ? 200 : 503,
  "body": out.url
    ? { "url": out.url, "rep_name": out.rep_name, "route": out.route }
    : { "error": "Nobody is available to book right now." },
};
