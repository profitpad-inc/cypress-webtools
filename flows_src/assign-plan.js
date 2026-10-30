// rr-assign: decides each new member's owner and writes down why.
// Boost: a rep with boost_remaining > 0 (on and not out of office) takes the lead ahead of the rotation; with several
// boosted reps, the one with the most left goes first, so they share evenly. Boosted leads don't move the rotation
// pointer, so the normal order carries on where it was once the boosts run out.
function isAway(rep, now) {
  const until = rep.away_until ? Date.parse(rep.away_until) : 0;
  const from = rep.away_from ? Date.parse(rep.away_from) : 0;
  return until > now && (!from || from <= now);
}

function startIndex(rotation, settings) {
  const byId = rotation.findIndex((r) => r.id === settings.last_rep_id);
  if (byId >= 0) return byId;
  // the last rep was removed or turned off: carry on from where they sat in the order
  const pos = Number(settings.last_position);
  if (!Number.isFinite(pos)) return -1;
  const next = rotation.findIndex((r) => r.position > pos);
  return next >= 0 ? next - 1 : rotation.length - 1;
}

function plan({ now, settings, reps, contacts, members }) {
  const paused = settings.paused && (!settings.paused_until || Date.parse(settings.paused_until) > now);
  const rotation = reps.filter((r) => r.enabled).sort((a, b) => a.position - b.position || a.id - b.id);
  const repByOwner = new Map(reps.map((r) => [String(r.hs_owner_id), r]));
  const contactById = new Map(contacts.map((c) => [String(c.id), c]));
  let pointer = startIndex(rotation, settings);
  let lastRep = null;
  const boostLeft = new Map(rotation.map((r) => [r.id, Math.max(0, Number(r.boost_remaining) || 0)]));
  const rows = [];
  const updates = [];

  for (const m of members) {
    const c = contactById.get(String(m.id));
    const p = c?.properties || {};
    const owner = p.hubspot_owner_id ? String(p.hubspot_owner_id) : null;
    const row = {
      contact_id: String(m.id),
      contact_name: [p.firstname, p.lastname].filter(Boolean).join(' '),
      contact_email: p.email || '',
      joined_list_at: m.joined_at,
      previous_owner_id: owner,
      owner_id: owner,
      rep_id: null,
      rep_name: owner && repByOwner.get(owner) ? repByOwner.get(owner).name : '',
      skipped: [],
    };

    if (!c) {
      rows.push({ ...row, status: 'error', reason: 'The contact could not be read from HubSpot (it may have been deleted or merged).' });
      continue;
    }
    if (paused) {
      const why = settings.pause_reason ? ` (${settings.pause_reason})` : '';
      rows.push({ ...row, status: 'paused', reason: `Automatic assignment was paused${why}, so the lead was left as it was.` });
      continue;
    }
    if (settings.skip_if_owned && owner) {
      rows.push({ ...row, status: 'kept_existing', reason: 'The contact already had an owner, so it was left with them.' });
      continue;
    }

    const boosted = rotation
      .filter((r) => boostLeft.get(r.id) > 0 && !isAway(r, now))
      .sort((a, b) => boostLeft.get(b.id) - boostLeft.get(a.id) || a.position - b.position)[0];
    if (boosted) {
      const left = boostLeft.get(boosted.id) - 1;
      boostLeft.set(boosted.id, left);
      const parts = [left > 0
        ? `Boosted: ${boosted.name} is taking the next leads (${left} more after this one)`
        : `Boosted: ${boosted.name}'s last boosted lead, the rotation picks up again after this`];
      if (owner && owner !== String(boosted.hs_owner_id)) {
        const prev = repByOwner.get(owner);
        parts.push(`replaced the previous owner${prev ? ' ' + prev.name : ''}`);
      }
      rows.push({
        ...row,
        owner_id: String(boosted.hs_owner_id),
        rep_id: boosted.id,
        rep_name: boosted.name,
        boosted: true,
        status: 'assigned',
        reason: parts.join(', ') + '.',
      });
      updates.push({ id: String(m.id), properties: { hubspot_owner_id: String(boosted.hs_owner_id) } });
      continue;
    }

    let chosen = null;
    const skipped = [];
    for (let step = 1; step <= rotation.length; step++) {
      const idx = (pointer + step + rotation.length) % rotation.length;
      const rep = rotation[idx];
      if (isAway(rep, now)) {
        skipped.push({ rep_id: rep.id, name: rep.name, away_until: rep.away_until, away_reason: rep.away_reason || '' });
        continue;
      }
      chosen = { rep, idx };
      break;
    }

    if (!chosen) {
      rows.push({
        ...row,
        skipped,
        status: 'no_reps',
        reason: rotation.length
          ? 'Every rep in the rotation is out of office, so the lead was left unassigned.'
          : 'No reps are turned on in the rotation, so the lead was left unassigned.',
      });
      continue;
    }

    pointer = chosen.idx;
    lastRep = chosen.rep;
    const parts = ['Next in the rotation'];
    if (skipped.length) {
      parts.push(`skipped ${skipped.map((s) => `${s.name} (out of office${s.away_reason ? ': ' + s.away_reason : ''})`).join(', ')}`);
    }
    if (owner && owner !== String(chosen.rep.hs_owner_id)) {
      const prev = repByOwner.get(owner);
      parts.push(`replaced the previous owner${prev ? ' ' + prev.name : ''}`);
    }
    rows.push({
      ...row,
      owner_id: String(chosen.rep.hs_owner_id),
      rep_id: chosen.rep.id,
      rep_name: chosen.rep.name,
      skipped,
      status: 'assigned',
      reason: parts.join(', ') + '.',
    });
    updates.push({ id: String(m.id), properties: { hubspot_owner_id: String(chosen.rep.hs_owner_id) } });
  }

  return {
    rows,
    updates,
    last_rep_id: lastRep ? lastRep.id : null,
    last_position: lastRep ? lastRep.position : null,
  };
}

const state = $('Load state').first().json.body;
const pick = $('Pick new members').first().json;
const read = $input.first().json;
const out = plan({
  now: Date.now(),
  settings: state.settings,
  reps: state.reps || [],
  contacts: read.results || [],
  members: pick.members || [],
});
return {
  "rows": out.rows,
  "updates": out.updates,
  "last_rep_id": out.last_rep_id,
  "last_position": out.last_position,
  "hasUpdates": out.updates.length > 0,
};
