// report: checks ?from=YYYY-MM-DD&to=YYYY-MM-DD&tz=Area/City and passes them on base64-encoded.
const fail = (statusCode, error) => ({ ok: false, statusCode, body: { error } });
const encode = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00Z'));

function validate(query) {
  const q = query || {};
  const from = String(q.from || '');
  const to = String(q.to || from);
  let tz = String(q.tz || 'America/Toronto');
  if (!isDay(from) || !isDay(to)) return fail(400, 'Pick a valid date.');
  if (to < from) return fail(400, 'The end date is before the start date.');
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 92) return fail(400, 'Pick a range of 3 months or less.');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch (e) {
    tz = 'America/Toronto';
  }
  return { ok: true, payload: { from, to, tz } };
}

const result = validate($input.first().json.query);
if (!result.ok) return result;
return { "ok": true, "p": encode(result.payload) };
