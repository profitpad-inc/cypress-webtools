// rr-assign: from the list's join-order pages, the members who joined since the last poll.
// HubSpot returns list 276's members newest first (checked 2026-10-30: 250 of 250 in descending order), so the HTTP
// node reads from the top and stops paging once a page reaches members already seen.
// The first poll ever only records the newest join time (baseline), so the list's history isn't assigned.
const MAX_PER_RUN = 100;

function pickNew(settings, recentIds, pages) {
  const members = [];
  for (const page of pages) {
    for (const r of page?.results || []) {
      const id = String(r.recordId ?? r.id ?? '');
      const ts = Date.parse(r.membershipTimestamp ?? r.timestamp ?? '');
      if (id && Number.isFinite(ts)) members.push({ id, ts });
    }
  }
  const newest = members.reduce((m, x) => Math.max(m, x.ts), 0);

  if (!settings.list_initialized) {
    return { baseline: true, members: [], cursor: { list_last_join_at: newest ? new Date(newest).toISOString() : '' } };
  }

  const lastJoin = settings.list_last_join_at ? Date.parse(settings.list_last_join_at) : Infinity;
  const recent = new Set((recentIds || []).map(String));
  const seen = new Set();
  const fresh = members
    .filter((m) => m.ts > lastJoin || (m.ts === lastJoin && !recent.has(m.id)))
    .filter((m) => !seen.has(m.id) && seen.add(m.id))
    .sort((a, b) => a.ts - b.ts);
  // oldest first; anything past the cap is picked up next poll, since the cursor only moves to the last one taken
  const take = fresh.slice(0, MAX_PER_RUN);
  const takenMax = take.reduce((m, x) => Math.max(m, x.ts), 0);
  return {
    baseline: false,
    members: take.map((m) => ({ id: m.id, joined_at: new Date(m.ts).toISOString() })),
    cursor: { list_last_join_at: takenMax ? new Date(takenMax).toISOString() : '' },
  };
}

const state = $('Load state').first().json.body;
const pages = $input.all().map((item) => item.json);
const out = pickNew(state.settings, state.recent, pages);
return {
  "baseline": out.baseline,
  "members": out.members,
  "contactIds": out.members.map((m) => m.id).join(','),
  "cursor": out.cursor,
};
