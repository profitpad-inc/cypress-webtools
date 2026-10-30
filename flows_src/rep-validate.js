// rep: checks the POST body and passes it on base64-encoded (no commas, so the Postgres node keeps it one parameter).
const clean = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const fail = (statusCode, error) => ({ ok: false, statusCode, body: { error } });
const encode = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
const isId = (v) => /^\d{1,12}$/.test(String(v ?? ''));
const isLink = (v) => v === '' || /^https?:\/\/\S+$/i.test(v);
const isoOrEmpty = (v) => {
  if (v === '' || v === null) return '';
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

function validate(body) {
  const b = body && typeof body === 'object' ? body : {};
  const action = clean(b.action, 20);

  if (action === 'add') {
    if (!isId(b.hs_owner_id)) return fail(400, 'Pick a HubSpot owner to add.');
    const meeting_link = clean(b.meeting_link, 500);
    if (!isLink(meeting_link)) return fail(400, 'The meeting link must start with http:// or https://');
    return { ok: true, payload: {
      action,
      hs_owner_id: String(b.hs_owner_id),
      hs_user_id: isId(b.hs_user_id) ? String(b.hs_user_id) : null,
      name: clean(b.name),
      email: clean(b.email),
      meeting_link,
      enabled: b.enabled !== false,
    } };
  }

  if (action === 'update') {
    if (!isId(b.id)) return fail(400, 'Missing the rep id.');
    const payload = { action, id: Number(b.id) };
    if ('meeting_link' in b) {
      payload.meeting_link = clean(b.meeting_link, 500);
      if (!isLink(payload.meeting_link)) return fail(400, 'The meeting link must start with http:// or https://');
    }
    if ('enabled' in b) payload.enabled = b.enabled === true;
    for (const key of ['away_from', 'away_until']) {
      if (key in b) {
        const v = isoOrEmpty(b[key]);
        if (v === null) return fail(400, `That ${key === 'away_from' ? 'start' : 'return'} date isn't a valid date.`);
        payload[key] = v;
      }
    }
    if (payload.away_from && payload.away_until && payload.away_until <= payload.away_from) {
      return fail(400, 'The return date has to be after the start date.');
    }
    if ('away_reason' in b) payload.away_reason = clean(b.away_reason);
    if ('boost_remaining' in b) {
      const n = Number(b.boost_remaining);
      if (!Number.isInteger(n) || n < 0 || n > 100) return fail(400, 'The boost has to be a whole number of leads from 0 to 100.');
      payload.boost_remaining = n;
    }
    return { ok: true, payload };
  }

  if (action === 'remove') {
    if (!isId(b.id)) return fail(400, 'Missing the rep id.');
    return { ok: true, payload: { action, id: Number(b.id) } };
  }

  if (action === 'order') {
    const order = Array.isArray(b.order) ? b.order : [];
    if (!order.length || !order.every(isId)) return fail(400, 'The new order is missing or invalid.');
    return { ok: true, payload: { action, order: order.map(String) } };
  }

  return fail(400, 'Unknown action.');
}

const result = validate($input.first().json.body);
if (!result.ok) return result;
return { "ok": true, "action": result.payload.action, "p": encode(result.payload) };
